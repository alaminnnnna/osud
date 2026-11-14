/* Medora — production REST API server (Phase 4 + 7 + 8 + 9).
   Express 5, real PostgreSQL queries, consistent envelope:
     { success: true, data: ..., pagination?: {page, limit, total, totalPages} }
   Security: rate limiting, CORS allow-list, safe errors (no stack traces),
   Basic-auth admin, bearer-token ingestion. */
import express, { type Request, type Response, type NextFunction } from 'express';
import compression from 'compression';
import { z } from 'zod';
import { config } from './config.js';
import { pool, withTransaction, dbHealthy } from './db.js';
import { searchMedicines, suggestions } from './search.js';
import * as Q from './queries.js';
import { normalize, type NormalizedRecord } from './normalize.js';
import { upsertBatch, getImportState } from './importer.js';

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '8mb' }));

/* ---------- request logging (no secrets) ---------- */
app.use((req: Request, res: Response, next: NextFunction) => {
  const t0 = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/admin')) return; // admin activity is not logged with query params
    console.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - t0}ms`);
  });
  next();
});

/* ---------- rate limiting (fixed window per IP; Redis for multi-instance) ---------- */
const hits = new Map<string, { count: number; resetAt: number }>();
app.use((req: Request, res: Response, next: NextFunction) => {
  const limitPerMin = config.RATE_LIMIT_PER_MINUTE;
  if (!limitPerMin) return next();
  if (req.path.startsWith('/admin') || req.path.startsWith('/api/v1/ingest')) return next();
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  let entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + 60_000 };
    hits.set(ip, entry);
  }
  entry.count++;
  res.setHeader('X-RateLimit-Limit', String(limitPerMin));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limitPerMin - entry.count)));
  if (entry.count > limitPerMin) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ success: false, error: { code: 'rate_limited', message: 'Too many requests — try again in a minute.' } });
  }
  next();
});

/* ---------- CORS ---------- */
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (config.corsOrigins === '*') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && (config.corsOrigins as string[]).includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

/* ---------- cache headers ---------- */
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/admin') || req.path.startsWith('/api/v1/ingest')) {
    res.setHeader('Cache-Control', 'no-store');
  } else if (req.path.startsWith('/api/v1/')) {
    res.setHeader('Cache-Control', `public, max-age=${config.CACHE_LIST_SECONDS}, stale-while-revalidate=300`);
  }
  next();
});

/* ---------- helpers ---------- */
function ok(res: Response, data: unknown, pagination?: unknown) {
  const body: Record<string, unknown> = { success: true, data };
  if (pagination) body.pagination = pagination;
  res.json(body);
}
function fail(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ success: false, error: { code, message } });
}
function pageParams(req: Request): { page: number; limit: number } {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  return { page, limit };
}
function boolParam(v: unknown): boolean {
  return v === '1' || v === 'true';
}
function numParam(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const api = express.Router();

/* ---------- medicines ---------- */
api.get('/medicines', async (req, res, next) => {
  try {
    const { page, limit } = pageParams(req);
    const result = await Q.listMedicines({
      page, limit,
      sort: typeof req.query.sort === 'string' ? req.query.sort : undefined,
      companySlug: typeof req.query.company === 'string' ? req.query.company : null,
      categorySlug: typeof req.query.category === 'string' ? req.query.category : null,
      form: typeof req.query.form === 'string' ? req.query.form : null,
      type: typeof req.query.type === 'string' ? req.query.type : null,
      rx: boolParam(req.query.rx),
      offer: boolParam(req.query.offer),
      minPrice: numParam(req.query.min),
      maxPrice: numParam(req.query.max),
    });
    return ok(res, result.items, Q.paginate(page, limit, result.total));
  } catch (e) { next(e); }
});

api.get('/medicines/:key', async (req, res, next) => {
  try {
    const key = req.params.key as string;
    // numeric keys are stable source product ids (old links keep working)
    if (/^\d+$/.test(key)) {
      const byId = await Q.getMedicineBySourceId(Number(key));
      if (byId) return ok(res, byId);
      const slug = await Q.resolveSlugRedirect(key);
      if (slug) return ok(res, { redirect: slug });
      return fail(res, 404, 'not_found', 'No medicine with that id.');
    }
    const redirect = await Q.resolveSlugRedirect(key);
    if (redirect) return ok(res, { redirect });
    const med = await Q.getMedicineBySlug(key);
    if (!med) return fail(res, 404, 'not_found', 'No medicine with that slug.');
    return ok(res, med);
  } catch (e) { next(e); }
});

api.get('/medicines/:key/price-history', async (req, res, next) => {
  try {
    const key = req.params.key as string;
    // Numeric source ids resolve to the full record (same shape as by-slug).
    const base = /^\d+$/.test(key)
      ? await (async () => {
          const byId = await Q.getMedicineBySourceId(Number(key));
          return byId ? await Q.getMedicineBySlug(String((byId as Record<string, unknown>).slug)) : null;
        })()
      : await Q.getMedicineBySlug(key);
    if (!base) return fail(res, 404, 'not_found', 'No medicine found.');
    const info = base as Record<string, unknown>;
    return ok(res, { slug: info.slug, name: info.name, history: info.priceHistory ?? [] });
  } catch (e) { next(e); }
});

/* ---------- search ---------- */
api.get('/search', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const { page, limit } = pageParams(req);
    const result = await searchMedicines({
      q, page, limit,
      companySlug: typeof req.query.company === 'string' ? req.query.company : null,
      categorySlug: typeof req.query.category === 'string' ? req.query.category : null,
      form: typeof req.query.form === 'string' ? req.query.form : null,
      type: typeof req.query.type === 'string' ? req.query.type : null,
      rx: boolParam(req.query.rx),
      offer: boolParam(req.query.offer),
      minPrice: numParam(req.query.min),
      maxPrice: numParam(req.query.max),
    });
    return ok(res, { query: q, mode: result.mode, items: result.items }, Q.paginate(page, limit, result.total));
  } catch (e) { next(e); }
});

api.get('/search/suggestions', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    return ok(res, await suggestions(q, 8));
  } catch (e) { next(e); }
});

/* ---------- offers ---------- */
api.get('/offers', async (req, res, next) => {
  try {
    const { page, limit } = pageParams(req);
    const sort = typeof req.query.sort === 'string' ? req.query.sort : undefined;
    const result = await Q.listOffers({ page, limit, sort });
    return ok(res, result.items, Q.paginate(page, limit, result.total));
  } catch (e) { next(e); }
});

/* ---------- companies / categories ---------- */
api.get('/companies', async (req, res, next) => {
  try {
    const { page, limit } = pageParams(req);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const result = await Q.listCompanies({ q, page, limit });
    return ok(res, result.items, Q.paginate(page, limit, result.total));
  } catch (e) { next(e); }
});
api.get('/companies/:slug', async (req, res, next) => {
  try {
    const company = await Q.getCompanyBySlug(req.params.slug as string);
    if (!company) return fail(res, 404, 'not_found', 'No company with that slug.');
    const medicines = await Q.listMedicines({ companySlug: req.params.slug as string, page: 1, limit: 100, sort: 'name' });
    return ok(res, { ...company, medicines: medicines.items });
  } catch (e) { next(e); }
});
api.get('/categories', async (req, res, next) => {
  try {
    const { page, limit } = pageParams(req);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const result = await Q.listCategories({ q, page, limit });
    return ok(res, result.items, Q.paginate(page, limit, result.total));
  } catch (e) { next(e); }
});
api.get('/categories/:slug', async (req, res, next) => {
  try {
    const category = await Q.getCategoryBySlug(req.params.slug as string);
    if (!category) return fail(res, 404, 'not_found', 'No category with that slug.');
    const medicines = await Q.listMedicines({ categorySlug: req.params.slug as string, page: 1, limit: 100, sort: 'name' });
    return ok(res, { ...category, medicines: medicines.items });
  } catch (e) { next(e); }
});

/* ---------- system ---------- */
api.get('/health', async (req, res) => {
  const db = await dbHealthy();
  res.setHeader('Cache-Control', 'public, max-age=15');
  res.status(db ? 200 : 503).json({
    success: db,
    data: { status: db ? 'ok' : 'degraded', database: db ? 'connected' : 'unreachable', time: new Date().toISOString() },
  });
});
api.get('/stats', async (req, res, next) => {
  try { return ok(res, await Q.getStats()); } catch (e) { next(e); }
});

/* ---------- Phase 9: secure ingestion (bearer token) ---------- */
function requireIngestToken(req: Request, res: Response, next: NextFunction) {
  if (!config.ingestEnabled) return fail(res, 503, 'ingest_disabled', 'Ingestion is disabled (set INGEST_TOKEN).');
  const header = req.headers.authorization ?? '';
  if (header !== `Bearer ${config.INGEST_TOKEN}`) return fail(res, 401, 'unauthorized', 'Valid bearer token required.');
  next();
}

interface IngestRecord {
  ok: boolean; reason?: string;
  rec?: { sourceProductId: number };
}
const RunSummary = z.object({
  runId: z.string().min(1),
  mode: z.string(),
  status: z.enum(['running', 'completed', 'partial', 'failed']),
  startedAt: z.string(),
  finishedAt: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  apiRequests: z.number().nullable().optional(),
  pagesDiscovered: z.number().nullable().optional(),
  pagesProcessed: z.number().nullable().optional(),
  productsCollected: z.number().nullable().optional(),
  coveragePct: z.number().nullable().optional(),
  fullCoverage: z.boolean().nullable().optional(),
  stats: z.unknown().optional(),
  coverageGaps: z.unknown().optional(),
}).passthrough();

api.post('/ingest/records', requireIngestToken, async (req, res, next) => {
  try {
    const records = Array.isArray(req.body?.records) ? req.body.records : null;
    if (!records) return fail(res, 400, 'bad_request', 'Body must be { records: [...] }.');
    if (records.length > 5000) return fail(res, 413, 'too_large', 'Batch too large (max 5000 records).');

    const validRecs: NormalizedRecord[] = [];
    const rejected: { index: number; reason: string }[] = [];
    records.forEach((r: unknown, index: number) => {
      const res2 = normalize(r);
      if (res2.ok) validRecs.push(res2.rec);
      else rejected.push({ index, reason: res2.reason });
    });

    // Idempotent, history-preserving upserts — the same batch pipeline the
    // file importer uses, so ingestion can never corrupt existing data.
    const state = await getImportState();
    const stats = await withTransaction((client) => upsertBatch(client, state, null, validRecs));

    return ok(res, {
      received: records.length,
      accepted: validRecs.length,
      rejected,
      applied: stats,
    });
  } catch (e) { next(e); }
});

api.post('/ingest/runs', requireIngestToken, async (req, res, next) => {
  try {
    const parsed = RunSummary.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'bad_request', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const r = parsed.data;
    const run = await pool.query<{ id: number }>(
      `INSERT INTO scrape_runs (run_id, mode, source, status, started_at, finished_at, duration_ms,
         api_requests, pages_discovered, pages_processed, products_collected, coverage_pct, full_coverage, stats, coverage_gaps)
       VALUES ($1,$2,'ingest',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (run_id) DO UPDATE SET status = EXCLUDED.status, finished_at = EXCLUDED.finished_at,
         stats = EXCLUDED.stats, coverage_gaps = EXCLUDED.coverage_gaps
       RETURNING id`,
      [r.runId, r.mode, r.status, r.startedAt, r.finishedAt ?? null, r.durationMs ?? null,
        r.apiRequests ?? null, r.pagesDiscovered ?? null, r.pagesProcessed ?? null,
        r.productsCollected ?? null, r.coveragePct ?? null, r.fullCoverage ?? null,
        JSON.stringify(r.stats ?? {}), JSON.stringify(r.coverageGaps ?? [])],
    );
    return ok(res, { scrapeRunId: run.rows[0].id, runId: r.runId });
  } catch (e) { next(e); }
});


/* ---------- Phase 8: protected admin ---------- */
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!config.adminEnabled) return fail(res, 503, 'admin_disabled', 'Admin is disabled (set ADMIN_USERNAME/ADMIN_PASSWORD).');
  const header = req.headers.authorization ?? '';
  const expected = 'Basic ' + Buffer.from(`${config.ADMIN_USERNAME}:${config.ADMIN_PASSWORD}`).toString('base64');
  if (header !== expected) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Medora admin", charset="UTF-8"');
    return fail(res, 401, 'unauthorized', 'Admin authentication required.');
  }
  next();
}

api.get('/admin/metrics', requireAdmin, async (req, res, next) => {
  try {
    const [stats, imports, recentChanges, failures] = await Promise.all([
      Q.getStats(),
      pool.query(`SELECT id, mode, status, started_at AS "startedAt", finished_at AS "finishedAt", totals
                  FROM import_jobs ORDER BY started_at DESC LIMIT 10`),
      pool.query(`SELECT ph.medicine_id AS "medicineId", m.name, m.slug,
                         ph.regular_sales AS "regularSales", ph.offer_sales AS "offerSales",
                         ph.changed_fields AS "changedFields", ph.recorded_at AS "recordedAt"
                  FROM price_history ph JOIN medicines m ON m.id = ph.medicine_id
                  ORDER BY ph.recorded_at DESC LIMIT 20`),
      pool.query(`SELECT status, count(*) AS ct FROM data_validations GROUP BY status`),
    ]);
    return ok(res, {
      stats: stats,
      imports: imports.rows,
      recentPriceChanges: recentChanges.rows,
      validationBreakdown: failures.rows,
      database: { poolTotal: pool.totalCount, poolIdle: pool.idleCount, poolWaiting: pool.waitingCount },
    });
  } catch (e) { next(e); }
});

app.get('/admin', requireAdmin, async (req, res) => {
  const stats = await Q.getStats().catch(() => null);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Medora — Admin</title><style>
:root{--bg:#0A0E0C;--card:#101613;--fg:#E7EFEA;--muted:#9AA99F;--border:#243029;--accent:#3BD98F}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 20px}
h1{font-size:22px;font-weight:500}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-top:20px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
.card .k{font-size:12px;color:var(--muted)}.card .v{font-size:26px;font-family:ui-monospace,monospace;margin-top:4px}
a{color:var(--accent)}
</style></head><body><main>
<h1>Medora admin</h1>
<p class="k">Database-backed dashboard. JSON metrics: <a href="/api/v1/admin/metrics">/api/v1/admin/metrics</a></p>
<div class="grid">
  <div class="card"><div class="k">Medicines</div><div class="v">${stats?.medicines ?? '—'}</div></div>
  <div class="card"><div class="k">Verified</div><div class="v">${stats?.verified ?? '—'}</div></div>
  <div class="card"><div class="k">Offers</div><div class="v">${stats?.offers ?? '—'}</div></div>
  <div class="card"><div class="k">Companies</div><div class="v">${stats?.companies ?? '—'}</div></div>
  <div class="card"><div class="k">Categories</div><div class="v">${stats?.categories ?? '—'}</div></div>
  <div class="card"><div class="k">Price history</div><div class="v">${stats?.priceHistoryEntries ?? '—'}</div></div>
  <div class="card"><div class="k">Missing images</div><div class="v">${stats?.missingImages ?? '—'}</div></div>
  <div class="card"><div class="k">Needs re-check</div><div class="v">${stats?.needsRecheck ?? '—'}</div></div>
</div>
<p class="k">Data freshness: ${stats?.lastVerifiedAt ?? '—'} · Last crawl: ${stats?.lastScrapeRun ? String(stats.lastScrapeRun.run_id) : '—'}</p>
</main></body></html>`);
});

app.use('/api/v1', api);

/* ---------- Phase 7: dynamic sitemaps + robots ---------- */
app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const base = siteBase(req);
    const pages = Math.ceil((await Q.listMedicines({ page: 1, limit: 1 })).total / 20000);
    const companies = Math.ceil((await Q.listCompanies({ page: 1, limit: 1 })).total / 5000);
    const sitemaps = ['sitemap-static.xml', 'sitemap-companies-1.xml', 'sitemap-categories.xml'];
    for (let i = 1; i <= Math.max(1, pages); i++) sitemaps.push(`sitemap-medicines-${i}.xml`);
    void companies;
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.map((s) => `  <sitemap><loc>${base}/${s}</loc></sitemap>`).join('\n')}
</sitemapindex>`);
  } catch (e) { next(e); }
});
app.get(/^\/sitemap-(medicines|companies)-(\d+)\.xml$/, async (req, res, next) => {
  try {
    const base = siteBase(req);
    const kind = req.params[0];
    const part = Number(req.params[1]);
    const size = kind === 'medicines' ? 20000 : 5000;
    const offset = (part - 1) * size;
    const rows = kind === 'medicines'
      ? await pool.query('SELECT slug, updated_at FROM medicines ORDER BY id LIMIT $1 OFFSET $2', [size, offset])
      : await pool.query('SELECT slug, updated_at FROM companies ORDER BY id LIMIT $1 OFFSET $2', [size, offset]);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.rows.map((r: { slug: string; updated_at: string }) => `  <url><loc>${base}/${kind === 'medicines' ? 'm' : 'companies'}/${r.slug}</loc><lastmod>${new Date(r.updated_at).toISOString().slice(0, 10)}</lastmod></url>`).join('\n')}
</urlset>`);
  } catch (e) { next(e); }
});
app.get('/sitemap-categories.xml', async (req, res, next) => {
  try {
    const base = siteBase(req);
    const rows = await pool.query('SELECT slug FROM categories WHERE EXISTS (SELECT 1 FROM medicine_categories mc WHERE mc.category_id = categories.id) ORDER BY id LIMIT 10000');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.rows.map((r: { slug: string }) => `  <url><loc>${base}/categories/${r.slug}</loc></url>`).join('\n')}
</urlset>`);
  } catch (e) { next(e); }
});
app.get('/sitemap-static.xml', (req, res) => {
  const base = siteBase(req);
  const paths = ['/', '/search', '/companies', '/categories', '/offers', '/api-docs', '/about'];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${base}${p}</loc></url>`).join('\n')}
</urlset>`);
});
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\n\nSitemap: ${siteBase(req)}/sitemap.xml\n`);
});
function siteBase(req: Request): string {
  const proto = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const host = req.headers.host ?? `localhost:${config.PORT}`;
  return `${proto}://${host}`;
}

app.use('/api/v1', (req, res) => fail(res, 404, 'not_found', 'Unknown API endpoint. See /api/v1/openapi.json.'));

/* ---------- safe error handler (no stack traces, no credentials) ---------- */
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error('API error:', err instanceof Error ? err.message : err);
  if (res.headersSent) return;
  fail(res, 500, 'internal_error', 'An unexpected error occurred.');
});

const server = app.listen(config.PORT, () => {
  console.log(`Medora API listening on http://localhost:${config.PORT} (admin: ${config.adminEnabled ? 'enabled' : 'disabled'}, ingest: ${config.ingestEnabled ? 'enabled' : 'disabled'})`);
});

export { app, server };

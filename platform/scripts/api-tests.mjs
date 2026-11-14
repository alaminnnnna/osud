/* PART C — API integration tests against the live PostgreSQL-backed backend.
   Run: node scripts/api-tests.mjs  (server must be on :4000)
   Results appended to /tmp/api-test-results.txt for the report. */
import fs from 'node:fs';

const BASE = 'http://localhost:4000/api/v1';
const OUT = [];
const log = (s) => { console.log(s); OUT.push(s); };
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function j(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  let body = null;
  try { body = await res.json(); } catch { /* html or empty */ }
  return { res, body };
}

log('## PART C — API integration tests (live PostgreSQL backend on :4000)');
log('');

/* ---- 1. health / stats ---- */
{
  const { res, body } = await j('/health');
  check('GET /health → 200', res.status === 200);
  check('/health envelope + db connected', body?.success === true && body?.data?.database === 'connected');
  const { res: r2, body: b2 } = await j('/stats');
  check('GET /stats → 200', r2.status === 200);
  check('/stats medicines = 58297', b2?.data?.medicines === 58297, `got ${b2?.data?.medicines}`);
  check('/stats offers/companies present', b2?.data?.offers > 0 && b2?.data?.companies === 1414,
    `offers ${b2?.data?.offers}, companies ${b2?.data?.companies}`);
}

/* ---- 2. medicines list + pagination ---- */
{
  const { res, body } = await j('/medicines?page=2&limit=10&sort=name');
  check('GET /medicines → 200', res.status === 200);
  check('pagination block correct', body?.pagination?.page === 2 && body?.pagination?.limit === 10
    && body?.pagination?.total === 58297 && body?.pagination?.totalPages === Math.ceil(58297 / 10),
    JSON.stringify(body?.pagination));
  check('10 items with price objects', body?.data?.length === 10
    && body.data.every((m) => m.price && typeof m.price.regularSales !== 'undefined'));
  const { res: r2, body: b2 } = await j('/medicines?page=-5&limit=9999');
  check('invalid params clamped (page≥1, limit≤100)', r2.status === 200 && b2.pagination.page === 1 && b2.pagination.limit === 100,
    `page ${b2?.pagination?.page}, limit ${b2?.pagination?.limit}`);
  const { res: r3, body: b3 } = await j('/medicines?offer=1&sort=discount&limit=5');
  check('offer filter returns real discounts', r3.status === 200 && b3.data.every((m) => m.price.hasOffer === true)
    && b3.data.every((m) => m.price.offerSales < m.price.regularSales));
  const { res: r4 } = await j('/medicines?company=beximco&limit=5');
  check('company filter works', r4.status === 200);
}

/* ---- 3. medicine detail (slug + numeric id + 404) ---- */
{
  const { res, body } = await j('/medicines/napa-500-tablet');
  check('GET /medicines/:slug → 200', res.status === 200);
  check('Napa 500 detail fields', body?.data?.name === 'Napa 500' && (body?.data?.company ?? '').includes('Beximco')
    && body?.data?.price?.regularBase === 1.2 && body?.data?.price?.offerBase === 1.08
    && body?.data?.price?.regularSales === 12 && body?.data?.price?.offerSales === 10.8,
    JSON.stringify(body?.data?.price));
  check('sales unit label preserved', body?.data?.price?.salesUnit === 'Strip' && body?.data?.price?.baseUnit === 'Tablet');
  check('priceHistory + related + images arrays present', Array.isArray(body?.data?.priceHistory)
    && Array.isArray(body?.data?.related) && Array.isArray(body?.data?.images));
  check('verification status present', typeof body?.data?.verificationStatus === 'string');
  const { res: r2, body: b2 } = await j('/medicines/12474');
  check('numeric source-id lookup works', r2.status === 200 && b2?.data?.name === 'Napa 500');
  const { res: r3, body: b3 } = await j('/medicines/no-such-medicine-xyz');
  check('unknown slug → 404 envelope', r3.status === 404 && b3?.success === false && b3?.error?.code === 'not_found');
}

/* ---- 4. search + ranking + suggestions ---- */
{
  const { res, body } = await j('/search?q=napa&limit=10');
  check('GET /search?q=napa → 200', res.status === 200);
  check('exact match ranks first', body?.data?.items?.[0]?.slug === 'napa-500-tablet', `top: ${body?.data?.items?.[0]?.slug}`);
  check('search results paginated', body?.pagination?.total >= 20, `total ${body?.pagination?.total}`);
  const { body: b2 } = await j('/search?q=paracetmol&limit=5');
  check('typo tolerance (paracetmol → paracetamol generics)', b2?.data?.items?.length > 0
    && b2.data.items.every((m) => /paracetamol/i.test(m.genericName ?? '')), `${b2?.data?.items?.length} results`);
  const { body: b3 } = await j('/search?q=beximco&limit=5');
  check('company search works', b3?.data?.items?.length > 0 && b3.data.items.every((m) => (m.company ?? '').includes('Beximco')));
  const { body: b4 } = await j('/search?q=');
  check('empty q → browse mode, no crash', b4?.success === true && b4?.data?.mode === 'browse');
  const { body: b5 } = await j('/search/suggestions?q=na');
  check('suggestions products + terms', b5?.data?.products?.length > 0 && Array.isArray(b5?.data?.terms));
}

/* ---- 5. offers / companies / categories ---- */
{
  const { res, body } = await j('/offers?limit=10');
  check('GET /offers → 200, real discounts only', res.status === 200 && body.data.every(
    (m) => m.price.offerSales < m.price.regularSales));
  const { body: b2 } = await j('/companies?limit=5');
  check('companies list + counts', b2?.data?.length === 5 && b2.data.every((c) => c.productCount > 0));
  const { body: cl } = await j('/companies?limit=1');
  const topCompanySlug = cl?.data?.[0]?.slug;
  const { body: b3 } = await j(`/companies/${topCompanySlug}`);
  check('company detail with medicines', !!b3?.data?.name && b3?.data?.medicines?.length > 0,
    `${b3?.data?.name}: ${b3?.data?.medicines?.length} medicines`);
  const { body: b4 } = await j('/categories?limit=5');
  check('categories list', b4?.data?.length === 5 && b4.pagination.total >= 1000, `total ${b4?.pagination?.total}`);
  const { res: r5, body: b5 } = await j('/companies/no-such-company-xyz');
  check('unknown company → 404', r5.status === 404 && b5?.success === false);
}

/* ---- 6. price history endpoint ---- */
{
  const { res, body } = await j('/medicines/napa-500-tablet/price-history');
  check('GET /medicines/:slug/price-history → 200', res.status === 200);
  check('history shape', Array.isArray(body?.data?.history) && body.data.slug === 'napa-500-tablet',
    `${body?.data?.history?.length} entries (grows with ingestion test)`);
}

/* ---- 7. cache headers + CORS + content-type ---- */
{
  const res = await fetch(BASE + '/medicines?limit=1');
  check('Cache-Control on public lists', /public, max-age=60/.test(res.headers.get('cache-control') ?? ''),
    res.headers.get('cache-control'));
  check('X-RateLimit headers present', res.headers.get('x-ratelimit-limit') === '120');
  const cors = await fetch(BASE + '/health', { headers: { Origin: 'https://example.com' } });
  check('CORS origin reflected (*)', cors.headers.get('access-control-allow-origin') === '*');
  check('JSON content type', (res.headers.get('content-type') ?? '').includes('application/json'));
}

/* ---- 8. admin auth (before rate-limit test) ---- */
{
  const no = await fetch(BASE + '/admin/metrics');
  check('admin without auth → 401', no.status === 401);
  const auth = await fetch(BASE + '/admin/metrics', {
    headers: { Authorization: 'Basic ' + Buffer.from('admin:medora-admin-local').toString('base64') },
  });
  const ab = await auth.json();
  check('admin with Basic auth → 200 + metrics', auth.status === 200 && ab?.data?.stats?.medicines === 58297
    && Array.isArray(ab?.data?.imports));
  const page = await fetch('http://localhost:4000/admin', { headers: { Authorization: 'Basic ' + Buffer.from('admin:medora-admin-local').toString('base64') } });
  check('/admin dashboard HTML (auth)', page.status === 200 && (await page.text()).includes('Medora admin'));
}

/* ---- 9. ingestion auth + price-history recording (Phase 9, real DB writes) ---- */
{
  const denied = await fetch(BASE + '/ingest/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('ingest without token → 401', denied.status === 401);
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer local-test-token' };
  const runRes = await fetch(BASE + '/ingest/runs', {
    method: 'POST', headers: H,
    body: JSON.stringify({ runId: 'phase3-ingest-test', mode: 'test', status: 'completed', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), productsCollected: 1 }),
  });
  check('ingest run summary accepted', runRes.status === 200);

  // Real record-level ingestion: modify Napa 500's offer sales price → history row
  const db = await (async () => {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: 'postgres://medora@127.0.0.1:5433/medora' });
    await c.connect();
    return c;
  })();
  const med = (await db.query("SELECT id FROM medicines WHERE source_product_id = 12474")).rows[0];
  const beforeHist = (await db.query('SELECT count(*)::int AS c FROM price_history WHERE medicine_id = $1', [med.id])).rows[0].c;
  const rec = JSON.parse(fs.readFileSync('/home/z/my-project/download/bangladesh-medicine-price-database/data/products.jsonl', 'utf8').split('\n').find((l) => l.includes('"p_id":12474')));
  const ingested = await fetch(BASE + '/ingest/records', {
    method: 'POST', headers: H,
    body: JSON.stringify({ records: [{ ...rec, record: { ...rec.record, pv: rec.record.pv.map((v) => ({ ...v, pv_b2c_price: v.pv_is_base === 1 ? 9.99 : v.pv_b2c_price })) } }] }),
  });
  const ib = await ingested.json();
  check('ingest records accepted', ingested.status === 200 && ib?.data?.accepted === 1, JSON.stringify(ib?.data?.applied));
  const afterHist = (await db.query('SELECT count(*)::int AS c FROM price_history WHERE medicine_id = $1', [med.id])).rows[0].c;
  const current = (await db.query('SELECT offer_sales::text FROM medicine_prices WHERE medicine_id = $1', [med.id])).rows[0];
  check('price change recorded in history', afterHist === beforeHist + 1, `${beforeHist} → ${afterHist} entries`);
  check('current offer_sales updated to 9.99', current.offer_sales === '9.99', `got ${current.offer_sales}`);
  // restore original values via a second ingestion (append-only history grows by design)
  const restore = await fetch(BASE + '/ingest/records', { method: 'POST', headers: H, body: JSON.stringify({ records: [rec] }) });
  const rb = await restore.json();
  const finalHist = (await db.query('SELECT count(*)::int AS c FROM price_history WHERE medicine_id = $1', [med.id])).rows[0].c;
  const finalPrice = (await db.query('SELECT offer_sales::text FROM medicine_prices WHERE medicine_id = $1', [med.id])).rows[0];
  check('restore ingestion works (idempotent pipeline)', restore.status === 200 && finalPrice.offer_sales === '10.80',
    `final offer_sales ${finalPrice.offer_sales}, history now ${finalHist} entries`);
  await db.end();
}

/* ---- 10. safe DB-error handling (separate instance with unreachable DB) ---- */
{
  const { spawn } = await import('node:child_process');
  const env = { ...process.env, DATABASE_URL: 'postgres://bad:bad@127.0.0.1:59999/bad', PORT: '4001' };
  const proc = spawn('npx', ['tsx', 'src/server.ts'], { cwd: process.cwd(), env, stdio: 'ignore', detached: false });
  await new Promise((r) => setTimeout(r, 4000));
  try {
    const h = await fetch('http://localhost:4001/api/v1/health');
    check('health with unreachable DB → 503', h.status === 503);
    const m = await fetch('http://localhost:4001/api/v1/medicines?limit=1');
    const mb = await m.json().catch(() => null);
    check('query with unreachable DB → 500 safe envelope, no stack', m.status === 500
      && mb?.success === false && mb?.error?.message === 'An unexpected error occurred.');
  } catch (e) {
    check('error-instance reachable', false, e.message);
  } finally {
    proc.kill('SIGTERM');
  }
}

/* ---- 11. rate limiting (LAST — consumes the per-minute budget) ---- */
{
  let saw429 = false, headersOk = false;
  for (let i = 0; i < 130; i++) {
    const res = await fetch(BASE + '/health');
    if (res.status === 429) {
      saw429 = true;
      headersOk = res.headers.get('retry-after') === '60';
      break;
    }
  }
  check('rate limiting triggers 429 after 120/min', saw429, 'health endpoint burst');
  check('429 carries Retry-After', headersOk);
}

log('');
log(`SUMMARY: ${pass} passed, ${fail} failed`);
fs.writeFileSync('/tmp/api-test-results.txt', OUT.join('\n'));
process.exit(fail ? 1 : 0);

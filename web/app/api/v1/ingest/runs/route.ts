/* Medora — POST /api/v1/ingest/runs (unified app route handler).
   Bearer-token protected crawl-run summary persistence. */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withApi, preflight, ok, fail, requireIngestToken } from '@/lib/server/http';
import { pool } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

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

export async function POST(req: NextRequest) {
  return withApi(req, async () => {
    const denied = requireIngestToken(req);
    if (denied) return denied;

    let body: unknown;
    try { body = await req.json(); } catch { return fail(400, 'bad_request', 'Body must be valid JSON.'); }
    const parsed = RunSummary.safeParse(body);
    if (!parsed.success) return fail(400, 'bad_request', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
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
    return ok({ scrapeRunId: run.rows[0].id, runId: r.runId });
  });
}

export async function OPTIONS(req: NextRequest) { return preflight(req); }

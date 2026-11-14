/* Medora — POST /api/v1/ingest/records (unified app route handler).
   Bearer-token protected. Normalizes records with the exact validation rules
   the file importer uses, then applies the same idempotent, history-preserving
   batch upsert inside one transaction — ingestion can never corrupt data. */
import { NextRequest } from 'next/server';
import { withApi, preflight, ok, fail, requireIngestToken } from '@/lib/server/http';
import { normalize, type NormalizedRecord } from '@/lib/server/normalize';
import { getImportState, upsertBatch } from '@/lib/server/ingest';
import { withTransaction } from '@/lib/server/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  return withApi(req, async () => {
    const denied = requireIngestToken(req);
    if (denied) return denied;

    const contentLength = Number(req.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) return fail(413, 'too_large', 'Body too large (max 8MB).');

    let body: unknown;
    try { body = await req.json(); } catch { return fail(400, 'bad_request', 'Body must be valid JSON.'); }
    const records = Array.isArray((body as { records?: unknown[] })?.records) ? (body as { records: unknown[] }).records : null;
    if (!records) return fail(400, 'bad_request', 'Body must be { records: [...] }.');
    if (records.length > 5000) return fail(413, 'too_large', 'Batch too large (max 5000 records).');

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

    return ok({
      received: records.length,
      accepted: validRecs.length,
      rejected,
      applied: stats,
    });
  });
}

export async function OPTIONS(req: NextRequest) { return preflight(req); }

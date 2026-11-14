/* Medora — /api/v1/medicines/:key/price-history (unified app route handler). */
import { NextRequest } from 'next/server';
import { withApi, preflight, ok, fail } from '@/lib/server/http';
import * as Q from '@/lib/server/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return withApi(req, async () => {
    // Numeric source ids resolve to the full record (same shape as by-slug).
    const base = /^\d+$/.test(key)
      ? await (async () => {
          const byId = await Q.getMedicineBySourceId(Number(key));
          return byId ? await Q.getMedicineBySlug(String((byId as Record<string, unknown>).slug)) : null;
        })()
      : await Q.getMedicineBySlug(key);
    if (!base) return fail(404, 'not_found', 'No medicine found.');
    const info = base as Record<string, unknown>;
    return ok({ slug: info.slug, name: info.name, history: info.priceHistory ?? [] });
  });
}

export async function OPTIONS(req: NextRequest) { return preflight(req); }

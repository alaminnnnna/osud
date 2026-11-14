/* Medora — /api/v1/search (unified app route handler).
   PostgreSQL FTS + pg_trgm ranking — identical scoring to the audited API. */
import { NextRequest } from 'next/server';
import { withApi, preflight, boolParam, numParam, ok, pageParams, strOrNull, strParam } from '@/lib/server/http';
import { searchMedicines } from '@/lib/server/search';
import * as Q from '@/lib/server/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withApi(req, async () => {
    const sp = req.nextUrl.searchParams;
    const q = strParam(sp, 'q') ?? '';
    const { page, limit } = pageParams(sp);
    const result = await searchMedicines({
      q, page, limit,
      companySlug: strOrNull(sp, 'company'),
      categorySlug: strOrNull(sp, 'category'),
      form: strOrNull(sp, 'form'),
      type: strOrNull(sp, 'type'),
      rx: boolParam(sp.get('rx')),
      offer: boolParam(sp.get('offer')),
      minPrice: numParam(sp.get('min')),
      maxPrice: numParam(sp.get('max')),
    });
    return ok({ query: q, mode: result.mode, items: result.items }, Q.paginate(page, limit, result.total));
  });
}

export async function OPTIONS(req: NextRequest) { return preflight(req); }

/* Medora — /api/v1/medicines (unified app route handler). */
import { NextRequest } from 'next/server';
import { withApi, preflight, boolParam, numParam, ok, pageParams, strOrNull, strParam } from '@/lib/server/http';
import * as Q from '@/lib/server/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withApi(req, async () => {
    const sp = req.nextUrl.searchParams;
    const { page, limit } = pageParams(sp);
    const result = await Q.listMedicines({
      page, limit,
      sort: strParam(sp, 'sort'),
      companySlug: strOrNull(sp, 'company'),
      categorySlug: strOrNull(sp, 'category'),
      form: strOrNull(sp, 'form'),
      type: strOrNull(sp, 'type'),
      rx: boolParam(sp.get('rx')),
      offer: boolParam(sp.get('offer')),
      minPrice: numParam(sp.get('min')),
      maxPrice: numParam(sp.get('max')),
    });
    return ok(result.items, Q.paginate(page, limit, result.total));
  });
}

export async function OPTIONS(req: NextRequest) { return preflight(req); }

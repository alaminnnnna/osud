/* Medora — /api/v1/categories (unified app route handler). */
import { NextRequest } from 'next/server';
import { withApi, preflight, ok, pageParams, strParam } from '@/lib/server/http';
import * as Q from '@/lib/server/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withApi(req, async () => {
    const { page, limit } = pageParams(req.nextUrl.searchParams);
    const result = await Q.listCategories({ q: strParam(req.nextUrl.searchParams, 'q'), page, limit });
    return ok(result.items, Q.paginate(page, limit, result.total));
  });
}

export async function OPTIONS(req: NextRequest) { return preflight(req); }

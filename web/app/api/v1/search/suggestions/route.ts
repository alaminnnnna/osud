/* Medora — /api/v1/search/suggestions (unified app route handler). */
import { NextRequest } from 'next/server';
import { withApi, preflight, ok, strParam } from '@/lib/server/http';
import { suggestions } from '@/lib/server/search';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withApi(req, async () => {
    return ok(await suggestions(strParam(req.nextUrl.searchParams, 'q') ?? '', 8));
  });
}

export async function OPTIONS(req: NextRequest) { return preflight(req); }

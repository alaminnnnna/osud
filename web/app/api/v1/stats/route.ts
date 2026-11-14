/* Medora — /api/v1/stats (unified app route handler). */
import { NextRequest } from 'next/server';
import { withApi, preflight, ok } from '@/lib/server/http';
import { getStats } from '@/lib/server/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withApi(req, async () => ok(await getStats()));
}

export async function OPTIONS(req: NextRequest) { return preflight(req); }

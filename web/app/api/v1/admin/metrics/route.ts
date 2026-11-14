/* Medora — GET /api/v1/admin/metrics (unified app route handler).
   Basic-auth protected; same payload the admin dashboard renders. */
import { NextRequest } from 'next/server';
import { withApi, preflight, ok, requireAdmin } from '@/lib/server/http';
import { adminMetrics } from '@/lib/server/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withApi(req, async () => {
    const denied = requireAdmin(req);
    if (denied) return denied;
    return ok(await adminMetrics());
  });
}

export async function OPTIONS(req: NextRequest) { return preflight(req); }

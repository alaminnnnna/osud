/* Medora — /api/v1/health (unified app route handler). */
import { NextRequest, NextResponse } from 'next/server';
import { withApi, preflight } from '@/lib/server/http';
import { dbHealthy } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withApi(req, async () => {
    const db = await dbHealthy();
    return NextResponse.json(
      {
        success: db,
        data: {
          status: db ? 'ok' : 'degraded',
          database: db ? 'connected' : 'unreachable',
          time: new Date().toISOString(),
        },
      },
      { status: db ? 200 : 503, headers: { 'Cache-Control': 'public, max-age=15' } },
    );
  });
}

export async function OPTIONS(req: NextRequest) { return preflight(req); }

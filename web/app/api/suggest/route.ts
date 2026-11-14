/* Medora — search suggestions for the browser (unified app).
   Calls the shared service layer directly — no backend origin exists anymore. */
import { NextRequest, NextResponse } from 'next/server';
import { suggestions } from '@/lib/server/search';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const body = await suggestions(q, 8);
  return NextResponse.json({ success: true, data: body }, {
    headers: { 'Cache-Control': 'public, max-age=30' },
  });
}

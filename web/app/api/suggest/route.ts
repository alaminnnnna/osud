/* Medora — Next.js route handler proxying suggestions to the backend so the
   browser never talks to the backend origin directly. */
import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const upstream = await fetch(`${BACKEND_URL}/api/v1/search/suggestions?q=${encodeURIComponent(q)}`, {
    cache: 'no-store',
  });
  const body = await upstream.json();
  return NextResponse.json(body, {
    status: upstream.status,
    headers: { 'Cache-Control': 'public, max-age=30' },
  });
}

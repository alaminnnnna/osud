/* Medora — suggest proxy extension: single product by slug for the compare tray. */
import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug') ?? '';
  if (!slug) return NextResponse.json({ success: false, error: { code: 'bad_request', message: 'slug required' } }, { status: 400 });
  const upstream = await fetch(`${BACKEND_URL}/api/v1/medicines/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  const body = await upstream.json();
  if (!body?.success) return NextResponse.json({ success: true, data: {} });
  const d = body.data;
  return NextResponse.json({
    success: true,
    data: {
      product: {
        slug: d.slug,
        name: d.name,
        price: d.price?.offerSales ?? d.price?.regularSales ?? null,
        salesUnit: d.price?.salesUnit ?? null,
        regularBase: d.price?.regularBase,
        offerBase: d.price?.offerBase,
        regularSales: d.price?.regularSales,
        offerSales: d.price?.offerSales,
        baseUnit: d.price?.baseUnit,
        salesUnitMultiplier: d.price?.salesUnitMultiplier,
      },
    },
  });
}

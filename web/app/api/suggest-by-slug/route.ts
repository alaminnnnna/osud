/* Medora — single product by slug for the compare tray (unified app).
   Resolves through the same local API dispatch the pages use — identical
   envelopes and semantics, no second origin. */
import { NextRequest, NextResponse } from 'next/server';
import { api, type MedicineDetail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug') ?? '';
  if (!slug) return NextResponse.json({ success: false, error: { code: 'bad_request', message: 'slug required' } }, { status: 400 });
  const body = await api<MedicineDetail>(`/medicines/${encodeURIComponent(slug)}`).catch(() => null);
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

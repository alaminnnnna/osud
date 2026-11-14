/* Medora — /api/v1/companies/:slug (unified app route handler). */
import { NextRequest } from 'next/server';
import { withApi, preflight, ok, fail } from '@/lib/server/http';
import * as Q from '@/lib/server/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return withApi(req, async () => {
    const company = await Q.getCompanyBySlug(slug);
    if (!company) return fail(404, 'not_found', 'No company with that slug.');
    const medicines = await Q.listMedicines({ companySlug: slug, page: 1, limit: 100, sort: 'name' });
    return ok({ ...company, medicines: medicines.items });
  });
}

export async function OPTIONS(req: NextRequest) { return preflight(req); }

/* Medora — /api/v1/medicines/:key (unified app route handler).
   Numeric keys are stable source product ids (old links keep working);
   string keys are slugs. Old slugs resolve through slug_redirects. */
import { NextRequest } from 'next/server';
import { withApi, preflight, ok, fail } from '@/lib/server/http';
import { ApiError } from '@/lib/server/http';
import * as Q from '@/lib/server/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return withApi(req, async () => {
    try {
      if (/^\d+$/.test(key)) {
        const byId = await Q.getMedicineBySourceId(Number(key));
        if (byId) return ok(byId);
        const slug = await Q.resolveSlugRedirect(key);
        if (slug) return ok({ redirect: slug });
        return fail(404, 'not_found', 'No medicine with that id.');
      }
      const redirect = await Q.resolveSlugRedirect(key);
      if (redirect) return ok({ redirect });
      const med = await Q.getMedicineBySlug(key);
      if (!med) return fail(404, 'not_found', 'No medicine with that slug.');
      return ok(med);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw e;
    }
  });
}

export async function OPTIONS(req: NextRequest) { return preflight(req); }

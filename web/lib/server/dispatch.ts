/* Medora — local API dispatcher (server-only).
   Server components call the same business functions the /api/v1 route
   handlers use — no HTTP hop, no second origin. Path parsing mirrors the
   route handlers so every caller of lib/api.ts gets identical envelopes. */
import { ApiError, boolParam, numParam, okBody, pageParams, strOrNull, strParam } from './http';
import { dbHealthy } from './db';
import { searchMedicines, suggestions } from './search';
import * as Q from './queries';
import { adminMetrics } from './admin';

/** Handle a GET-style API path with query params, returning the envelope body. */
export async function localApi(path: string, sp: URLSearchParams): Promise<unknown> {
  const clean = path.replace(/\/+$/, '') || '/';
  const segs = clean.split('/').filter(Boolean);
  const { page, limit } = pageParams(sp);

  // /search/suggestions must be checked before /search
  if (clean === '/search/suggestions') {
    return okBody(await suggestions(strParam(sp, 'q') ?? '', 8));
  }
  if (clean === '/search') {
    const result = await searchMedicines({
      q: strParam(sp, 'q') ?? '', page, limit,
      companySlug: strOrNull(sp, 'company'),
      categorySlug: strOrNull(sp, 'category'),
      form: strOrNull(sp, 'form'),
      type: strOrNull(sp, 'type'),
      rx: boolParam(sp.get('rx')),
      offer: boolParam(sp.get('offer')),
      minPrice: numParam(sp.get('min')),
      maxPrice: numParam(sp.get('max')),
    });
    return okBody({ query: strParam(sp, 'q') ?? '', mode: result.mode, items: result.items }, Q.paginate(page, limit, result.total));
  }
  if (clean === '/medicines') {
    const result = await Q.listMedicines({
      page, limit,
      sort: strParam(sp, 'sort'),
      companySlug: strOrNull(sp, 'company'),
      categorySlug: strOrNull(sp, 'category'),
      form: strOrNull(sp, 'form'),
      type: strOrNull(sp, 'type'),
      rx: boolParam(sp.get('rx')),
      offer: boolParam(sp.get('offer')),
      minPrice: numParam(sp.get('min')),
      maxPrice: numParam(sp.get('max')),
    });
    return okBody(result.items, Q.paginate(page, limit, result.total));
  }
  if (segs[0] === 'medicines' && segs.length === 2 && segs[1]) {
    const key = segs[1];
    if (/^\d+$/.test(key)) {
      const byId = await Q.getMedicineBySourceId(Number(key));
      if (byId) return okBody(byId);
      const slug = await Q.resolveSlugRedirect(key);
      if (slug) return okBody({ redirect: slug });
      throw new ApiError(404, 'not_found', 'No medicine with that id.');
    }
    const redirect = await Q.resolveSlugRedirect(key);
    if (redirect) return okBody({ redirect });
    const med = await Q.getMedicineBySlug(key);
    if (!med) throw new ApiError(404, 'not_found', 'No medicine with that slug.');
    return okBody(med);
  }
  if (segs[0] === 'medicines' && segs.length === 3 && segs[2] === 'price-history' && segs[1]) {
    const key = segs[1];
    const base = /^\d+$/.test(key)
      ? await (async () => {
          const byId = await Q.getMedicineBySourceId(Number(key));
          return byId ? await Q.getMedicineBySlug(String((byId as Record<string, unknown>).slug)) : null;
        })()
      : await Q.getMedicineBySlug(key);
    if (!base) throw new ApiError(404, 'not_found', 'No medicine found.');
    const info = base as Record<string, unknown>;
    return okBody({ slug: info.slug, name: info.name, history: info.priceHistory ?? [] });
  }
  if (clean === '/offers') {
    const result = await Q.listOffers({ page, limit, sort: strParam(sp, 'sort') });
    return okBody(result.items, Q.paginate(page, limit, result.total));
  }
  if (clean === '/companies') {
    const result = await Q.listCompanies({ q: strParam(sp, 'q'), page, limit });
    return okBody(result.items, Q.paginate(page, limit, result.total));
  }
  if (segs[0] === 'companies' && segs.length === 2 && segs[1]) {
    const company = await Q.getCompanyBySlug(segs[1]);
    if (!company) throw new ApiError(404, 'not_found', 'No company with that slug.');
    const medicines = await Q.listMedicines({ companySlug: segs[1], page: 1, limit: 100, sort: 'name' });
    return okBody({ ...company, medicines: medicines.items });
  }
  if (clean === '/categories') {
    const result = await Q.listCategories({ q: strParam(sp, 'q'), page, limit });
    return okBody(result.items, Q.paginate(page, limit, result.total));
  }
  if (segs[0] === 'categories' && segs.length === 2 && segs[1]) {
    const category = await Q.getCategoryBySlug(segs[1]);
    if (!category) throw new ApiError(404, 'not_found', 'No category with that slug.');
    const medicines = await Q.listMedicines({ categorySlug: segs[1], page: 1, limit: 100, sort: 'name' });
    return okBody({ ...category, medicines: medicines.items });
  }
  if (clean === '/stats') {
    return okBody(await Q.getStats());
  }
  if (clean === '/health') {
    const db = await dbHealthy();
    if (!db) throw new ApiError(503, 'degraded', 'Database unreachable.');
    return okBody({ status: 'ok', database: 'connected', time: new Date().toISOString() });
  }
  if (clean === '/admin/metrics') {
    return okBody(await adminMetrics());
  }
  throw new ApiError(404, 'not_found', 'Unknown API endpoint. See /api-docs.');
}

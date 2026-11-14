/* Medora — database query services for the REST API (Phase 4).
   All queries are paginated server-side and return plain rows that the API
   layer wraps in the standard envelope. */
import { query } from './db.js';
import type { SearchFilters } from './search.js';

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function paginate(page: number, limit: number, total: number): Pagination {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export function rowToMedicine(r: Record<string, unknown>): Record<string, unknown> {
  const rb = r.regularBase != null ? Number(r.regularBase) : null;
  const ob = r.offerBase != null ? Number(r.offerBase) : null;
  const rs = r.regularSales != null ? Number(r.regularSales) : null;
  const os = r.offerSales != null ? Number(r.offerSales) : null;
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    nameBn: r.nameBn ?? null,
    generic: r.genericName ?? null,
    company: r.company ?? null,
    companySlug: r.companySlug ?? null,
    strength: r.strength ?? null,
    form: r.dosageForm ?? null,
    productType: r.productType ?? null,
    prescriptionRequired: r.prescriptionRequired === true,
    verificationStatus: r.verificationStatus ?? null,
    price: {
      regularBase: rb, offerBase: ob, regularSales: rs, offerSales: os,
      // offer is real only when it is genuinely below regular — never invented
      hasOffer: (ob != null && rb != null && ob < rb) || (os != null && rs != null && os < rs),
      discountPercent: r.discountPercent != null ? Number(r.discountPercent) : null,
      baseUnit: r.baseUnit ?? null,
      salesUnit: r.salesUnit ?? null,
      salesUnitMultiplier: r.salesUnitMultiplier != null ? Number(r.salesUnitMultiplier) : null,
    },
    image: r.image ?? null,
    sourceUrl: r.sourceUrl ?? `https://www.arogga.com/product/${r.sourceProductId}/${r.slug}`,
    lastVerifiedAt: r.lastVerifiedAt ?? null,
    updatedAt: r.updatedAt ?? null,
  };
}

const MEDICINE_SELECT = `
  SELECT m.id, m.slug, m.source_product_id AS "sourceProductId", m.name, m.name_bn AS "nameBn",
         m.generic_name AS "genericName", m.strength, m.dosage_form AS "dosageForm",
         m.product_type AS "productType", m.prescription_required AS "prescriptionRequired",
         m.verification_status AS "verificationStatus", m.missing_fields AS "missingFields",
         m.min_qty AS "minQty", m.max_qty AS "maxQty", m.source_url AS "sourceUrl",
         m.last_verified_at AS "lastVerifiedAt", m.updated_at AS "updatedAt",
         c.name AS company, c.slug AS "companySlug",
         p.regular_base AS "regularBase", p.offer_base AS "offerBase",
         p.regular_sales AS "regularSales", p.offer_sales AS "offerSales",
         p.discount_percent AS "discountPercent", p.base_unit AS "baseUnit", p.sales_unit AS "salesUnit",
         p.sales_unit_multiplier AS "salesUnitMultiplier",
         (SELECT url FROM product_images i WHERE i.medicine_id = m.id AND i.available ORDER BY is_primary DESC LIMIT 1) AS image
  FROM medicines m
  LEFT JOIN companies c ON c.id = m.company_id
  LEFT JOIN medicine_prices p ON p.medicine_id = m.id`;

export async function listMedicines(opts: SearchFilters & { page: number; limit: number; sort?: string }) {
  const params: unknown[] = [];
  const cond: string[] = ["m.verification_status <> 'FAILED'"];
  if (opts.companySlug) { params.push(opts.companySlug); cond.push(`c.slug = $${params.length}`); }
  if (opts.categorySlug) { params.push(opts.categorySlug); cond.push(`EXISTS (
      SELECT 1 FROM medicine_categories mc JOIN categories cat ON cat.id = mc.category_id
      WHERE mc.medicine_id = m.id AND cat.slug = $${params.length})`); }
  if (opts.form) { params.push(opts.form); cond.push(`lower(m.dosage_form) = lower($${params.length})`); }
  if (opts.type) { params.push(opts.type); cond.push(`lower(m.product_type) = lower($${params.length})`); }
  if (opts.rx) cond.push('m.prescription_required = true');
  if (opts.offer) cond.push(`(p.offer_sales < p.regular_sales) OR (p.offer_base < p.regular_base)`);
  if (opts.minPrice != null) { params.push(opts.minPrice); cond.push(`COALESCE(p.offer_sales, p.regular_sales) >= $${params.length}`); }
  if (opts.maxPrice != null) { params.push(opts.maxPrice); cond.push(`COALESCE(p.offer_sales, p.regular_sales) <= $${params.length}`); }
  const where = cond.join(' AND ');

  const total = Number((await query<{ ct: string }>(
    `SELECT count(*) AS ct FROM medicines m
     LEFT JOIN companies c ON c.id = m.company_id
     LEFT JOIN medicine_prices p ON p.medicine_id = m.id WHERE ${where}`, params,
  )).rows[0].ct);

  const orderBy = {
    'price-asc': 'COALESCE(p.offer_sales, p.regular_sales) ASC NULLS LAST, m.name',
    'price-desc': 'COALESCE(p.offer_sales, p.regular_sales) DESC NULLS LAST, m.name',
    'discount': 'p.discount_percent DESC NULLS LAST, m.name',
    'recent': 'm.last_verified_at DESC NULLS LAST, m.id DESC',
    'name': 'm.name ASC',
  }[opts.sort ?? 'name'] ?? 'm.name ASC';

  const listParams = [...params, opts.limit, (opts.page - 1) * opts.limit];
  const rows = await query(`${MEDICINE_SELECT} WHERE ${where} ORDER BY ${orderBy} LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`, listParams);
  return { items: rows.rows.map(rowToMedicine), total };
}

export async function getMedicineBySlug(slug: string) {
  const rows = await query(`${MEDICINE_SELECT} WHERE m.slug = $1 LIMIT 1`, [slug]);
  if (!rows.rows.length) return null;
  const med = rowToMedicine(rows.rows[0]);
  const history = await query(
    `SELECT id, regular_base AS "regularBase", offer_base AS "offerBase",
            regular_sales AS "regularSales", offer_sales AS "offerSales",
            changed_fields AS "changedFields", recorded_at AS "recordedAt"
     FROM price_history WHERE medicine_id = $1 ORDER BY recorded_at DESC LIMIT 50`,
    [rows.rows[0].id],
  );
  const images = await query(
    `SELECT url, title, is_primary AS "isPrimary", available FROM product_images
     WHERE medicine_id = $1 ORDER BY is_primary DESC LIMIT 10`,
    [rows.rows[0].id],
  );
  const related = await query(
    `SELECT m.slug, m.name, m.generic_name AS "genericName", COALESCE(p.offer_sales, p.regular_sales) AS price
     FROM medicines m LEFT JOIN medicine_prices p ON p.medicine_id = m.id
     WHERE m.id <> $1 AND m.generic_name IS NOT NULL AND m.generic_name = (SELECT generic_name FROM medicines WHERE id = $1)
     ORDER BY m.last_verified_at DESC NULLS LAST LIMIT 8`,
    [rows.rows[0].id],
  );
  return { ...med, priceHistory: history.rows, images: images.rows, related: related.rows };
}

export async function getMedicineBySourceId(id: number) {
  const rows = await query(`${MEDICINE_SELECT} WHERE m.source_product_id = $1 LIMIT 1`, [id]);
  return rows.rows.length ? rowToMedicine(rows.rows[0]) : null;
}

export async function listOffers(opts: { page: number; limit: number; sort?: string }) {
  const where = `p.offer_sales IS NOT NULL AND p.regular_sales IS NOT NULL AND p.offer_sales < p.regular_sales`;
  const total = Number((await query<{ ct: string }>(
    `SELECT count(*) AS ct FROM medicines m JOIN medicine_prices p ON p.medicine_id = m.id WHERE ${where}`,
  )).rows[0].ct);
  const orderBy = { 'discount': 'p.discount_percent DESC NULLS LAST', 'recent': 'm.last_verified_at DESC NULLS LAST', 'price-asc': 'p.offer_sales ASC' }[opts.sort ?? 'discount'] ?? 'p.discount_percent DESC NULLS LAST';
  const rows = await query(
    `${MEDICINE_SELECT} WHERE ${where}
     ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
    [opts.limit, (opts.page - 1) * opts.limit],
  );
  return { items: rows.rows.map(rowToMedicine), total };
}

export async function listCompanies(opts: { q?: string; page: number; limit: number }) {
  const params: unknown[] = [];
  let where = 'TRUE';
  if (opts.q) { params.push('%' + opts.q.replace(/[%_]/g, '') + '%'); where = `c.name ILIKE $${params.length}`; }
  const total = Number((await query<{ ct: string }>(`SELECT count(*) AS ct FROM companies c WHERE ${where}`, params)).rows[0].ct);
  const listParams = [...params, opts.limit, (opts.page - 1) * opts.limit];
  const rows = await query(
    `SELECT c.id, c.slug, c.name, count(m.id) AS "productCount"
     FROM companies c LEFT JOIN medicines m ON m.company_id = c.id
     WHERE ${where}
     GROUP BY c.id, c.slug, c.name
     HAVING count(m.id) > 0
     ORDER BY count(m.id) DESC, c.name
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );
  return { items: rows.rows, total };
}

export async function getCompanyBySlug(slug: string) {
  const rows = await query(
    `SELECT c.id, c.slug, c.name, count(m.id) AS "productCount"
     FROM companies c LEFT JOIN medicines m ON m.company_id = c.id
     WHERE c.slug = $1 GROUP BY c.id, c.slug, c.name LIMIT 1`,
    [slug],
  );
  return rows.rows[0] ?? null;
}

export async function listCategories(opts: { q?: string; page: number; limit: number }) {
  const params: unknown[] = [];
  let where = 'TRUE';
  if (opts.q) { params.push('%' + opts.q.replace(/[%_]/g, '') + '%'); where = `cat.name ILIKE $${params.length}`; }
  const total = Number((await query<{ ct: string }>(
    `SELECT count(*) AS ct FROM categories cat WHERE ${where} AND EXISTS (SELECT 1 FROM medicine_categories mc WHERE mc.category_id = cat.id)`,
    params,
  )).rows[0].ct);
  const listParams = [...params, opts.limit, (opts.page - 1) * opts.limit];
  const rows = await query(
    `SELECT cat.id, cat.slug, cat.name, cat.type, count(mc.medicine_id) AS "productCount"
     FROM categories cat JOIN medicine_categories mc ON mc.category_id = cat.id
     WHERE ${where}
     GROUP BY cat.id, cat.slug, cat.name, cat.type
     ORDER BY count(mc.medicine_id) DESC, cat.name
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );
  return { items: rows.rows, total };
}

export async function getCategoryBySlug(slug: string) {
  const rows = await query(
    `SELECT cat.id, cat.slug, cat.name, cat.type, count(mc.medicine_id) AS "productCount"
     FROM categories cat LEFT JOIN medicine_categories mc ON mc.category_id = cat.id
     WHERE cat.slug = $1 GROUP BY cat.id, cat.slug, cat.name, cat.type LIMIT 1`,
    [slug],
  );
  return rows.rows[0] ?? null;
}

export async function getStats() {
  const r = await query<{
    medicines: string; verified: string; offers: string; companies: string; categories: string;
    history: string; missingImages: string; needsRecheck: string;
  }>(`
    SELECT
      (SELECT count(*) FROM medicines) AS medicines,
      (SELECT count(*) FROM medicines WHERE verification_status = 'VERIFIED') AS verified,
      (SELECT count(*) FROM medicine_prices WHERE offer_sales < regular_sales) AS offers,
      (SELECT count(*) FROM companies) AS companies,
      (SELECT count(*) FROM categories) AS categories,
      (SELECT count(*) FROM price_history) AS history,
      (SELECT count(*) FROM medicines WHERE 'image missing' = ANY(missing_fields)) AS "missingImages",
      (SELECT count(*) FROM medicines WHERE verification_status = 'NEEDS_RECHECK') AS "needsRecheck"
  `);
  const freshness = await query<{ last_verified_at: string | null }>(
    'SELECT max(last_verified_at) AS last_verified_at FROM medicines',
  );
  const lastRun = await query(
    `SELECT run_id, mode, status, started_at, finished_at, products_collected AS "productsCollected",
            coverage_pct AS "coveragePct", full_coverage AS "fullCoverage"
     FROM scrape_runs ORDER BY started_at DESC LIMIT 1`,
  );
  const toNum = (v: unknown) => Number(v);
  return {
    medicines: toNum(r.rows[0].medicines),
    verified: toNum(r.rows[0].verified),
    offers: toNum(r.rows[0].offers),
    companies: toNum(r.rows[0].companies),
    categories: toNum(r.rows[0].categories),
    priceHistoryEntries: toNum(r.rows[0].history),
    missingImages: toNum(r.rows[0].missingImages),
    needsRecheck: toNum(r.rows[0].needsRecheck),
    lastVerifiedAt: freshness.rows[0].last_verified_at,
    lastScrapeRun: lastRun.rows[0] ?? null,
  };
}

/** Old-slug 301 support (Phase 7). */
export async function resolveSlugRedirect(slug: string): Promise<string | null> {
  const r = await query<{ new_slug: string }>('SELECT new_slug FROM slug_redirects WHERE old_slug = $1', [slug]);
  return r.rows[0]?.new_slug ?? null;
}

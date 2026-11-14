/* Medora — database query services for the unified app (server-only).
   SQLite implementation: same response shapes as the audited PostgreSQL
   version. All queries are paginated server-side and return plain rows that
   the API layer wraps in the standard envelope. */
import { query, all, get, type SqliteClient } from './db';
import type { SearchFilters } from './search';

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function paginate(page: number, limit: number, total: number): Pagination {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export function rowToMedicine(r: Record<string, unknown>): Record<string, unknown> {
  const rb = num(r.regularBase);
  const ob = num(r.offerBase);
  const rs = num(r.regularSales);
  const os = num(r.offerSales);
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
    // SQLite booleans arrive as 0/1
    prescriptionRequired: r.prescriptionRequired === true || r.prescriptionRequired === 1,
    verificationStatus: r.verificationStatus ?? null,
    price: {
      regularBase: rb, offerBase: ob, regularSales: rs, offerSales: os,
      // offer is real only when it is genuinely below regular — never invented
      hasOffer: (ob != null && rb != null && ob < rb) || (os != null && rs != null && os < rs),
      discountPercent: num(r.discountPercent),
      baseUnit: r.baseUnit ?? null,
      salesUnit: r.salesUnit ?? null,
      salesUnitMultiplier: num(r.salesUnitMultiplier),
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
         (SELECT url FROM product_images i WHERE i.medicine_id = m.id AND i.available = 1 ORDER BY is_primary DESC LIMIT 1) AS image
  FROM medicines m
  LEFT JOIN companies c ON c.id = m.company_id
  LEFT JOIN medicine_prices p ON p.medicine_id = m.id`;

export async function listMedicines(opts: SearchFilters & { page: number; limit: number; sort?: string }) {
  const params: unknown[] = [];
  const cond: string[] = ["m.verification_status <> 'FAILED'"];
  if (opts.companySlug) { params.push(opts.companySlug); cond.push(`c.slug = ?`); }
  if (opts.categorySlug) { params.push(opts.categorySlug); cond.push(`EXISTS (
      SELECT 1 FROM medicine_categories mc JOIN categories cat ON cat.id = mc.category_id
      WHERE mc.medicine_id = m.id AND cat.slug = ?)`); }
  if (opts.form) { params.push(opts.form); cond.push(`lower(m.dosage_form) = lower(?)`); }
  if (opts.type) { params.push(opts.type); cond.push(`lower(m.product_type) = lower(?)`); }
  if (opts.rx) cond.push('m.prescription_required = 1');
  if (opts.offer) cond.push(`(p.offer_sales < p.regular_sales) OR (p.offer_base < p.regular_base)`);
  if (opts.minPrice != null) { params.push(opts.minPrice); cond.push(`COALESCE(p.offer_sales, p.regular_sales) >= ?`); }
  if (opts.maxPrice != null) { params.push(opts.maxPrice); cond.push(`COALESCE(p.offer_sales, p.regular_sales) <= ?`); }
  const where = cond.join(' AND ');

  const total = Number(get<{ ct: number }>(
    `SELECT count(*) AS ct FROM medicines m
     LEFT JOIN companies c ON c.id = m.company_id
     LEFT JOIN medicine_prices p ON p.medicine_id = m.id WHERE ${where}`, params,
  )?.ct ?? 0);

  const orderBy = {
    'price-asc': 'COALESCE(p.offer_sales, p.regular_sales) ASC, m.name',
    'price-desc': 'COALESCE(p.offer_sales, p.regular_sales) DESC, m.name',
    'discount': 'p.discount_percent DESC, m.name',
    'recent': 'm.last_verified_at DESC, m.id DESC',
    'name': 'm.name COLLATE NOCASE ASC',
  }[opts.sort ?? 'name'] ?? 'm.name COLLATE NOCASE ASC';

  const rows = query(`${MEDICINE_SELECT} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...params, opts.limit, (opts.page - 1) * opts.limit]);
  return { items: rows.rows.map(rowToMedicine), total };
}

export async function getMedicineBySlug(slug: string) {
  const row = get<Record<string, unknown>>(`${MEDICINE_SELECT} WHERE m.slug = ? LIMIT 1`, [slug]);
  if (!row) return null;
  const med = rowToMedicine(row);
  const history = all<Record<string, unknown>>(
    `SELECT id,
            CAST(regular_base AS TEXT) AS "regularBase", CAST(offer_base AS TEXT) AS "offerBase",
            CAST(regular_sales AS TEXT) AS "regularSales", CAST(offer_sales AS TEXT) AS "offerSales",
            changed_fields AS "changedFieldsRaw", recorded_at AS "recordedAt"
     FROM price_history WHERE medicine_id = ? ORDER BY recorded_at DESC LIMIT 50`,
    [row.id as number],
  ).map((h) => ({ ...h, changedFields: JSON.parse(String(h.changedFieldsRaw ?? '[]')) as string[], changedFieldsRaw: undefined }));
  const images = all<Record<string, unknown>>(
    `SELECT url, title, is_primary AS "isPrimary", available FROM product_images
     WHERE medicine_id = ? ORDER BY is_primary DESC LIMIT 10`,
    [row.id as number],
  );
  const related = all<Record<string, unknown>>(
    `SELECT m.slug, m.name, m.generic_name AS "genericName", COALESCE(p.offer_sales, p.regular_sales) AS price
     FROM medicines m LEFT JOIN medicine_prices p ON p.medicine_id = m.id
     WHERE m.id <> ? AND m.generic_name IS NOT NULL
       AND m.generic_name = (SELECT generic_name FROM medicines WHERE id = ?)
     ORDER BY m.last_verified_at DESC LIMIT 8`,
    [row.id as number, row.id as number],
  );
  return { ...med, priceHistory: history, images, related };
}

export async function getMedicineBySourceId(id: number) {
  const row = get<Record<string, unknown>>(`${MEDICINE_SELECT} WHERE m.source_product_id = ? LIMIT 1`, [id]);
  return row ? rowToMedicine(row) : null;
}

export async function listOffers(opts: { page: number; limit: number; sort?: string }) {
  const where = `p.offer_sales IS NOT NULL AND p.regular_sales IS NOT NULL AND p.offer_sales < p.regular_sales`;
  const total = Number(get<{ ct: number }>(
    `SELECT count(*) AS ct FROM medicines m JOIN medicine_prices p ON p.medicine_id = m.id WHERE ${where}`,
  )?.ct ?? 0);
  const orderBy = { 'discount': 'p.discount_percent DESC', 'recent': 'm.last_verified_at DESC', 'price-asc': 'p.offer_sales ASC' }[opts.sort ?? 'discount'] ?? 'p.discount_percent DESC';
  const rows = query(
    `${MEDICINE_SELECT} WHERE ${where}
     ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [opts.limit, (opts.page - 1) * opts.limit],
  );
  return { items: rows.rows.map(rowToMedicine), total };
}

export async function listCompanies(opts: { q?: string; page: number; limit: number }) {
  const params: unknown[] = [];
  let where = '1=1';
  if (opts.q) { params.push('%' + opts.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%'); where = `c.name LIKE ? ESCAPE '\\'`; }
  const total = Number(get<{ ct: number }>(`SELECT count(*) AS ct FROM companies c WHERE ${where}`, params)?.ct ?? 0);
  const rows = all<Record<string, unknown>>(
    `SELECT c.id, c.slug, c.name, count(m.id) AS "productCount"
     FROM companies c LEFT JOIN medicines m ON m.company_id = c.id
     WHERE ${where}
     GROUP BY c.id, c.slug, c.name
     HAVING count(m.id) > 0
     ORDER BY count(m.id) DESC, c.name COLLATE NOCASE
     LIMIT ? OFFSET ?`,
    [...params, opts.limit, (opts.page - 1) * opts.limit],
  );
  return { items: rows, total };
}

export async function getCompanyBySlug(slug: string) {
  return get<Record<string, unknown>>(
    `SELECT c.id, c.slug, c.name, count(m.id) AS "productCount"
     FROM companies c LEFT JOIN medicines m ON m.company_id = c.id
     WHERE c.slug = ? GROUP BY c.id, c.slug, c.name LIMIT 1`,
    [slug],
  ) ?? null;
}

export async function listCategories(opts: { q?: string; page: number; limit: number }) {
  const params: unknown[] = [];
  let where = '1=1';
  if (opts.q) { params.push('%' + opts.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%'); where = `cat.name LIKE ? ESCAPE '\\'`; }
  const total = Number(get<{ ct: number }>(
    `SELECT count(*) AS ct FROM categories cat WHERE ${where} AND EXISTS (SELECT 1 FROM medicine_categories mc WHERE mc.category_id = cat.id)`,
    params,
  )?.ct ?? 0);
  const rows = all<Record<string, unknown>>(
    `SELECT cat.id, cat.slug, cat.name, cat.type, count(mc.medicine_id) AS "productCount"
     FROM categories cat JOIN medicine_categories mc ON mc.category_id = cat.id
     WHERE ${where}
     GROUP BY cat.id, cat.slug, cat.name, cat.type
     ORDER BY count(mc.medicine_id) DESC, cat.name COLLATE NOCASE
     LIMIT ? OFFSET ?`,
    [...params, opts.limit, (opts.page - 1) * opts.limit],
  );
  return { items: rows, total };
}

export async function getCategoryBySlug(slug: string) {
  return get<Record<string, unknown>>(
    `SELECT cat.id, cat.slug, cat.name, cat.type, count(mc.medicine_id) AS "productCount"
     FROM categories cat LEFT JOIN medicine_categories mc ON mc.category_id = cat.id
     WHERE cat.slug = ? GROUP BY cat.id, cat.slug, cat.name, cat.type LIMIT 1`,
    [slug],
  ) ?? null;
}

export async function getStats() {
  const r = get<Record<string, unknown>>(`
    SELECT
      (SELECT count(*) FROM medicines) AS medicines,
      (SELECT count(*) FROM medicines WHERE verification_status = 'VERIFIED') AS verified,
      (SELECT count(*) FROM medicine_prices WHERE offer_sales < regular_sales) AS offers,
      (SELECT count(*) FROM companies) AS companies,
      (SELECT count(*) FROM categories) AS categories,
      (SELECT count(*) FROM price_history) AS history,
      (SELECT count(*) FROM medicines WHERE EXISTS (
         SELECT 1 FROM json_each(medicines.missing_fields) WHERE json_each.value = 'image missing')) AS "missingImages",
      (SELECT count(*) FROM medicines WHERE verification_status = 'NEEDS_RECHECK') AS "needsRecheck"
  `) ?? {};
  const freshness = get<{ last_verified_at: string | null }>(
    'SELECT max(last_verified_at) AS last_verified_at FROM medicines',
  );
  const lastRun = get<Record<string, unknown>>(
    `SELECT run_id, mode, status, started_at, finished_at, products_collected AS "productsCollected",
            coverage_pct AS "coveragePct", full_coverage AS "fullCoverage"
     FROM scrape_runs ORDER BY started_at DESC LIMIT 1`,
  );
  const toNum = (v: unknown) => Number(v ?? 0);
  return {
    medicines: toNum(r.medicines),
    verified: toNum(r.verified),
    offers: toNum(r.offers),
    companies: toNum(r.companies),
    categories: toNum(r.categories),
    priceHistoryEntries: toNum(r.history),
    missingImages: toNum(r.missingImages),
    needsRecheck: toNum(r.needsRecheck),
    lastVerifiedAt: freshness?.last_verified_at ?? null,
    lastScrapeRun: lastRun
      ? { ...lastRun, fullCoverage: (lastRun.fullCoverage === 1 || lastRun.fullCoverage === true) }
      : null,
  };
}

/** Old-slug 301 support. */
export async function resolveSlugRedirect(slug: string): Promise<string | null> {
  const r = get<{ new_slug: string }>('SELECT new_slug FROM slug_redirects WHERE old_slug = ?', [slug]);
  return r?.new_slug ?? null;
}

export type { SqliteClient };

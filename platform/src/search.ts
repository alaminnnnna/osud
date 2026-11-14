/* Medora — server-side search (Phase 5).
   PostgreSQL FTS (simple/english dictionary) + pg_trgm fuzzy matching with a
   deterministic ranking expression:

     1000 exact name  ·  800 exact company  ·  600 name prefix  ·
     400 strong partial (name/generic)  ·  200×similarity fuzzy  ·
     100×ts_rank lexical  ·  150 partial company match

   All of it runs in the database — the catalogue is never shipped to clients. */
import { query } from './db.js';
import { rowToMedicine } from './queries.js';

export interface SearchFilters {
  companySlug?: string | null;
  categorySlug?: string | null;
  form?: string | null;
  type?: string | null;
  rx?: boolean;
  offer?: boolean;
  minPrice?: number | null;
  maxPrice?: number | null;
}

export interface SearchParams extends SearchFilters {
  q: string;
  page: number;
  limit: number;
}

const BASE_SELECT = `
  FROM medicines m
  LEFT JOIN companies c ON c.id = m.company_id
  LEFT JOIN medicine_prices p ON p.medicine_id = m.id`;

function filterConditions(f: SearchFilters, params: unknown[]): string {
  const cond: string[] = ["m.verification_status <> 'FAILED'"];
  if (f.companySlug) { params.push(f.companySlug); cond.push(`c.slug = $${params.length}`); }
  if (f.categorySlug) { params.push(f.categorySlug); cond.push(`EXISTS (
      SELECT 1 FROM medicine_categories mc JOIN categories cat ON cat.id = mc.category_id
      WHERE mc.medicine_id = m.id AND cat.slug = $${params.length})`); }
  if (f.form) { params.push(f.form); cond.push(`lower(m.dosage_form) = lower($${params.length})`); }
  if (f.type) { params.push(f.type); cond.push(`lower(m.product_type) = lower($${params.length})`); }
  if (f.rx) cond.push('m.prescription_required = true');
  if (f.offer) cond.push(`(p.offer_sales IS NOT NULL AND p.regular_sales IS NOT NULL AND p.offer_sales < p.regular_sales)
      OR (p.offer_base IS NOT NULL AND p.regular_base IS NOT NULL AND p.offer_base < p.regular_base)`);
  if (f.minPrice != null) { params.push(f.minPrice); cond.push(`COALESCE(p.offer_sales, p.regular_sales, p.offer_base, p.regular_base) >= $${params.length}`); }
  if (f.maxPrice != null) { params.push(f.maxPrice); cond.push(`COALESCE(p.offer_sales, p.regular_sales, p.offer_base, p.regular_base) <= $${params.length}`); }
  return cond.join(' AND ');
}

/** Tokenize the query the way the static engine did (latin + Bengali ranges). */
export function tokenize(q: string): string[] {
  return String(q || '').toLowerCase()
    .split(/[^a-z0-9\u0980-\u09FF]+/)
    .filter((t) => t.length >= 2 && t.length <= 40)
    .slice(0, 6);
}

export async function searchMedicines(sp: SearchParams): Promise<{ items: unknown[]; total: number; mode: string }> {
  const tokens = tokenize(sp.q);
  const params: unknown[] = [];
  const where = filterConditions(sp, params);
  let scoreExpr: string;
  let matchCond: string;
  let mode: string;

  if (!tokens.length) {
    // Browse mode (filters only): stable ordering by verification + recency.
    scoreExpr = '0';
    matchCond = 'TRUE';
    mode = 'browse';
  } else {
    params.push(tokens.join(' | '));
    const tsParam = `$${params.length}`;
    // per-token partial conditions (AND across tokens)
    const partialConds: string[] = [];
    for (const t of tokens) {
      params.push('%' + t.replace(/[%_]/g, '') + '%');
      partialConds.push(`(m.name ILIKE $${params.length} OR m.generic_name ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }
    const partialAll = partialConds.join(' AND ');
    params.push(tokens[0]);
    const firstTok = `$${params.length}`;
    scoreExpr = `
      (CASE WHEN lower(m.name) = lower(${firstTok}) THEN 1000 ELSE 0 END +
       CASE WHEN lower(coalesce(c.name,'')) = lower(${firstTok}) THEN 800 ELSE 0 END +
       CASE WHEN lower(m.name) LIKE lower(${firstTok}) || '%' THEN 600 ELSE 0 END +
       CASE WHEN ${partialAll} THEN 400 ELSE 0 END +
       200 * GREATEST(COALESCE(similarity(m.name, ${firstTok}), 0),
                      COALESCE(similarity(m.generic_name, ${firstTok}), 0)) +
       100 * ts_rank(m.search_vector, ${tsParam}) +
       CASE WHEN c.name ILIKE '%' || ${firstTok} || '%' THEN 150 ELSE 0 END)`;
    // Match = lexical OR partial OR fuzzy; fuzzy per-token handled by similarity in the rank.
    matchCond = `(m.search_vector @@ ${tsParam}::tsquery OR ${partialAll}
      OR similarity(m.name, ${firstTok}) >= 0.30
      OR similarity(coalesce(m.generic_name, ''), ${firstTok}) >= 0.30)`;
    mode = 'search';
  }

  const whereAll = `${matchCond} AND (${where})`;
  const countParams = [...params];
  const totalRes = await query<{ ct: string }>(
    `SELECT count(*) AS ct ${BASE_SELECT} WHERE ${whereAll}`, countParams,
  );
  const total = Number(totalRes.rows[0].ct);

  const listParams = [...params];
  listParams.push(sp.limit); const lim = `$${listParams.length}`;
  listParams.push((sp.page - 1) * sp.limit); const off = `$${listParams.length}`;
  const items = await query(
    `SELECT m.id, m.slug, m.name, m.name_bn AS "nameBn", m.generic_name AS "genericName",
            m.strength, m.dosage_form AS "dosageForm", m.product_type AS "productType",
            m.prescription_required AS "prescriptionRequired", m.verification_status AS "verificationStatus",
            c.name AS company, c.slug AS "companySlug",
            p.regular_base AS "regularBase", p.offer_base AS "offerBase",
            p.regular_sales AS "regularSales", p.offer_sales AS "offerSales",
            p.discount_percent AS "discountPercent", p.base_unit AS "baseUnit", p.sales_unit AS "salesUnit",
            p.sales_unit_multiplier AS "salesUnitMultiplier",
            (SELECT url FROM product_images i WHERE i.medicine_id = m.id AND i.available ORDER BY is_primary DESC LIMIT 1) AS image,
            m.last_verified_at AS "lastVerifiedAt",
            ${scoreExpr} AS score
     ${BASE_SELECT}
     WHERE ${whereAll}
     ORDER BY score DESC, m.name ASC, m.id
     LIMIT ${lim} OFFSET ${off}`,
    listParams,
  );
  void countParams;
  // Same item shape as /medicines (nested price object) so all clients agree.
  return { items: items.rows.map(rowToMedicine), total, mode };
}

export async function suggestions(q: string, limit = 8): Promise<{ products: unknown[]; terms: string[] }> {
  const tokens = tokenize(q);
  const first = tokens[0] ?? '';
  if (!first) return { products: [], terms: [] };
  const safe = first.replace(/[%_]/g, '');
  const products = await query(
    `SELECT m.id, m.slug, m.name,
            COALESCE(p.offer_sales, p.regular_sales) AS price, p.sales_unit AS "salesUnit"
     FROM medicines m
     LEFT JOIN medicine_prices p ON p.medicine_id = m.id
     WHERE lower(m.name) LIKE lower($1) || '%'
        OR m.name % $1
        OR m.search_vector @@ websearch_to_tsquery('simple', $1)
     ORDER BY CASE WHEN lower(m.name) LIKE lower($1) || '%' THEN 0 ELSE 1 END, m.name
     LIMIT $2`,
    [safe, limit],
  );
  const terms = await query<{ term: string }>(
    `SELECT DISTINCT generic_name AS term FROM medicines
     WHERE generic_name ILIKE $1 || '%' AND generic_name IS NOT NULL LIMIT 4`,
    [safe],
  );
  return { products: products.rows, terms: terms.rows.map((r) => r.term) };
}

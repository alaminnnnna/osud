/* Medora — server-side search (unified app, SQLite engine).
   Same ranking model the API tests and audit reports were written against:

     1000 exact name · 800 exact company · 600 name prefix ·
     400 strong partial (name/generic/company) · 200×similarity fuzzy ·
     100× lexical rank · 150 partial company match

   PostgreSQL FTS (tsvector/ts_rank) + pg_trgm are replaced by SQLite FTS5:
   - medicines_fts (unicode61) for lexical matching, ranked with bm25 column
     weights (name weighted highest),
   - medicines_fuzzy (trigram) for typo tolerance + substring matching,
   - trigram-set similarity (pg_trgm-compatible formula) computed in JS over
     the bounded candidate set for the 200×similarity term. */
import { all, get } from './db';
import { rowToMedicine } from './queries';

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
  if (f.companySlug) { params.push(f.companySlug); cond.push(`c.slug = ?`); }
  if (f.categorySlug) { params.push(f.categorySlug); cond.push(`EXISTS (
      SELECT 1 FROM medicine_categories mc JOIN categories cat ON cat.id = mc.category_id
      WHERE mc.medicine_id = m.id AND cat.slug = ?)`); }
  if (f.form) { params.push(f.form); cond.push(`lower(m.dosage_form) = lower(?)`); }
  if (f.type) { params.push(f.type); cond.push(`lower(m.product_type) = lower(?)`); }
  if (f.rx) cond.push('m.prescription_required = 1');
  if (f.offer) cond.push(`(p.offer_sales IS NOT NULL AND p.regular_sales IS NOT NULL AND p.offer_sales < p.regular_sales)
      OR (p.offer_base IS NOT NULL AND p.regular_base IS NOT NULL AND p.offer_base < p.regular_base)`);
  if (f.minPrice != null) { params.push(f.minPrice); cond.push(`COALESCE(p.offer_sales, p.regular_sales, p.offer_base, p.regular_base) >= ?`); }
  if (f.maxPrice != null) { params.push(f.maxPrice); cond.push(`COALESCE(p.offer_sales, p.regular_sales, p.offer_base, p.regular_base) <= ?`); }
  return cond.join(' AND ');
}

/** Tokenize the query the way the static engine did (latin + Bengali ranges). */
export function tokenize(q: string): string[] {
  return String(q || '').toLowerCase()
    .split(/[^a-z0-9\u0980-\u09FF]+/)
    .filter((t) => t.length >= 2 && t.length <= 40)
    .slice(0, 6);
}

/* pg_trgm-compatible trigram-set similarity: Jaccard over padded word trigrams. */
function trigrams(word: string): Set<string> {
  const padded = '  ' + word + ' ';
  const set = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.slice(i, i + 3));
  return set;
}
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = trigrams(a), B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const t of A) if (B.has(t)) common++;
  return common / (A.size + B.size - common);
}

const escapeFts = (s: string) => s.replace(/["*()]/g, ' ');

/**
 * Trigram fuzzy query: OR of the padded query's own trigrams. A trigram
 * *phrase* (e.g. '"paracetmol"') would demand the exact substring — useless
 * for typos — while sharing any trigram recalls candidates, ranked by bm25
 * (more shared trigrams = more relevant).
 */
function trigramFtsQuery(s: string, maxTerms = 24): string {
  const padded = '  ' + s.toLowerCase() + ' ';
  const grams: string[] = [];
  for (let i = 0; i + 3 <= padded.length && grams.length < maxTerms; i++) {
    const g = padded.slice(i, i + 3);
    if (g.trim().length >= 2) grams.push(`"${g.replace(/["*()]/g, ' ')}"`);
  }
  return grams.join(' OR ');
}

/** Shared match/filter conditions for search: FTS lexical OR trigram fuzzy OR partials. */
function matchAndFilter(where: string, tokens: string[], params: unknown[]) {
  const ftsQuery = tokens.map((t) => `"${escapeFts(t)}"*`).join(' OR ');
  const fuzzyQuery = trigramFtsQuery(tokens.join(' '));
  const partialConds: string[] = [];
  const p: unknown[] = [];
  for (const t of tokens) {
    const lit = t.replace(/[%_]/g, '');
    p.push(`%${lit}%`, `%${lit}%`, `%${lit}%`);
    partialConds.push(`(m.name LIKE ? OR m.generic_name LIKE ? OR c.name LIKE ?)`);
  }
  const partialAll = partialConds.join(' AND ');
  const matchCond = `(m.id IN (SELECT rowid FROM medicines_fts WHERE medicines_fts MATCH ?)
      OR m.id IN (SELECT rowid FROM medicines_fuzzy WHERE medicines_fuzzy MATCH ?)
      OR ${partialAll})`;
  return { ftsQuery, fuzzyQuery, partialAll, p, matchCond, matchParams: [ftsQuery, fuzzyQuery, ...p], where };
}

/** Bounded candidate fetch: exact/prefix/partial/company scores + bm25 lexical. */
function candidatesQuery(where: string, filterParams: unknown[], tokens: string[], cap: number) {
  const first = tokens[0];
  const { ftsQuery, fuzzyQuery, partialAll, p, matchParams } = matchAndFilter(where, tokens, []);

  const scoreParams: unknown[] = [first, first, first, ...p, first];
  const sql = `
    WITH lex AS (
      SELECT rowid AS rid, bm25(medicines_fts, 12.0, 6.0, 1.0, 1.0) AS rank
      FROM medicines_fts WHERE medicines_fts MATCH ?
    ), fz AS (
      SELECT rowid AS rid, bm25(medicines_fuzzy) AS frank
      FROM medicines_fuzzy WHERE medicines_fuzzy MATCH ?
    )
    SELECT m.id, m.slug, m.name, m.name_bn AS "nameBn", m.generic_name AS "genericName",
           m.strength, m.dosage_form AS "dosageForm", m.product_type AS "productType",
           m.prescription_required AS "prescriptionRequired", m.verification_status AS "verificationStatus",
           c.name AS company, c.slug AS "companySlug",
           p.regular_base AS "regularBase", p.offer_base AS "offerBase",
           p.regular_sales AS "regularSales", p.offer_sales AS "offerSales",
           p.discount_percent AS "discountPercent", p.base_unit AS "baseUnit", p.sales_unit AS "salesUnit",
           p.sales_unit_multiplier AS "salesUnitMultiplier",
           (SELECT url FROM product_images i WHERE i.medicine_id = m.id AND i.available = 1 ORDER BY is_primary DESC LIMIT 1) AS image,
           m.last_verified_at AS "lastVerifiedAt", m.source_product_id AS "sourceProductId",
           (CASE WHEN lower(m.name) = lower(?) THEN 1000 ELSE 0 END +
            CASE WHEN lower(coalesce(c.name,'')) = lower(?) THEN 800 ELSE 0 END +
            CASE WHEN m.name LIKE ? || '%' THEN 600 ELSE 0 END +
            CASE WHEN ${partialAll} THEN 400 ELSE 0 END +
            CASE WHEN c.name LIKE '%' || ? || '%' THEN 150 ELSE 0 END +
            100.0 * (1.0 - 1.0 / (1.0 + min(abs(COALESCE(lex.rank, 0)), 20.0))) +
            100.0 * (1.0 - 1.0 / (1.0 + min(abs(COALESCE(fz.frank, 0)), 20.0)))
           ) AS sqlScore
    ${BASE_SELECT}
    LEFT JOIN lex ON lex.rid = m.id
    LEFT JOIN fz ON fz.rid = m.id
    WHERE (m.id IN (SELECT rowid FROM medicines_fts WHERE medicines_fts MATCH ?)
           OR m.id IN (SELECT rowid FROM medicines_fuzzy WHERE medicines_fuzzy MATCH ?)
           OR ${partialAll}) AND (${where})
    ORDER BY sqlScore DESC, m.name COLLATE NOCASE ASC, m.id ASC
    LIMIT ${cap}`;
  // Params: lex rank, fuzzy rank, score params, match params (fts, fuzzy, partials), filter params.
  const params = [ftsQuery, fuzzyQuery, ...scoreParams, ...matchParams, ...filterParams];
  return { sql, params };
}

export async function searchMedicines(sp: SearchParams): Promise<{ items: unknown[]; total: number; mode: string }> {
  const tokens = tokenize(sp.q);
  const filterParams: unknown[] = [];
  const where = filterConditions(sp, filterParams);

  if (!tokens.length) {
    // Browse mode (filters only): stable ordering by name, like the PG score=0 path.
    const total = Number(get<{ ct: number }>(`SELECT count(*) AS ct ${BASE_SELECT} WHERE ${where}`, filterParams)?.ct ?? 0);
    const rows = all<Record<string, unknown>>(
      `SELECT m.id, m.slug, m.name, m.name_bn AS "nameBn", m.generic_name AS "genericName",
              m.strength, m.dosage_form AS "dosageForm", m.product_type AS "productType",
              m.prescription_required AS "prescriptionRequired", m.verification_status AS "verificationStatus",
              c.name AS company, c.slug AS "companySlug",
              p.regular_base AS "regularBase", p.offer_base AS "offerBase",
              p.regular_sales AS "regularSales", p.offer_sales AS "offerSales",
              p.discount_percent AS "discountPercent", p.base_unit AS "baseUnit", p.sales_unit AS "salesUnit",
              p.sales_unit_multiplier AS "salesUnitMultiplier",
              (SELECT url FROM product_images i WHERE i.medicine_id = m.id AND i.available = 1 ORDER BY is_primary DESC LIMIT 1) AS image,
              m.last_verified_at AS "lastVerifiedAt"
       ${BASE_SELECT} WHERE ${where}
       ORDER BY m.name COLLATE NOCASE ASC, m.id ASC
       LIMIT ? OFFSET ?`,
      [...filterParams, sp.limit, (sp.page - 1) * sp.limit],
    );
    return { items: rows.map(rowToMedicine), total, mode: 'browse' };
  }

  const first = tokens[0];
  const { ftsQuery, fuzzyQuery, partialAll, p } = matchAndFilter(where, tokens, []);
  // Total mirrors the PG semantics: lexical/partial matches counted exactly in
  // SQL, fuzzy-only matches counted from the qualified candidate window
  // (pg_trgm similarity >= 0.30 equivalent).
  const strictParams = [ftsQuery, ...p];
  const baseTotal = Number(get<{ ct: number }>(
    `SELECT count(*) AS ct ${BASE_SELECT} WHERE (m.id IN (SELECT rowid FROM medicines_fts WHERE medicines_fts MATCH ?)
       OR ${partialAll}) AND (${where})`,
    [...strictParams, ...filterParams],
  )?.ct ?? 0);

  // Ranked candidates (bounded) — fuzzy similarity applied in JS.
  const { sql, params } = candidatesQuery(where, filterParams, tokens, 1000);
  const cand = all<Record<string, unknown>>(sql, params);
  const scored = cand
    .map((r) => {
      const sim = Math.max(similarity(String(r.name ?? ''), first), similarity(String(r.genericName ?? ''), first));
      const sqlScore = Number(r.sqlScore ?? 0);
      // Mirror the PG match condition: lexical/partial matches pass via score,
      // fuzzy-only candidates need pg_trgm-equivalent similarity >= 0.30.
      const qualifies = sim >= 0.30 || sqlScore >= 200;
      return { r, sim, sqlScore, score: sqlScore + 200 * sim, qualifies };
    })
    .filter((x) => x.qualifies);
  const fuzzyOnly = scored.filter((x) => x.sqlScore < 200).length;
  const total = baseTotal + fuzzyOnly;
  scored.sort((a, b) => b.score - a.score
    || String(a.r.name).localeCompare(String(b.r.name), undefined, { sensitivity: 'base' })
    || Number(a.r.id) - Number(b.r.id));
  const items = scored.slice((sp.page - 1) * sp.limit, (sp.page - 1) * sp.limit + sp.limit)
    .map(({ r }) => rowToMedicine(r));
  return { items, total, mode: 'search' };
}

export async function suggestions(q: string, limit = 8): Promise<{ products: unknown[]; terms: string[] }> {
  const tokens = tokenize(q);
  const first = tokens[0] ?? '';
  if (!first) return { products: [], terms: [] };
  const safe = first.replace(/[%_]/g, '');
  const ftsQuery = `"${escapeFts(first)}"*`;
  const fuzzyQuery = trigramFtsQuery(first);
  const products = all<Record<string, unknown>>(
    `SELECT m.id, m.slug, m.name,
            COALESCE(p.offer_sales, p.regular_sales) AS price, p.sales_unit AS "salesUnit"
     FROM medicines m
     LEFT JOIN medicine_prices p ON p.medicine_id = m.id
     WHERE lower(m.name) LIKE lower(?) || '%'
        OR m.id IN (SELECT rowid FROM medicines_fuzzy WHERE medicines_fuzzy MATCH ?)
        OR m.id IN (SELECT rowid FROM medicines_fts WHERE medicines_fts MATCH ?)
     ORDER BY CASE WHEN lower(m.name) LIKE lower(?) || '%' THEN 0 ELSE 1 END, m.name COLLATE NOCASE
     LIMIT ?`,
    [safe, fuzzyQuery, ftsQuery, safe, limit],
  );
  const terms = all<{ term: string }>(
    `SELECT DISTINCT generic_name AS term FROM medicines
     WHERE generic_name LIKE ? || '%' AND generic_name IS NOT NULL LIMIT 4`,
    [safe],
  );
  return { products, terms: terms.map((r) => r.term) };
}

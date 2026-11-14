/* Medora — ingestion engine for the unified app (server-only).
   Ported from platform/src/importer.ts: the exact same idempotent,
   history-preserving batch upsert the file importer uses, so API ingestion
   can never corrupt existing data. The file-streaming CLI (runImport,
   checkpointing) stays in platform/ — this module only carries the
   shared batch pipeline that the ingestion route needs. */
import type { PoolClient } from './db';
import { pool, query } from './db';
import { assignSlugs } from './slugs';
import type { NormalizedRecord } from './normalize';

async function ensureSource(client: PoolClient): Promise<number> {
  const r = await client.query<{ id: number }>(
    `INSERT INTO sources (key, name, base_url, api_endpoint, robots_note)
     VALUES ('arogga', 'Arogga', 'https://www.arogga.com', 'https://api.arogga.com/general/v3/search',
             'api.arogga.com/robots.txt currently disallows crawling; keep request volume modest.')
     ON CONFLICT (key) DO NOTHING RETURNING id`,
  );
  if (r.rows.length) return r.rows[0].id;
  const again = await client.query<{ id: number }>('SELECT id FROM sources WHERE key = $1', ['arogga']);
  return again.rows[0].id;
}

export async function ensureAroggaSource(): Promise<number> {
  const client = await pool.connect();
  try { return await ensureSource(client); } finally { client.release(); }
}

function slugOf(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'company';
}

async function freeSlug(client: PoolClient, base: string, table: 'companies' | 'categories'): Promise<string> {
  let candidate = base;
  for (let i = 2; i < 1000; i++) {
    const exists = await client.query(`SELECT 1 FROM ${table} WHERE slug = $1 LIMIT 1`, [candidate]);
    if (!exists.rows.length) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

/* ---------- in-memory import state (loaded once, kept consistent) ---------- */

interface DbPriceRow {
  regular_base: string | null;
  offer_base: string | null;
  regular_sales: string | null;
  offer_sales: string | null;
  base_unit: string | null;
  base_unit_multiplier: string | null;
  sales_unit: string | null;
  sales_unit_multiplier: string | null;
  discount_percent: string | null;
  min_qty: number | null;
  max_qty: number | null;
}

/** Key must match NormalizedRecord.priceChangedKey exactly (same order). */
function priceKeyOf(row: DbPriceRow): string {
  return JSON.stringify([
    row.regular_base == null ? null : Number(row.regular_base),
    row.offer_base == null ? null : Number(row.offer_base),
    row.regular_sales == null ? null : Number(row.regular_sales),
    row.offer_sales == null ? null : Number(row.offer_sales),
    row.base_unit, row.sales_unit,
    row.sales_unit_multiplier == null ? null : Number(row.sales_unit_multiplier),
    row.discount_percent == null ? null : Number(row.discount_percent),
    row.min_qty, row.max_qty,
  ]);
}

export interface ImportState {
  sourceId: number;
  existingSlugs: Set<string>;
  medSlugBySrc: Map<number, string>;
  medIdBySrc: Map<number, number>;
  companyByKey: Map<string, number>;
  categoryByKey: Map<string, number>;
  priceRowByMed: Map<number, DbPriceRow>;
}

async function preloadState(client: PoolClient, sourceId: number): Promise<ImportState> {
  const state: ImportState = {
    sourceId,
    existingSlugs: new Set(),
    medSlugBySrc: new Map(),
    medIdBySrc: new Map(),
    companyByKey: new Map(),
    categoryByKey: new Map(),
    priceRowByMed: new Map(),
  };
  const slugs = await client.query<{ id: number; slug: string; source_product_id: number }>(
    'SELECT id, slug, source_product_id FROM medicines');
  for (const r of slugs.rows) {
    state.existingSlugs.add(r.slug);
    state.medSlugBySrc.set(r.source_product_id, r.slug);
    state.medIdBySrc.set(r.source_product_id, r.id);
  }
  const companies = await client.query<{ id: number; source_key: string }>(
    'SELECT id, source_key FROM companies WHERE source_id = $1', [sourceId]);
  for (const r of companies.rows) state.companyByKey.set(r.source_key, r.id);
  const cats = await client.query<{ id: number; source_key: string }>(
    'SELECT id, source_key FROM categories WHERE source_id = $1', [sourceId]);
  for (const r of cats.rows) state.categoryByKey.set(r.source_key, r.id);
  const prices = await client.query<DbPriceRow & { medicine_id: number }>(`
    SELECT m.id AS medicine_id, m.min_qty, m.max_qty,
           p.regular_base, p.offer_base, p.regular_sales, p.offer_sales,
           p.base_unit, p.base_unit_multiplier, p.sales_unit, p.sales_unit_multiplier, p.discount_percent
    FROM medicines m LEFT JOIN medicine_prices p ON p.medicine_id = m.id`);
  for (const r of prices.rows) {
    const { medicine_id, ...row } = r;
    state.priceRowByMed.set(medicine_id, row);
  }
  return state;
}

async function upsertCompany(client: PoolClient, state: ImportState, key: string, name: string): Promise<number> {
  const known = state.companyByKey.get(key);
  if (known) return known;
  const base = key.startsWith('id:') ? slugOf(name) : key.slice('name:'.length);
  const slug = await freeSlug(client, base, 'companies');
  const inserted = await client.query<{ id: number }>(
    `INSERT INTO companies (source_id, source_key, name, slug)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_id, source_key) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id`,
    [state.sourceId, key, name, slug],
  );
  state.companyByKey.set(key, inserted.rows[0].id);
  return inserted.rows[0].id;
}

async function upsertCategory(client: PoolClient, state: ImportState, key: string, type: string | null): Promise<number> {
  const known = state.categoryByKey.get(key);
  if (known) return known;
  const srcId = Number(key.slice(3));
  const slug = await freeSlug(client, `category-${srcId}`, 'categories');
  const inserted = await client.query<{ id: number }>(
    `INSERT INTO categories (source_id, source_key, type, name, slug)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source_id, source_key) DO NOTHING RETURNING id`,
    [state.sourceId, key, type, `Category ${srcId}`, slug],
  );
  const id = inserted.rows.length
    ? inserted.rows[0].id
    : (await client.query<{ id: number }>('SELECT id FROM categories WHERE source_id = $1 AND source_key = $2',
        [state.sourceId, key])).rows[0].id;
  state.categoryByKey.set(key, id);
  return id;
}

export interface BatchStats {
  imported: number;
  updated: number;
  unchanged: number;
  priceHistoryAppended: number;
  slugCollisions: number;
}

/* Cached import state for the ingestion API (loaded once per process). */
let cachedState: ImportState | null = null;
export async function getImportState(): Promise<ImportState> {
  if (cachedState) return cachedState;
  const sourceId = await ensureAroggaSource();
  const client = await pool.connect();
  try { cachedState = await preloadState(client, sourceId); } finally { client.release(); }
  return cachedState;
}

/** Bulk, idempotent, history-preserving batch upsert for normalized records. */
export async function upsertBatch(
  client: PoolClient,
  state: ImportState,
  jobId: bigint | null,
  items: NormalizedRecord[],
): Promise<BatchStats> {
  const stats: BatchStats = { imported: 0, updated: 0, unchanged: 0, priceHistoryAppended: 0, slugCollisions: 0 };
  if (!items.length) return stats;

  // 1) companies / categories — resolve from cache; insert only new keys.
  const companyIds = new Map<string, number>();
  for (const rec of items) {
    if (!companyIds.has(rec.companyKey)) {
      companyIds.set(rec.companyKey, await upsertCompany(client, state, rec.companyKey, rec.companyName));
    }
  }
  const categoryIds = new Map<string, number>();
  for (const rec of items) {
    if (rec.categoryKey && !categoryIds.has(rec.categoryKey)) {
      categoryIds.set(rec.categoryKey, await upsertCategory(client, state, rec.categoryKey, rec.categoryType));
    }
  }

  // 2) slug assignment for NEW medicines only (existing slugs are stable).
  const newItems = items.filter((rec) => !state.medSlugBySrc.has(rec.sourceProductId));
  const newSlugs = assignSlugs(
    newItems.map((rec) => ({ id: rec.sourceProductId, rec: { name: rec.name, dosageForm: rec.dosageForm, strength: rec.strength } })),
    state.existingSlugs,
  );
  stats.slugCollisions = [...newSlugs.values()].filter((s) => /-\d+$/.test(s)).length;

  // 3) medicines — bulk upsert.
  const medSourceIds: number[] = [], medSids: number[] = [], names: (string | null)[] = [], nameBns: (string | null)[] = [],
    slugsArr: string[] = [], generics: (string | null)[] = [], genericIds: (number | null)[] = [], strengths: (string | null)[] = [],
    forms: (string | null)[] = [], types: (string | null)[] = [], rxs: boolean[] = [], activeStatuses: (string | null)[] = [],
    allowSales: boolean[] = [], variantCounts: (number | null)[] = [], minQtys: (number | null)[] = [], maxQtys: (number | null)[] = [],
    statuses: string[] = [], missing: string[][] = [], sourceUrls: string[] = [], companyIdsArr: (number | null)[] = [], categoryIdsArr: (number | null)[] = [];
  for (const rec of items) {
    const slug = state.medSlugBySrc.get(rec.sourceProductId) ?? newSlugs.get(rec.sourceProductId) ?? `medicine-${rec.sourceProductId}`;
    medSourceIds.push(state.sourceId);
    medSids.push(rec.sourceProductId);
    names.push(rec.name);
    nameBns.push(rec.nameBn);
    slugsArr.push(slug);
    generics.push(rec.genericName);
    genericIds.push(rec.genericSourceId);
    strengths.push(rec.strength);
    forms.push(rec.dosageForm);
    types.push(rec.productType);
    rxs.push(rec.prescriptionRequired);
    activeStatuses.push(rec.activeStatus);
    allowSales.push(rec.allowSales);
    variantCounts.push(rec.variantCount);
    minQtys.push(rec.minQty);
    maxQtys.push(rec.maxQty);
    statuses.push(rec.duplicateOf != null ? 'NEEDS_RECHECK' : rec.validation.status);
    missing.push(rec.missingFields);
    sourceUrls.push(`https://www.arogga.com/product/${rec.sourceProductId}/${slug}`);
    companyIdsArr.push(companyIds.get(rec.companyKey) ?? null);
    categoryIdsArr.push(rec.categoryKey ? categoryIds.get(rec.categoryKey) ?? null : null);
  }
  const medRows = await client.query<{ id: number; sid: number; inserted: boolean }>(`
    INSERT INTO medicines (source_id, source_product_id, name, name_bn, slug, generic_name, generic_source_id,
      strength, dosage_form, product_type, prescription_required, active_status, allow_sales,
      variant_count, min_qty, max_qty, verification_status, missing_fields, source_url,
      company_id, primary_category_id, last_verified_at)
    SELECT source_id, source_product_id, name, name_bn, slug, generic_name, generic_source_id,
      strength, dosage_form, product_type, prescription_required, active_status, allow_sales,
      variant_count, min_qty, max_qty, verification_status,
      COALESCE((SELECT array_agg(j) FROM jsonb_array_elements_text(mf_json::jsonb) AS j), '{}'::text[]) AS missing_fields,
      source_url, company_id, primary_category_id, now()
    FROM unnest($1::int[],$2::int[],$3::text[],$4::text[],$5::text[],$6::text[],$7::int[],$8::text[],$9::text[],$10::text[],
                $11::bool[],$12::text[],$13::bool[],$14::int[],$15::int[],$16::int[],$17::text[],$18::text[],$19::text[],$20::int[],$21::int[])
      AS t(source_id, source_product_id, name, name_bn, slug, generic_name, generic_source_id,
      strength, dosage_form, product_type, prescription_required, active_status, allow_sales,
      variant_count, min_qty, max_qty, verification_status, mf_json, source_url, company_id, primary_category_id)
    ON CONFLICT (source_id, source_product_id) DO UPDATE SET
      name = EXCLUDED.name, name_bn = EXCLUDED.name_bn,
      generic_name = EXCLUDED.generic_name, generic_source_id = EXCLUDED.generic_source_id,
      strength = EXCLUDED.strength, dosage_form = EXCLUDED.dosage_form, product_type = EXCLUDED.product_type,
      prescription_required = EXCLUDED.prescription_required, active_status = EXCLUDED.active_status,
      allow_sales = EXCLUDED.allow_sales, variant_count = EXCLUDED.variant_count,
      min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty,
      verification_status = EXCLUDED.verification_status, missing_fields = EXCLUDED.missing_fields,
      source_url = EXCLUDED.source_url, company_id = EXCLUDED.company_id,
      primary_category_id = EXCLUDED.primary_category_id,
      last_verified_at = now(), updated_at = now()
    RETURNING id, source_product_id AS sid, (xmax = 0) AS inserted`, [
    medSourceIds, medSids, names, nameBns, slugsArr, generics, genericIds, strengths, forms, types,
    rxs, activeStatuses, allowSales, variantCounts, minQtys, maxQtys, statuses,
    missing.map((m) => JSON.stringify(m)), sourceUrls,
    companyIdsArr, categoryIdsArr,
  ]);
  const medIdBySid = new Map<number, number>();
  const slugBySid = new Map<number, string>();
  for (let i = 0; i < items.length; i++) slugBySid.set(medSids[i], slugsArr[i]);
  for (const r of medRows.rows) {
    medIdBySid.set(r.sid, r.id);
    if (r.inserted) stats.imported++; else stats.updated++;
    state.medIdBySrc.set(r.sid, r.id);
    if (!state.medSlugBySrc.has(r.sid)) {
      const slug = slugBySid.get(r.sid) ?? `medicine-${r.sid}`;
      state.medSlugBySrc.set(r.sid, slug);
      state.existingSlugs.add(slug);
    }
  }

  // 4) prices — bulk upsert; changed existing prices append to history.
  const medIds: number[] = [], baseUnits: (string | null)[] = [], baseMults: (number | null)[] = [],
    regularBases: (number | null)[] = [], offerBases: (number | null)[] = [], salesUnits: (string | null)[] = [],
    salesMults: (number | null)[] = [], regularSalesArr: (number | null)[] = [], offerSalesArr: (number | null)[] = [],
    discounts: (number | null)[] = [], priceSources: string[] = [];
  const histMedIds: number[] = [], histRb: (number | null)[] = [], histOb: (number | null)[] = [],
    histRs: (number | null)[] = [], histOs: (number | null)[] = [];
  for (const rec of items) {
    const medId = medIdBySid.get(rec.sourceProductId);
    if (medId == null) continue;
    const p = rec.prices;
    medIds.push(medId);
    baseUnits.push(p.baseUnit);
    baseMults.push(p.baseUnitMultiplier);
    regularBases.push(p.regularBase);
    offerBases.push(p.offerBase);
    salesUnits.push(p.salesUnit);
    salesMults.push(p.salesUnitMultiplier);
    regularSalesArr.push(p.regularSales);
    offerSalesArr.push(p.offerSales);
    discounts.push(p.discountPercent);
    priceSources.push(p.priceSource);

    const old = state.priceRowByMed.get(medId);
    if (old) {
      const changed = priceKeyOf(old) !== rec.priceChangedKey;
      if (changed) {
        histMedIds.push(medId);
        histRb.push(old.regular_base == null ? null : Number(old.regular_base));
        histOb.push(old.offer_base == null ? null : Number(old.offer_base));
        histRs.push(old.regular_sales == null ? null : Number(old.regular_sales));
        histOs.push(old.offer_sales == null ? null : Number(old.offer_sales));
        stats.priceHistoryAppended++;
      } else {
        stats.unchanged++;
      }
    }
    state.priceRowByMed.set(medId, {
      regular_base: p.regularBase == null ? null : String(p.regularBase),
      offer_base: p.offerBase == null ? null : String(p.offerBase),
      regular_sales: p.regularSales == null ? null : String(p.regularSales),
      offer_sales: p.offerSales == null ? null : String(p.offerSales),
      base_unit: p.baseUnit,
      base_unit_multiplier: p.baseUnitMultiplier == null ? null : String(p.baseUnitMultiplier),
      sales_unit: p.salesUnit,
      sales_unit_multiplier: p.salesUnitMultiplier == null ? null : String(p.salesUnitMultiplier),
      discount_percent: p.discountPercent == null ? null : String(p.discountPercent),
      min_qty: rec.minQty,
      max_qty: rec.maxQty,
    });
  }
  await client.query(`
    INSERT INTO medicine_prices (medicine_id, base_unit, base_unit_multiplier, regular_base, offer_base,
      sales_unit, sales_unit_multiplier, regular_sales, offer_sales, discount_percent, price_source)
    SELECT medicine_id, base_unit, base_unit_multiplier, regular_base, offer_base,
      sales_unit, sales_unit_multiplier, regular_sales, offer_sales, discount_percent, price_source
    FROM unnest($1::int[],$2::text[],$3::numeric[],$4::numeric[],$5::numeric[],$6::text[],$7::numeric[],$8::numeric[],$9::numeric[],$10::numeric[],$11::text[])
      AS t(medicine_id, base_unit, base_unit_multiplier, regular_base, offer_base, sales_unit, sales_unit_multiplier, regular_sales, offer_sales, discount_percent, price_source)
    ON CONFLICT (medicine_id) DO UPDATE SET
      base_unit = EXCLUDED.base_unit, base_unit_multiplier = EXCLUDED.base_unit_multiplier,
      regular_base = EXCLUDED.regular_base, offer_base = EXCLUDED.offer_base,
      sales_unit = EXCLUDED.sales_unit, sales_unit_multiplier = EXCLUDED.sales_unit_multiplier,
      regular_sales = EXCLUDED.regular_sales, offer_sales = EXCLUDED.offer_sales,
      discount_percent = EXCLUDED.discount_percent, price_source = EXCLUDED.price_source, updated_at = now()`,
    [medIds, baseUnits, baseMults, regularBases, offerBases, salesUnits, salesMults, regularSalesArr, offerSalesArr, discounts, priceSources]);
  if (histMedIds.length) {
    await client.query(`
      INSERT INTO price_history (medicine_id, regular_base, offer_base, regular_sales, offer_sales, changed_fields)
      SELECT medicine_id, regular_base, offer_base, regular_sales, offer_sales,
             '{regular_base,offer_base,regular_sales,offer_sales}'::text[] AS changed_fields
      FROM unnest($1::int[],$2::numeric[],$3::numeric[],$4::numeric[],$5::numeric[])
        AS t(medicine_id, regular_base, offer_base, regular_sales, offer_sales)`,
      [histMedIds, histRb, histOb, histRs, histOs]);
  }

  // 5) images — first 5 per medicine.
  const imgMedIds: number[] = [], imgUrls: string[] = [], imgTitles: (string | null)[] = [], imgPrimary: boolean[] = [];
  for (const rec of items) {
    const medId = medIdBySid.get(rec.sourceProductId);
    if (medId == null) continue;
    for (let i = 0; i < rec.images.length && i < 5; i++) {
      imgMedIds.push(medId);
      imgUrls.push(rec.images[i].url);
      imgTitles.push(rec.images[i].title);
      imgPrimary.push(i === 0);
    }
  }
  if (imgMedIds.length) {
    await client.query(`
      INSERT INTO product_images (medicine_id, url, title, is_primary, available)
      SELECT medicine_id, url, title, is_primary, true
      FROM unnest($1::int[],$2::text[],$3::text[],$4::bool[]) AS t(medicine_id, url, title, is_primary)
      ON CONFLICT (medicine_id, url) DO NOTHING`,
      [imgMedIds, imgUrls, imgTitles, imgPrimary]);
  }

  // 6) primary category links.
  const mcMedIds: number[] = [], mcCatIds: number[] = [];
  for (const rec of items) {
    const medId = medIdBySid.get(rec.sourceProductId);
    const catId = rec.categoryKey ? categoryIds.get(rec.categoryKey) : undefined;
    if (medId != null && catId != null) { mcMedIds.push(medId); mcCatIds.push(catId); }
  }
  if (mcMedIds.length) {
    await client.query(`
      INSERT INTO medicine_categories (medicine_id, category_id, is_primary)
      SELECT medicine_id, category_id, true
      FROM unnest($1::int[],$2::int[]) AS t(medicine_id, category_id)
      ON CONFLICT (medicine_id, category_id) DO UPDATE SET is_primary = true`,
      [mcMedIds, mcCatIds]);
  }

  // 7) validation rows — latest per medicine, incl. duplicate candidates.
  const valMedIds: number[] = [], valJobIds: (number | null)[] = [], valStatuses: string[] = [],
    valIssues: string[] = [], valConflicts: string[] = [], valDupOf: (number | null)[] = [];
  for (const rec of items) {
    const medId = medIdBySid.get(rec.sourceProductId);
    if (medId == null) continue;
    valMedIds.push(medId);
    valJobIds.push(jobId ? Number(jobId) : null);
    valStatuses.push(rec.duplicateOf != null ? 'NEEDS_RECHECK' : rec.validation.status);
    valIssues.push(JSON.stringify(rec.validation.issues));
    valConflicts.push(JSON.stringify(rec.validation.conflicts));
    valDupOf.push(rec.duplicateOf != null ? (state.medIdBySrc.get(rec.duplicateOf) ?? null) : null);
  }
  if (valMedIds.length) {
    await client.query(`
      INSERT INTO data_validations (medicine_id, import_job_id, status, issues, conflicts, duplicate_of, checked_at)
      SELECT medicine_id, import_job_id, status, (issues_json::text)::jsonb, (conflicts_json::text)::jsonb, duplicate_of, now()
      FROM unnest($1::int[],$2::bigint[],$3::text[],$4::text[],$5::text[],$6::int[])
        AS t(medicine_id, import_job_id, status, issues_json, conflicts_json, duplicate_of)`,
      [valMedIds, valJobIds, valStatuses, valIssues, valConflicts, valDupOf]);
  }

  return stats;
}

// `query` is re-exported so ingestion route code can touch the DB with the
// same helper the rest of the app uses without importing db.ts directly.
export { query };

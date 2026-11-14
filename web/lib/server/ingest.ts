/* Medora — ingestion engine for the unified app (server-only, SQLite).
   Port of platform/src/importer.ts's batch pipeline: idempotent,
   history-preserving upserts so API ingestion can never corrupt existing
   data. better-sqlite3 transactions are synchronous; the whole pipeline runs
   inside one transaction per batch. The JSONL streaming CLI with
   checkpoint/resume lives in web/scripts/import-data.mjs (same functions). */
import { getSqlite, query, run, all, get, type SqliteClient } from './db';
import { assignSlugs } from './slugs';
import type { NormalizedRecord } from './normalize';

function ensureSource(tx: SqliteClient): number {
  const r = tx.prepare(
    `INSERT INTO sources (key, name, base_url, api_endpoint, robots_note)
     VALUES ('arogga', 'Arogga', 'https://www.arogga.com', 'https://api.arogga.com/general/v3/search',
             'api.arogga.com/robots.txt currently disallows crawling; keep request volume modest.')
     ON CONFLICT (key) DO NOTHING RETURNING id`,
  ).get() as { id: number } | undefined;
  if (r) return r.id;
  return (tx.prepare('SELECT id FROM sources WHERE key = ?').get('arogga') as { id: number }).id;
}

export function ensureAroggaSource(): number {
  return ensureSource(getSqlite());
}

function slugOf(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'company';
}

function freeSlug(tx: SqliteClient, base: string, table: 'companies' | 'categories'): string {
  let candidate = base;
  const exists = tx.prepare(`SELECT 1 FROM ${table} WHERE slug = ? LIMIT 1`);
  for (let i = 2; i < 1000; i++) {
    if (!exists.get(candidate)) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

/* ---------- in-memory import state (loaded once, kept consistent) ---------- */

interface DbPriceRow {
  regular_base: number | string | null;
  offer_base: number | string | null;
  regular_sales: number | string | null;
  offer_sales: number | string | null;
  base_unit: string | null;
  base_unit_multiplier: number | string | null;
  sales_unit: string | null;
  sales_unit_multiplier: number | string | null;
  discount_percent: number | string | null;
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

function preloadState(tx: SqliteClient, sourceId: number): ImportState {
  const state: ImportState = {
    sourceId,
    existingSlugs: new Set(),
    medSlugBySrc: new Map(),
    medIdBySrc: new Map(),
    companyByKey: new Map(),
    categoryByKey: new Map(),
    priceRowByMed: new Map(),
  };
  const slugs = tx.prepare('SELECT id, slug, source_product_id FROM medicines').all() as { id: number; slug: string; source_product_id: number }[];
  for (const r of slugs) {
    state.existingSlugs.add(r.slug);
    state.medSlugBySrc.set(r.source_product_id, r.slug);
    state.medIdBySrc.set(r.source_product_id, r.id);
  }
  const companies = tx.prepare('SELECT id, source_key FROM companies WHERE source_id = ?').all(sourceId) as { id: number; source_key: string }[];
  for (const r of companies) state.companyByKey.set(r.source_key, r.id);
  const cats = tx.prepare('SELECT id, source_key FROM categories WHERE source_id = ?').all(sourceId) as { id: number; source_key: string }[];
  for (const r of cats) state.categoryByKey.set(r.source_key, r.id);
  const prices = tx.prepare(`
    SELECT m.id AS medicine_id, m.min_qty, m.max_qty,
           p.regular_base, p.offer_base, p.regular_sales, p.offer_sales,
           p.base_unit, p.base_unit_multiplier, p.sales_unit, p.sales_unit_multiplier, p.discount_percent
    FROM medicines m LEFT JOIN medicine_prices p ON p.medicine_id = m.id`).all() as (DbPriceRow & { medicine_id: number })[];
  for (const { medicine_id, ...row } of prices) state.priceRowByMed.set(medicine_id, row);
  return state;
}

function upsertCompany(tx: SqliteClient, state: ImportState, key: string, name: string): number {
  const known = state.companyByKey.get(key);
  if (known) return known;
  const base = key.startsWith('id:') ? slugOf(name) : key.slice('name:'.length);
  const slug = freeSlug(tx, base, 'companies');
  const now = new Date().toISOString();
  const inserted = tx.prepare(
    `INSERT INTO companies (source_id, source_key, name, slug, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (source_id, source_key) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
     RETURNING id`,
  ).get(state.sourceId, key, name, slug, now, now) as { id: number };
  state.companyByKey.set(key, inserted.id);
  return inserted.id;
}

function upsertCategory(tx: SqliteClient, state: ImportState, key: string, type: string | null): number {
  const known = state.categoryByKey.get(key);
  if (known) return known;
  const srcId = Number(key.slice(3));
  const slug = freeSlug(tx, `category-${srcId}`, 'categories');
  const now = new Date().toISOString();
  const inserted = tx.prepare(
    `INSERT INTO categories (source_id, source_key, type, name, slug, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source_id, source_key) DO UPDATE SET type = excluded.type, updated_at = excluded.updated_at
     RETURNING id`,
  ).get(state.sourceId, key, type, `Category ${srcId}`, slug, now, now) as { id: number };
  state.categoryByKey.set(key, inserted.id);
  return inserted.id;
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
export function getImportState(): ImportState {
  if (cachedState) return cachedState;
  const sourceId = ensureAroggaSource();
  cachedState = preloadState(getSqlite(), sourceId);
  return cachedState;
}

/** Invalidate the cached state after bulk external changes (import CLI). */
export function resetImportState(): void {
  cachedState = null;
}

const MEDICINE_UPSERT = `
  INSERT INTO medicines (source_id, source_product_id, name, name_bn, slug, generic_name, generic_source_id,
    strength, dosage_form, product_type, prescription_required, active_status, allow_sales,
    variant_count, min_qty, max_qty, verification_status, missing_fields, source_url,
    company_id, primary_category_id, last_imported_at, last_verified_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (source_id, source_product_id) DO UPDATE SET
    name = excluded.name, name_bn = excluded.name_bn,
    generic_name = excluded.generic_name, generic_source_id = excluded.generic_source_id,
    strength = excluded.strength, dosage_form = excluded.dosage_form, product_type = excluded.product_type,
    prescription_required = excluded.prescription_required, active_status = excluded.active_status,
    allow_sales = excluded.allow_sales, variant_count = excluded.variant_count,
    min_qty = excluded.min_qty, max_qty = excluded.max_qty,
    verification_status = excluded.verification_status, missing_fields = excluded.missing_fields,
    source_url = excluded.source_url, company_id = excluded.company_id,
    primary_category_id = excluded.primary_category_id,
    last_imported_at = excluded.last_imported_at, last_verified_at = excluded.last_verified_at,
    updated_at = excluded.updated_at
  RETURNING id`;

const PRICE_UPSERT = `
  INSERT INTO medicine_prices (medicine_id, base_unit, base_unit_multiplier, regular_base, offer_base,
    sales_unit, sales_unit_multiplier, regular_sales, offer_sales, discount_percent, price_source, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (medicine_id) DO UPDATE SET
    base_unit = excluded.base_unit, base_unit_multiplier = excluded.base_unit_multiplier,
    regular_base = excluded.regular_base, offer_base = excluded.offer_base,
    sales_unit = excluded.sales_unit, sales_unit_multiplier = excluded.sales_unit_multiplier,
    regular_sales = excluded.regular_sales, offer_sales = excluded.offer_sales,
    discount_percent = excluded.discount_percent, price_source = excluded.price_source,
    updated_at = excluded.updated_at`;

/** Bulk, idempotent, history-preserving batch upsert for normalized records.
    MUST be called inside withTransaction() — every statement is synchronous. */
export function upsertBatch(state: ImportState, jobId: number | null, items: NormalizedRecord[]): BatchStats {
  const tx = getSqlite();
  const stats: BatchStats = { imported: 0, updated: 0, unchanged: 0, priceHistoryAppended: 0, slugCollisions: 0 };
  if (!items.length) return stats;
  const now = new Date().toISOString();

  // 1) companies / categories — resolve from cache; upsert only new keys.
  const companyIds = new Map<string, number>();
  for (const rec of items) {
    if (!companyIds.has(rec.companyKey)) {
      companyIds.set(rec.companyKey, upsertCompany(tx, state, rec.companyKey, rec.companyName));
    }
  }
  const categoryIds = new Map<string, number>();
  for (const rec of items) {
    if (rec.categoryKey && !categoryIds.has(rec.categoryKey)) {
      categoryIds.set(rec.categoryKey, upsertCategory(tx, state, rec.categoryKey, rec.categoryType));
    }
  }

  // 2) slug assignment for NEW medicines only (existing slugs are stable).
  const newItems = items.filter((rec) => !state.medSlugBySrc.has(rec.sourceProductId));
  const newSlugs = assignSlugs(
    newItems.map((rec) => ({ id: rec.sourceProductId, rec: { name: rec.name, dosageForm: rec.dosageForm, strength: rec.strength } })),
    state.existingSlugs,
  );
  stats.slugCollisions = [...newSlugs.values()].filter((s) => /-\d+$/.test(s)).length;

  // 3) medicines — idempotent upsert (FTS triggers keep search indexes live).
  const medStmt = tx.prepare(MEDICINE_UPSERT);
  const medIdBySid = new Map<number, number>();
  for (const rec of items) {
    const existingId = state.medIdBySrc.get(rec.sourceProductId);
    const slug = state.medSlugBySrc.get(rec.sourceProductId) ?? newSlugs.get(rec.sourceProductId) ?? `medicine-${rec.sourceProductId}`;
    const status = rec.duplicateOf != null ? 'NEEDS_RECHECK' : rec.validation.status;
    const row = medStmt.get(
      state.sourceId, rec.sourceProductId, rec.name, rec.nameBn, slug, rec.genericName, rec.genericSourceId,
      rec.strength, rec.dosageForm, rec.productType, rec.prescriptionRequired ? 1 : 0, rec.activeStatus,
      rec.allowSales ? 1 : 0, rec.variantCount, rec.minQty, rec.maxQty, status,
      JSON.stringify(rec.missingFields),
      `https://www.arogga.com/product/${rec.sourceProductId}/${slug}`,
      companyIds.get(rec.companyKey) ?? null,
      rec.categoryKey ? categoryIds.get(rec.categoryKey) ?? null : null,
      now, now, now, now,
    ) as { id: number };
    medIdBySid.set(rec.sourceProductId, row.id);
    if (existingId != null) stats.updated++; else stats.imported++;
    state.medIdBySrc.set(rec.sourceProductId, row.id);
    if (!state.medSlugBySrc.has(rec.sourceProductId)) {
      state.medSlugBySrc.set(rec.sourceProductId, slug);
      state.existingSlugs.add(slug);
    }
  }

  // 4) prices — idempotent upsert; changed existing prices append to history.
  const priceStmt = tx.prepare(PRICE_UPSERT);
  const histStmt = tx.prepare(
    `INSERT INTO price_history (medicine_id, regular_base, offer_base, regular_sales, offer_sales,
       changed_fields, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const price = (v: number | null | undefined) => (v == null ? null : v);
  for (const rec of items) {
    const medId = medIdBySid.get(rec.sourceProductId);
    if (medId == null) continue;
    const p = rec.prices;
    priceStmt.run(
      medId, p.baseUnit, price(p.baseUnitMultiplier), price(p.regularBase), price(p.offerBase),
      p.salesUnit, price(p.salesUnitMultiplier), price(p.regularSales), price(p.offerSales),
      price(p.discountPercent), p.priceSource, now,
    );
    const old = state.priceRowByMed.get(medId);
    if (old) {
      if (priceKeyOf(old) !== rec.priceChangedKey) {
        histStmt.run(medId,
          old.regular_base == null ? null : Number(old.regular_base),
          old.offer_base == null ? null : Number(old.offer_base),
          old.regular_sales == null ? null : Number(old.regular_sales),
          old.offer_sales == null ? null : Number(old.offer_sales),
          JSON.stringify(['regular_base', 'offer_base', 'regular_sales', 'offer_sales']), now);
        stats.priceHistoryAppended++;
      } else {
        stats.unchanged++;
      }
    }
    state.priceRowByMed.set(medId, {
      regular_base: p.regularBase, offer_base: p.offerBase,
      regular_sales: p.regularSales, offer_sales: p.offerSales,
      base_unit: p.baseUnit, base_unit_multiplier: p.baseUnitMultiplier,
      sales_unit: p.salesUnit, sales_unit_multiplier: p.salesUnitMultiplier,
      discount_percent: p.discountPercent, min_qty: rec.minQty, max_qty: rec.maxQty,
    });
  }

  // 5) images — first 5 per medicine.
  const imgStmt = tx.prepare(
    `INSERT INTO product_images (medicine_id, url, title, is_primary, available)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT (medicine_id, url) DO NOTHING`,
  );
  for (const rec of items) {
    const medId = medIdBySid.get(rec.sourceProductId);
    if (medId == null) continue;
    for (let i = 0; i < rec.images.length && i < 5; i++) {
      imgStmt.run(medId, rec.images[i].url, rec.images[i].title, i === 0 ? 1 : 0);
    }
  }

  // 6) primary category links.
  const mcStmt = tx.prepare(
    `INSERT INTO medicine_categories (medicine_id, category_id, is_primary)
     VALUES (?, ?, 1)
     ON CONFLICT (medicine_id, category_id) DO UPDATE SET is_primary = 1`,
  );
  for (const rec of items) {
    const medId = medIdBySid.get(rec.sourceProductId);
    const catId = rec.categoryKey ? categoryIds.get(rec.categoryKey) : undefined;
    if (medId != null && catId != null) mcStmt.run(medId, catId);
  }

  // 7) validation rows — one per medicine per batch (no unique constraint).
  const valStmt = tx.prepare(
    `INSERT INTO data_validations (medicine_id, import_job_id, status, issues, conflicts, duplicate_of, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const rec of items) {
    const medId = medIdBySid.get(rec.sourceProductId);
    if (medId == null) continue;
    valStmt.run(medId, jobId, rec.duplicateOf != null ? 'NEEDS_RECHECK' : rec.validation.status,
      JSON.stringify(rec.validation.issues ?? []), JSON.stringify(rec.validation.conflicts ?? []),
      rec.duplicateOf != null ? (state.medIdBySrc.get(rec.duplicateOf) ?? null) : null, now);
  }

  return stats;
}

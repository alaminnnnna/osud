/* Medora — Drizzle schema for the embedded SQLite database.
   Mirrors migrations/sqlite/0001_init.sql. Used for typed queries where they
   are clearer than raw SQL; the search engine and bulk upserts keep
   parameterized SQL through the same connection for exact semantics. */
import { sqliteTable, integer, text, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const sources = sqliteTable('sources', {
  id: integer('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiEndpoint: text('api_endpoint'),
  robotsNote: text('robots_note'),
  createdAt: text('created_at').notNull(),
});

export const companies = sqliteTable('companies', {
  id: integer('id').primaryKey(),
  sourceId: integer('source_id').notNull(),
  sourceKey: text('source_key').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('companies_source_key_uq').on(t.sourceId, t.sourceKey),
]);

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey(),
  sourceId: integer('source_id').notNull(),
  sourceKey: text('source_key').notNull(),
  type: text('type'),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  parentId: integer('parent_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('categories_source_key_uq').on(t.sourceId, t.sourceKey),
]);

export const medicines = sqliteTable('medicines', {
  id: integer('id').primaryKey(),
  sourceId: integer('source_id').notNull(),
  sourceProductId: integer('source_product_id').notNull(),
  name: text('name').notNull(),
  nameBn: text('name_bn'),
  slug: text('slug').notNull().unique(),
  genericName: text('generic_name'),
  genericSourceId: integer('generic_source_id'),
  strength: text('strength'),
  dosageForm: text('dosage_form'),
  productType: text('product_type'),
  prescriptionRequired: integer('prescription_required', { mode: 'boolean' }).notNull().default(false),
  activeStatus: text('active_status'),
  allowSales: integer('allow_sales', { mode: 'boolean' }).notNull().default(true),
  variantCount: integer('variant_count'),
  minQty: integer('min_qty'),
  maxQty: integer('max_qty'),
  verificationStatus: text('verification_status').notNull().default('PARTIALLY_VERIFIED'),
  missingFields: text('missing_fields').notNull().default('[]'),
  sourceUrl: text('source_url'),
  companyId: integer('company_id'),
  primaryCategoryId: integer('primary_category_id'),
  lastImportedAt: text('last_imported_at').notNull(),
  lastVerifiedAt: text('last_verified_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('medicines_source_product_uq').on(t.sourceId, t.sourceProductId),
  index('medicines_company_idx').on(t.companyId),
]);

export const medicinePrices = sqliteTable('medicine_prices', {
  medicineId: integer('medicine_id').primaryKey(),
  baseUnit: text('base_unit'),
  baseUnitMultiplier: integer('base_unit_multiplier'),
  regularBase: text('regular_base'),
  offerBase: text('offer_base'),
  salesUnit: text('sales_unit'),
  salesUnitMultiplier: integer('sales_unit_multiplier'),
  regularSales: text('regular_sales'),
  offerSales: text('offer_sales'),
  discountPercent: text('discount_percent'),
  priceSource: text('price_source').notNull().default('api'),
  scrapeRunId: integer('scrape_run_id'),
  updatedAt: text('updated_at').notNull(),
});

export const priceHistory = sqliteTable('price_history', {
  id: integer('id').primaryKey(),
  medicineId: integer('medicine_id').notNull(),
  regularBase: text('regular_base'),
  offerBase: text('offer_base'),
  regularSales: text('regular_sales'),
  offerSales: text('offer_sales'),
  changedFields: text('changed_fields').notNull().default('[]'),
  scrapeRunId: integer('scrape_run_id'),
  recordedAt: text('recorded_at').notNull(),
});

export const productImages = sqliteTable('product_images', {
  id: integer('id').primaryKey(),
  medicineId: integer('medicine_id').notNull(),
  url: text('url').notNull(),
  cdnKey: text('cdn_key'),
  title: text('title'),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  available: integer('available', { mode: 'boolean' }).notNull().default(true),
  validatedAt: text('validated_at'),
}, (t) => [
  uniqueIndex('product_images_medicine_url_uq').on(t.medicineId, t.url),
]);

export const medicineCategories = sqliteTable('medicine_categories', {
  medicineId: integer('medicine_id').notNull(),
  categoryId: integer('category_id').notNull(),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  assignedAt: text('assigned_at').notNull(),
}, (t) => [primaryKey({ columns: [t.medicineId, t.categoryId] })]);

export const scrapeRuns = sqliteTable('scrape_runs', {
  id: integer('id').primaryKey(),
  runId: text('run_id').notNull().unique(),
  mode: text('mode').notNull(),
  source: text('source').notNull().default('crawl'),
  status: text('status').notNull().default('running'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  durationMs: integer('duration_ms'),
  apiRequests: integer('api_requests'),
  pagesDiscovered: integer('pages_discovered'),
  pagesProcessed: integer('pages_processed'),
  productsCollected: integer('products_collected'),
  coveragePct: text('coverage_pct'),
  fullCoverage: integer('full_coverage', { mode: 'boolean' }),
  stats: text('stats'),
  coverageGaps: text('coverage_gaps'),
});

export const importJobs = sqliteTable('import_jobs', {
  id: integer('id').primaryKey(),
  scrapeRunId: integer('scrape_run_id'),
  mode: text('mode').notNull().default('full'),
  status: text('status').notNull().default('running'),
  inputFiles: text('input_files').notNull().default('[]'),
  totals: text('totals'),
  checkpoint: text('checkpoint'),
  error: text('error'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
});

export const dataValidations = sqliteTable('data_validations', {
  id: integer('id').primaryKey(),
  medicineId: integer('medicine_id').notNull(),
  importJobId: integer('import_job_id'),
  status: text('status').notNull(),
  issues: text('issues'),
  conflicts: text('conflicts'),
  duplicateOf: integer('duplicate_of'),
  checkedAt: text('checked_at').notNull(),
});

export const slugRedirects = sqliteTable('slug_redirects', {
  id: integer('id').primaryKey(),
  oldSlug: text('old_slug').notNull().unique(),
  newSlug: text('new_slug').notNull(),
  createdAt: text('created_at').notNull(),
});

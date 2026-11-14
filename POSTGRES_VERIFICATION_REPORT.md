# POSTGRES_VERIFICATION_REPORT — Medora Phase 3

Date: 2026-11-14 · Environment: Linux sandbox, **no Docker available** — PostgreSQL run from
official binaries (`embedded-postgres` npm package, PostgreSQL 18.6, x86_64) as an
unprivileged local cluster on `127.0.0.1:5433`, database `medora`.
Dataset: `data/products.jsonl` (630 MB crawl output, 107,396 lines). Dataset was **not modified**.

---

## 1. Commands executed (real outputs)

### 1.1 Cluster bootstrap (not part of npm scripts — documented for reproducibility)
```
initdb -D platform/.pgdata -U medora -A trust -E UTF8 --locale=C   → OK
pg_ctl -D platform/.pgdata -o "-p 5433 -c listen_addresses=127.0.0.1 -k /tmp" start
  → server started (PID 7695)
CREATE DATABASE medora (via node-pg to the default postgres database)
SELECT version() → "PostgreSQL 18.6 on x86_64-pc-linux-gnu"
```

### 1.2 `npm run db:migrate` — PASSED
```
→ applying 0001_init.sql ... done
→ applying 0002_search.sql ... done
Migration complete (2 applied, 2 total).
```
Tables created: sources, companies, categories, medicines, medicine_categories, scrape_runs,
medicine_prices, price_history, product_images, import_jobs, data_validations, slug_redirects
(+ `_medora_migrations` ledger). Extensions: pg_trgm, generated `search_vector` tsvector.

### 1.3 `npm run import:data` — PASSED (11–12 s wall clock)
```
Medora import — mode: full
import job 1 started (mode: full)
── Totals ──
  inputRecords             107,396
  parsedRecords            58,297
  importedRecords          58,297
  updatedRecords           0
  unchangedRecords         0
  skippedRecords           0
  failedRecords            0
  corruptLines             0
  duplicateCandidates      49,174
  missingImages            2,390
  invalidPrices            142
  priceHistoryAppended     0
  slugCollisionsResolved   1,777
  durationMs               12,330
```
(First two attempts failed on real bugs — see §4; fixed before this clean run.)

### 1.4 `npm run db:verify` — ALL CHECKS PASSED
```
── Row counts ──
  medicines    58297      companies  1414      categories 1000
  prices       58297      history    0         images     79919
  validations  58297      runs       1         imports    1
  redirects    0
── Verification ──
  ✓ medicines imported — 58297 rows
  ✓ no orphan rows — 0 found
  ✓ slugs unique — clean
  ✓ price units not collapsed — 0 suspicious rows
  ✓ spot check Napa 500 generic — Paracetamol
  ✓ spot check Napa 500 prices — base 1.20/1.08 · sales 12.00/10.80
  ✓ spot check Napa 500 units — Tablet/Strip
```

### 1.5 Deep JSONL ↔ DB integrity comparison (`platform/scripts/db-integrity.ts`) — INTEGRITY OK
```
JSONL unique records: 58297
companies: JSONL distinct keys 1414 vs DB 1414 → MATCH
categories: JSONL distinct keys 1000 vs DB 1000 → OK
product images: JSONL pairs 84754 vs DB 79919 → OK (DB caps 5 per medicine)
Field-level comparison (every 2000th unique record): sampled 30 records → 0 mismatches
  (name, generic, regular_base, offer_base, regular_sales, offer_sales,
   sales_unit, sales_unit_multiplier, company link all compared)
rows where regular_sales ≠ regular_base × multiplier: 1 (source-listed value kept as-is)
provenance: scrape_runs 1, import_jobs 1, slug_redirects 0 (no renames yet — reserved)
```

### 1.6 Idempotency re-run
Second full import reproduced identical counts (58,297 imported, 0 failed) with identical
slugs — verified by spot-checking `12474 → napa-500-tablet`, `17335 → sergel-20-capsule`
before and after. The full import truncates and rebuilds the catalog so counts are exact;
`import:resume` continues a checkpointed job instead.

### 1.7 Price-history recording (via authenticated ingestion, real DB writes)
```
POST /api/v1/ingest/records  (Napa 500, pv_b2c_price 10.80 → 9.99)
  → applied: {"imported":0,"updated":1,"priceHistoryAppended":1}
  → price_history rows for medicine: 0 → 1
  → medicine_prices.offer_sales = 9.99
POST /api/v1/ingest/records  (original record restored)
  → offer_sales back to 10.80, price_history now 2 entries (append-only by design)
```

## 2. The 107,396 / 58,297 / 58,222 discrepancy — investigated and resolved

| Number | Meaning |
| --- | --- |
| 107,396 | JSONL lines = 58,297 unique product IDs + 49,099 exact-ID repeats (parent/leaf crawl overlap — deduplicated by design) |
| 58,297 | Unique IDs in the original dataset (`validation-report.json`, crawl report) |
| 58,222 | Phase-2 dry-run "parsed" count — **75 fewer** |

Root cause (verified, not guessed): the Phase-2 importer counted records whose content
fingerprint (name|strength|generic|company|form|pack) matched an earlier record as
"duplicate candidates" and **skipped them entirely**. 75 of the 58,297 unique IDs are such
uncertain duplicates (e.g. `manforce-xotic-strawberry-flavoured-1500-dots-condom-10pcs-pack-2`,
same listing under two category IDs). They are real, distinct source records.

Resolution (Phase 3): uncertain duplicates are now **imported and flagged, never merged and
never discarded** — `data_validations.duplicate_of` points at the first-seen record and the
status is forced to `NEEDS_RECHECK`. After the fix, the DB holds exactly 58,297 medicines:
```
duplicate_of flags: 75        NEEDS_RECHECK validations: 217 (142 price anomalies + 75 duplicates)
```
Note: the Phase-2 dry-run had also under-counted slug collisions (154 simulated vs 1,777 in
DB): the DB-side counter flags any slug ending in `-N`, which includes natural product names
with digits (e.g. "Sodium Chloride 0.9"). Slug **uniqueness** itself is enforced by the DB
unique index — 0 violations. No data was invented or discarded.

## 3. Data integrity checks vs. requirements

| Requirement | Result |
| --- | --- |
| Imported medicine count = unique IDs | ✅ 58,297 |
| Unique IDs | ✅ 58,297 distinct source_product_id, unique constraint on (source_id, source_product_id) |
| Duplicate handling | ✅ 49,099 exact repeats deduped; 75 uncertain duplicates imported + flagged (duplicate_of + NEEDS_RECHECK); zero auto-merges |
| Company relationships | ✅ 1,414 companies; JSONL distinct company keys 1,414 → MATCH; medicines.company_id FK resolved for all records |
| Category relationships | ✅ 1,000 categories (names from site-tree harvest); 58,297 medicine_categories primary links |
| Product images | ✅ 79,919 image rows (of 84,754 source pairs; capped 5/medicine); primary image flag set |
| Regular base prices (`pv_mrp`) | ✅ field-exact on 30-record sample + Napa spot check |
| Offer base prices (`pv_b2c_discounted_price`) | ✅ field-exact |
| Regular sales prices (`pv_b2c_mrp`) | ✅ field-exact |
| Offer sales prices (`pv_b2c_price`) | ✅ field-exact |
| Sales-unit labels (`pu_b2c_sales_unit_label`) | ✅ field-exact (Strip/Tablet/Bottle…) |
| Sales-unit multipliers (`pu_b2c_base_unit_multiplier`) | ✅ field-exact; 1 source-listed anomaly preserved as-is (not "corrected") |
| Price history | ✅ append-only verified via real ingestion (0→1→2 entries; snapshots + changed_fields + recorded_at) |
| Slug uniqueness | ✅ unique index, 0 violations; stable across re-imports |
| Redirect records | ✅ table live; 0 rows (no slug renames have occurred yet — exercised via API path, 404 fallback verified) |
| Verification status | ✅ VERIFIED / PARTIALLY_VERIFIED / NEEDS_RECHECK / FAILED distributed per record |
| Missing-data tracking | ✅ missing_fields[] populated (2,390 records with 'image missing'); missingImages count matches crawl report exactly |

## 4. Real bugs found and fixed during verification

1. `companies.source_company_id` INSERT referenced a column dropped from the final schema → removed from upsert.
2. PostgreSQL `unnest` flattens 2-D arrays to scalars → `missing_fields` now transported as JSON text + `array_agg` re-aggregation; `changed_fields` written as a constant array literal.
3. Empty `missing_fields` aggregated to NULL violating NOT NULL → `COALESCE('{}'::text[])`.
4. Cross-batch `duplicate_of` resolution (17 of 75 flags pointed at earlier-batch rows) → resolved via global state map.
5. Search tie-break favored insertion recency over name → deterministic `ORDER BY score DESC, name ASC`; fuzzy matching extended to generic names (typo `paracetmol` → Paracetamol products).
6. Ingestion 500 (`changed_fields does not exist`) caught by the live test and fixed.

## 5. Unresolved issues

None blocking. Known limitations (documented, not defects):
- The in-memory rate limiter is per-instance (Redis needed for multi-instance).
- `import:data` (full mode) truncates the catalog first; use `import:resume` for incremental continuation of an interrupted job.
- The 75 flagged duplicates remain separate products pending manual review (by design).
- 1 source-listed price-consistency anomaly preserved verbatim (do not fabricate corrections).

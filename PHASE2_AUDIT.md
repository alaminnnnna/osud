
> **Phase 4 update (2026-11-14):** This document is preserved as a historical
> record of the phase it describes. Statements about the architecture —
> separate backend/frontend deployments, PostgreSQL as the live database,
> static-site frontend, Express API — are **superseded**: Medora is now one
> unified Next.js application (frontend + `/api/v1` on one origin) over an
> **embedded SQLite database** (`data/medora.sqlite`, no external database
> service). See `PHASE4_COMPLETION_REPORT.md` and `README.md`. The measured
> results below are kept exactly as they were recorded.

# PHASE 2 AUDIT — Medora (Bangladesh Medicine Price Database)

Audit date: 2026-11-14 · Auditor: automated inspection pass
Scope: existing Phase-1 deliverable (scraper + static platform) → production backend plan.

---

## 1. Verified existing state (tested, not assumed)

### 1.1 Existing test results
| Check | Result |
| --- | --- |
| `scripts/verify.js` (dataset + bundle integrity, 41 assertions) | **41/41 PASS** |
| JSONL integrity scan (`data/products.jsonl`) | 107,396 lines parsed, **0 corrupt**, 58,297 unique product IDs, 49,099 duplicate raw lines (parent/leaf crawl overlap — deduplicated by design) |
| Dataset consistency | `crawl-report.json`: 1,894/1,894 bucket pages processed, 6 failed requests (2 retired product IDs + 4 detail-verification retries), 2 facet-coverage gaps (10 rows), reconciliation recovered 2,433/2,435 sitemap-only products |
| Validation summary | VERIFIED 23,499 · PARTIALLY_VERIFIED 34,656 · NEEDS_RECHECK 142 · FAILED 0 · missingPrices 0 · missingImages 2,390 · price-unit conflicts 142 |
| Functional UI tests (Playwright, prior phase) | sheets, keyboard nav, favourites, compare, theme — all pass; 2 screenshot-audit rounds with fixes |
| **Not covered by existing tests** | No automated frontend unit tests; no DB layer (does not exist yet); no API contract tests |

### 1.2 Existing architecture
- **`scrape.js`** (2,398 lines, single file, zero deps): discovery → category sweep → bucket partition (category → form → brand, API window ≈1,000 rows) → crawl → sitemap reconciliation → consolidation → validation → history → data files → static web bundles. Checkpoint/resume, graceful SIGINT, rate limiting, retries.
- **`data/`** (630 MB): `products.jsonl` (raw provenance, per-line `_meta {runId, bucket, page}`), `products.json` (normalized + validation), `products.csv`, `prices.json` (current price per product), `price-history.json` (append-only; 107 B on first run — grows on re-runs), `companies/generics/categories/images.json`, `crawl-progress.json` (checkpoint), `failed-records.json`, `validation-report.json`, `crawl-report.json`.
- **`web/`** (static, no build): hash-router SPA (home, search, medicine `#/m/:slug`, companies, categories, offers, compare, api-docs, about, admin dashboard) + prerendered SEO pages (`m/`, `companies/`, `categories/`), generated bundles (`assets/js/db/`: meta, dicts, slugs, postings index, history, 59 chunks), static file API (`api/v1/*` + OpenAPI), sitemap index + parts, `robots.txt`, `404.html` fallback. Design system in `assets/css/tokens.css` (light + deep dark), documented in `web/DESIGN.md`.

### 1.3 Data semantics that MUST be preserved
| Column meaning | Source field |
| --- | --- |
| regular base-unit price | `pv_mrp` |
| offer base-unit price | `pv_b2c_discounted_price` |
| regular sales-unit price | `pv_b2c_mrp` |
| offer sales-unit price | `pv_b2c_price` |
| sales unit label | `pu_b2c_sales_unit_label` |
| base→sales multiplier | `pu_b2c_base_unit_multiplier` |

Base-unit and sales-unit prices are stored separately and never derived from each other. B2B fields (`pv_b2b_*`) are excluded from customer-facing surfaces. Offer = as listed (even −99% flash offers such as Esmosec 40 IV ৳95→৳1 — verified to come directly from the source API).

Slug rule (from `buildSlugs`): `slugify(name + ' ' + dosageForm)`, collision → `+ strength`, then `-2…-999`, then `medicine-{id}`. Slugs are price-independent and must become stable canonical keys.

## 2. Database migration requirements
1. 12 tables: Medicine, Company, Category, MedicineCategory, MedicinePrice, PriceHistory, ProductImage, Source, ScrapeRun, ImportJob, DataValidation, SlugRedirect.
2. Stable IDs: keep `(source, sourceProductId)` as the natural unique key; surrogate PK for joins.
3. Canonical unique slugs; `SlugRedirect` for renames (currently an empty reserved map in the static build).
4. Deduplication **without unsafe merging**: exact source-ID dedup on import; fuzzy candidates → `DataValidation` rows, reported, never auto-merged.
5. Provenance: every medicine/price row traces to `Source` + `ScrapeRun` + `ImportJob`.
6. Price history: on any price change, append `PriceHistory` snapshot with `changedFields` and recording timestamp; never delete.
7. Missing-data tracking: `missingFields text[]` + `verificationStatus` on Medicine; images in `ProductImage.available`.
8. Import engine must be streaming (107k-line JSONL ≈ 393 MB), batched, transactional, checkpointed, idempotent, and generate `IMPORT_REPORT.md`.

## 3. Missing features (Phase-2 scope)
No database · no dynamic API (static file API only) · no server-side search (client postings index) · no authentication (admin view is public read-only transparency dashboard) · no ingestion auth · no old-slug redirects (reserved, empty) · no dynamic sitemaps (regenerated statically) · no Next.js frontend · no rate limiting (static files).

## 4. Risks
| Risk | Mitigation |
| --- | --- |
| 58k-row import performance / memory | streaming readline, 500-row batches, single prepared upsert, checkpoint every N batches |
| Slug collisions on import | deterministic suffixing + DB-backed uniqueness check per batch |
| Serverless (Vercel) Postgres connections | pooled connection string (PgBouncer), small pool, `no-store` for dynamic routes |
| Catalog drift between runs | idempotent upserts keyed on (source, sourceProductId); `ScrapeRun` ledger; price changes append history |
| Search quality parity with client engine | FTS (simple/english) + pg_trgm + deterministic rank expression (§ of PLATFORM_GUIDE), verified against sample queries once a live DB exists |
| In-memory rate limiting | per-instance only; Redis noted for multi-instance |
| Environment constraints of this sandbox | **No PostgreSQL/Docker available here** — live DB paths are NOT tested in this environment; see §7 test matrix |

## 5. Files that must remain unchanged
- `scrape.js` — independent; receives one optional, non-breaking addition (env-gated run-summary POST after consolidation, § Phase 9).
- `data/**` — read-only inputs to the importer.
- `web/**` — the working static frontend is preserved verbatim (design reference + fallback; later Next.js migration consumes the API without touching these files).
- `web/DESIGN.md`, `README.md` — extended only where Phase 2 adds sections.

## 6. Implementation sequence (executed in this phase)
1. `platform/` workspace: config (zod), pg pool, schema + versioned SQL migrations with ledger (`npm run db:migrate`).
2. Import engine: normalize/validate (mirrors scrape.js rules) → streaming importer (JSON/JSONL, checkpoint/resume, idempotent upserts, price history, validation rows, duplicate candidates) → `db:verify` → `IMPORT_REPORT.md`.
3. REST API `/api/v1/*` (Express): medicines, search (+suggestions), offers, companies, categories, price-history, health, stats — envelope `{success, data, pagination}`, rate limiting, CORS, cache headers, safe errors, request logging.
4. SEO: dynamic sitemap index + partitions, robots.txt, old-slug 301s from `SlugRedirect`.
5. Admin: `/admin` dashboard (server-rendered, HTTP Basic auth) + admin JSON endpoints; ingestion endpoint (bearer token, zod-validated, idempotent).
6. `scrape.js` optional ingest hook; platform README with Vercel/Render guides.

## 7. Test matrix — what is verified in THIS environment (honest)
| Layer | Verified here | Requires live PostgreSQL |
| --- | --- | --- |
| Config/env schema (zod) | ✅ typecheck + boot | — |
| Record normalization + validation rules (58,297 records replayed from JSONL) | ✅ dry-run executed | — |
| Slug generation + collision handling | ✅ dry-run executed | — |
| Import checkpoint/resume/report generation | ✅ dry-run executed | — |
| TypeScript compile (`tsc --noEmit`) | ✅ | — |
| SQL migrations applied | ❌ | ✅ run `npm run db:migrate` |
| Import → DB upserts, history | ❌ | ✅ run `npm run import:data` |
| API endpoints / search ranking | ❌ | ✅ `npm run dev` |
| Sitemap/robots/admin/ingest endpoints | ❌ | ✅ |
| Prisma schema parity | ✅ reviewed against SQL | apply with `prisma migrate` if adopting Prisma client |

## 8. Stack decision (documented deviation)
Preferred stack asks for Prisma. `prisma generate` requires binary engine downloads; to keep `npm i` fully reproducible in restricted environments, the runtime data layer uses **node-postgres (`pg`) + zod** with the identical schema, and the canonical **`prisma/schema.prisma`** ships alongside with a migration guide (`platform/PRISMA.md`). Moving to `@prisma/client` is mechanical: `prisma migrate dev` against the same tables, swap `src/db.ts`.

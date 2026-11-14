
> **Phase 4 update (2026-11-14):** This document is preserved as a historical
> record of the phase it describes. Statements about the architecture —
> separate backend/frontend deployments, PostgreSQL as the live database,
> static-site frontend, Express API — are **superseded**: Medora is now one
> unified Next.js application (frontend + `/api/v1` on one origin) over an
> **embedded SQLite database** (`data/medora.sqlite`, no external database
> service). See `PHASE4_COMPLETION_REPORT.md` and `README.md`. The measured
> results below are kept exactly as they were recorded.

# Medora Platform — Production Backend

Database-backed REST API, import engine, server-side search, admin dashboard and
scraper ingestion for the Bangladesh medicine price catalogue.

> **Status of testing in this repo:** the TypeScript layer compiles clean
> (`npm run typecheck`) and the full 107,396-line dataset was replayed through the
> importer in dry-run mode (58,222 unique records validated, 49,174 duplicate
> candidates reported, 142 price anomalies flagged — see `IMPORT_REPORT.md`).
> PostgreSQL is **not available in the build sandbox**, so live-DB paths
> (`db:migrate` → `import:data` → API endpoints) were **not executed here** —
> run the four commands below against any PostgreSQL 14+ instance to complete
> that verification.

## Quick start

```bash
cd platform
cp .env.example .env            # edit DATABASE_URL + tokens
docker compose up -d            # local PostgreSQL 16 (or use Render/Vercel/Neon)
npm install
npm run db:migrate              # applies db/migrations/*.sql idempotently
npm run import:data             # imports ../data/products.jsonl (58k records)
npm run db:verify               # counts, orphans, slug uniqueness, Napa 500 spot check
npm run dev                     # API on http://localhost:4000
```

| Script | What it does |
| --- | --- |
| `db:migrate` | applies `db/migrations/*.sql` in order, tracked in `_medora_migrations` |
| `import:data` | full streaming import (JSON/JSONL), batched transactions, report → `IMPORT_REPORT.md` |
| `import:resume` | continues the latest checkpointed import job |
| `import:dry-run` | validates all records + slug assignment without any DB writes |
| `db:verify` | post-import verification (counts, orphans, unit sanity, spot check) |
| `dev` / `build` / `start` | API server (tsx watch / tsc / node dist) |

## API — `/api/v1`

Envelope: `{ "success": true, "data": ..., "pagination": { page, limit, total, totalPages } }`
Errors: `{ "success": false, "error": { code, message } }` — no stack traces, no credentials.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/medicines` | filters: `company, category, form, type, rx, offer, min, max`; sorts: `name, price-asc, price-desc, discount, recent`; server-side pagination (`page`, `limit` ≤ 100) |
| GET | `/api/v1/medicines/:slug` | full record + price history + images + related; numeric `:id` (source product id) also accepted |
| GET | `/api/v1/medicines/:id` | stable source-id lookup |
| GET | `/api/v1/medicines/:slug/price-history` | append-only history with changed fields + timestamps |
| GET | `/api/v1/search?q=` | server-side FTS + trigram search with ranking (see below) |
| GET | `/api/v1/search/suggestions?q=` | 8 product suggestions + generic-name terms |
| GET | `/api/v1/offers` | only items whose listed offer is genuinely below regular (`sort=discount,recent,price-asc`) |
| GET | `/api/v1/companies` · `/companies/:slug` | directory + detail with paginated medicines |
| GET | `/api/v1/categories` · `/categories/:slug` | directory + detail |
| GET | `/api/v1/health` · `/stats` | DB ping / dataset stats + last crawl run |
| GET | `/sitemap.xml`, `/sitemap-*.xml`, `/robots.txt` | dynamic, partitioned (20k URLs/file) |
| POST | `/api/v1/ingest/runs` · `/ingest/records` | **bearer token** (`INGEST_TOKEN`); zod-validated; idempotent; never merges |
| GET | `/api/v1/admin/metrics` + `/admin` | **HTTP Basic auth** (`ADMIN_USERNAME`/`ADMIN_PASSWORD`); disabled unless both are set |

Search ranking (deterministic, in-DB): exact name 1000 · exact company 800 ·
name prefix 600 · strong partial (name/generic/company) 400 · 200×`similarity()`
· 100×`ts_rank` · partial company 150. Extensions used: `pg_trgm`, generated
`search_vector` tsvector (migration `0002_search.sql`).

Rate limiting: fixed window per IP (`RATE_LIMIT_PER_MINUTE`, default 120/min,
`X-RateLimit-*` headers) — per-instance; use Redis behind a load balancer.
CORS: `ACCESS_CONTROL_ORIGIN` (`*` or comma-separated origins). Cache-Control:
`public, max-age=60, stale-while-revalidate=300` on lists, `no-store` on
admin/ingest.

## Price semantics (invariants)

| DB column | Source field | Meaning |
| --- | --- | --- |
| `medicine_prices.regular_base` | `pv_mrp` | regular price per **base unit** (e.g. Tablet) |
| `medicine_prices.offer_base` | `pv_b2c_discounted_price` | offer price per base unit |
| `medicine_prices.regular_sales` | `pv_b2c_mrp` | regular price per **sales unit** (e.g. Strip) |
| `medicine_prices.offer_sales` | `pv_b2c_price` | offer price per sales unit |
| `medicine_prices.sales_unit` | `pu_b2c_sales_unit_label` | customer-facing pack label |
| `medicine_prices.sales_unit_multiplier` | `pu_b2c_base_unit_multiplier` | units per sales pack |

Base-unit and sales-unit prices are stored separately and never derived from
each other. `discount_percent` is stored as listed, never recomputed. B2B
fields are not imported into customer-facing tables. Anomalous rows (offer >
regular) are preserved as-is and flagged in `data_validations`.

## Idempotency & provenance

- Natural key: `(source_id, source_product_id)`; slugs are unique, assigned once
  and never changed by price/name updates; renames go through `slug_redirects`.
- Re-imports leave unchanged rows untouched; price changes append to
  `price_history` (snapshot + `changed_fields` + `recorded_at`).
- Every price row can be traced to `scrape_runs` and `import_jobs`; the crawler's
  `crawl-report.json` is registered as a `scrape_run` on import.
- Duplicate candidates (same fingerprint, different source id) are stored in
  `data_validations` and reported — **no automatic merging**.

## Scraper integration (Phase 9)

`scrape.js` stays independent. If `MEDORA_INGEST_URL` + `MEDORA_INGEST_TOKEN`
are set in its environment, it posts a non-blocking run summary to
`POST /api/v1/ingest/runs` after consolidation. Record-level ingestion is done
by `POST /api/v1/ingest/records` (validated batches ≤ 5000, same upsert pipeline
as the importer). A failed ingest never fails the crawl.

## Deployment

### Render
1. New → **PostgreSQL**; copy the *Internal Database URL*.
2. New → **Web Service** (repo root `platform/`):
   - Build: `npm install && npm run build`
   - Start: `npm run start`
   - Env: `DATABASE_URL` (internal URL), `ACCESS_CONTROL_ORIGIN` (frontend origin), admin/ingest tokens.
3. One-off shell (Render dashboard) or release command:
   `npm run db:migrate && npm run import:data` (first deploy only; re-runs are idempotent).

### Vercel
1. Project root `platform/` (Node runtime; `api` endpoints served via the Express app in `api/index.js` wrapper or deploy as a serverless function — simplest: deploy as a Render-style Node service, or use `@vercel/node` with `dist/server.js`).
2. Set `DATABASE_URL` to the **pooled** connection string (PgBouncer/transaction mode) — serverless functions must not hold dedicated connections.
3. Run migrations + first import from a workstation pointing at the non-pooled URL.

### Frontend
The existing `web/` static app remains the working frontend (unchanged). The
dynamic Next.js migration is specified in `PHASE2_AUDIT.md` §6 and consumes this
API as-is; the static file API and this REST API share the same item schema.

## Verified / not verified (honesty matrix)

| Layer | Verified in this repo |
| --- | --- |
| TypeScript compile (`npm run typecheck`) | ✅ clean |
| Record validation over the real dataset (107,396 lines) | ✅ dry-run: 58,222 unique parsed, 0 corrupt, 0 schema failures |
| Slug assignment + collision handling | ✅ dry-run: 109 collisions resolved deterministically |
| Checkpoint/report generation | ✅ `IMPORT_REPORT.md` |
| SQL migrations applied | ❌ requires PostgreSQL (run `npm run db:migrate`) |
| Import upserts, history, API queries | ❌ requires PostgreSQL |
| Admin/ingest/sitemap endpoints | ❌ requires PostgreSQL |

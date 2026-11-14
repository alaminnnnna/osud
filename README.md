# Medora — Bangladesh Medicine Price Intelligence Platform

Medora is a **self-contained medicine price discovery and comparison platform**
for Bangladesh. One repository contains everything: the unified Next.js
application (frontend **and** REST API), its **embedded SQLite database** with
the full verified dataset of **58,297 medicine records**, the independent
scraper, and all operational tooling.

**No separately rented database service is required.** The database lives in
the project as `data/medora.sqlite`.

> This is a **price catalogue** — it is not medical advice, not a pharmacy, and
> it never prescribes or recommends treatments.

---

## Architecture (Phase 4)

```text
medora/
├── web/                     # ONE unified application
│   ├── app/                 #   Next.js 15 App Router (frontend pages)
│   │   ├── api/v1/…         #   REST API route handlers (same origin)
│   │   ├── search|companies|categories|offers|compare|admin|api-docs
│   ├── lib/server/          #   shared server layer: SQLite client (Drizzle),
│   │   │                    #     queries, search engine, ingestion, auth
│   ├── components/          #   React components (premium UI, dark/light)
│   ├── scripts/             #   db:init/migrate/verify/backup/restore, importer
│   └── package.json
├── migrations/sqlite/       # schema migrations (FTS5 search infrastructure)
├── data/
│   ├── medora.sqlite        # embedded database (created by db:init/migrator)
│   ├── products.jsonl       # original crawler dataset (58,297 unique records)
│   └── …                    # crawl, validation and failure reports
├── scrape.js                # independent Node.js scraper (no DB writes)
├── platform/                # legacy Express API + PostgreSQL tools (superseded;
│                            #   import CLI lineage and API tests still maintained)
└── package.json             # root-level commands (see below)
```

- **Frontend and API are one application on one origin.** Pages read the
  database directly through the shared service layer; the public REST API at
  `/api/v1/*` wraps the exact same functions — identical envelopes, ranking,
  rate limiting, CORS and auth semantics as the audited platform API.
- **Embedded SQLite** (`better-sqlite3` through **Drizzle ORM**): WAL mode,
  enforced foreign keys, FTS5 lexical index (`unicode61`) plus a **trigram
  fuzzy index** for typo tolerance — replacing PostgreSQL tsvector and pg_trgm.
- **The scraper stays independent**: `node scrape.js` crawls the public Arogga
  catalogue API into `data/products.jsonl` (+ validation reports). It never
  executes during a website request and never writes the database directly.
- `platform/` is retained as legacy reference (standalone Express API +
  PostgreSQL tooling). It is superseded by the unified app; the API test-suite
  (`platform/scripts/api-tests.mjs`) is maintained and can target either.

## Quick start

Requirements: Node.js ≥ 20.

```bash
npm install                 # installs web/ dependencies
npm run db:init             # create data/medora.sqlite + apply migrations
npm run import:data         # load data/products.jsonl (58,297 records, ~10 s)
npm run db:verify           # integrity + count + uniqueness checks
npm run dev                 # http://localhost:3000 (frontend + API)
```

Production:

```bash
npm run build               # Next.js production build
npm run start               # serve on :3000
npm test                    # 50-check API suite against :3000
```

## Root-level commands

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` / `lint` / `typecheck` | unified web app |
| `npm test` | 50-check API + admin + ingest + error-handling suite (`API_BASE` overrides target) |
| `npm run db:init` | create the SQLite file and apply migrations (never erases data) |
| `npm run db:migrate` | apply pending migrations (ledger in `_medora_migrations`) |
| `npm run db:verify` | integrity, counts, slug uniqueness, orphans, price semantics, FTS sync |
| `npm run db:backup` | consistent snapshot via SQLite `VACUUM INTO` (+ integrity check) |
| `npm run db:restore -- <file>` | verify + atomically replace the live database |
| `npm run import:data` | full JSONL import (idempotent upserts; fresh full import rebuilds counts) |
| `npm run import:resume` | continue a checkpointed import job |
| `npm run import:dry-run` | validation only — no database writes |
| `npm run scrape` | independent crawl → `data/products.jsonl` |

The database file defaults to `<repo>/data/medora.sqlite`; override with
`MEDORA_DB_PATH` (see `web/.env.example`).

## The database

`data/medora.sqlite` (~106 MB) contains every table of the audited PostgreSQL
schema, with IDs and semantics preserved: `sources`, `companies`, `categories`,
`medicines`, `medicine_prices`, `product_images`, `medicine_categories`,
`price_history`, `scrape_runs`, `import_jobs`, `data_validations`,
`slug_redirects` — plus `medicines_fts` (lexical) and `medicines_fuzzy`
(trigram) search indexes kept in sync by triggers.

Recovery paths (the file itself is not committed — it exceeds GitHub's 100 MB
limit; the dataset and every tool needed to rebuild it are committed):

1. **From the dataset**: `npm run db:init && npm run import:data` (~10 s).
2. **From the legacy PostgreSQL backup** (preserves price history, validation
   records, import jobs, scrape runs): `node web/scripts/migrate-pg-to-sqlite.mjs`.

## Public API (same origin as the site)

`/api/v1/medicines`, `/medicines/:slug`, `/medicines/:id`,
`/medicines/:slug/price-history`, `/search`, `/search/suggestions`, `/offers`,
`/companies`, `/companies/:slug`, `/categories`, `/categories/:slug`,
`/stats`, `/health`, plus Basic-auth `/api/v1/admin/metrics` and
bearer-token `/api/v1/ingest/records` + `/ingest/runs` for the secure
scraper ingestion pipeline. OpenAPI reference: `/api-docs`.

## Deployment

- **Render (recommended, fully self-contained)** — see
  [`DEPLOYMENT_RENDER.md`](DEPLOYMENT_RENDER.md): one web service + persistent
  disk holding the SQLite file.
- **Vercel** — see [`DEPLOYMENT_VERCEL.md`](DEPLOYMENT_VERCEL.md): honest
  limitations (ephemeral serverless filesystem); Render is the self-contained
  option.

## Data provenance & limitations

- Prices are **as listed by the public Arogga catalogue API** — never edited,
  never invented; offers are shown only when genuinely below the regular price.
- A few categories carry placeholder names (`Category 6574`) because the source
  API exposes only numeric ids for them — preserved as crawled, in both the
  legacy PostgreSQL and SQLite datasets.
- Uncertain duplicate products are **flagged** (`duplicate_of` +
  `NEEDS_RECHECK`), never merged and never discarded.

Detailed phase history: [`PHASE4_COMPLETION_REPORT.md`](PHASE4_COMPLETION_REPORT.md),
[`PHASE3_COMPLETION_REPORT.md`](PHASE3_COMPLETION_REPORT.md),
[`PHASE2_AUDIT.md`](PHASE2_AUDIT.md).

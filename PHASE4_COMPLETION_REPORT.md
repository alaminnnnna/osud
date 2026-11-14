# PHASE 4 COMPLETION REPORT — Unified Application & Self-Contained Database

**Date:** 2026-11-14
**Scope:** (a) unify frontend and backend into one Next.js application; (b) replace
the external PostgreSQL dependency with a **self-contained embedded SQLite
database** (no separately rented database service); (c) deployment readiness,
documentation, and GitHub delivery.

---

## 1. What was delivered

### 1.1 Unified full-stack application (one origin)

`web/` is now **one deployable application** serving the frontend pages **and**
the complete REST API through Next.js 15 Route Handlers (Node runtime):

- `web/app/api/v1/**` — 15 route handlers: `medicines`, `medicines/:key`,
  `medicines/:key/price-history`, `search`, `search/suggestions`, `offers`,
  `companies`, `companies/:slug`, `categories`, `categories/:slug`, `stats`,
  `health`, `admin/metrics` (Basic auth), `ingest/records` + `ingest/runs`
  (bearer token).
- `web/lib/server/` — the shared service layer used by **both** the pages
  (direct dispatch — no internal HTTP hop) and the public API: DB client,
  queries, search engine, ingestion engine, admin aggregation, HTTP plumbing
  (envelopes, rate limiting, CORS, cache headers, safe errors).
- Endpoint paths, response envelopes, ranking semantics, rate limiting, CORS
  and cache behaviour are identical to the audited Express API.
- The middleware 404-gate and the two legacy suggest routes now call the
  same-origin API — `BACKEND_URL` is gone from the application.

### 1.2 Self-contained embedded database (no external DB service)

| Decision | Outcome |
| --- | --- |
| Driver | `better-sqlite3` (SQLite 3.54.1, native, WAL) through **Drizzle ORM** |
| File | `data/medora.sqlite` (~106 MB), path via `MEDORA_DB_PATH` |
| Search | FTS5 `unicode61` lexical index + **trigram fuzzy index** (replaces tsvector + pg_trgm); typo tolerance preserved |
| Concurrency | WAL mode (concurrent readers, single writer); foreign keys enforced; `busy_timeout` 5 s |
| Schema | `migrations/sqlite/0001_init.sql` mirrors every table, constraint, check and default of the PostgreSQL schema; IDs preserved (rowid-alias PKs continue from max+1) |
| Portability | triggers keep both search indexes in sync; `VACUUM INTO` backups; migrator from PostgreSQL preserves history/validations |

Evaluation performed before migrating (per requirement): FTS5 full-text ✓
(unicode61 + trigram tokenizers verified available); fuzzy alternative to
pg_trgm ✓ (trigram index + JS trigram-set similarity, pg_trgm-compatible
Jaccard formula, 0.30 threshold); WAL concurrent reads ✓; single-writer write
model ✓ (single web service); transactions ✓; import performance ✓ (58,297
records in 9.7 s, see §3.3); backup/restore ✓ (`VACUUM INTO` + integrity
check); deployment compatibility ✓ (Render persistent disk; Vercel NOT viable
for persistent writes — documented, not faked).

### 1.3 Data migration (PostgreSQL → SQLite)

`web/scripts/migrate-pg-to-sqlite.mjs` copied the complete verified dataset
from the legacy embedded PostgreSQL (kept untouched until migration verified):

| Table | Rows |
| --- | --- |
| medicines | **58,297** |
| medicine_prices | 58,297 |
| product_images | 79,919 |
| medicine_categories | 58,297 |
| companies / categories | 1,414 / 1,000 |
| price_history | 16 (append-only history preserved) |
| data_validations | 58,313 |
| scrape_runs / import_jobs / slug_redirects / sources | 2 / 1 / 1 / 1 |

`PRAGMA integrity_check` = ok, foreign-key check clean, all IDs preserved
(`medicines.id` 1 = `napa-500-tablet` in both engines).

### 1.4 Independent scraper & ingestion

- `scrape.js` unchanged and independent (crawls → `data/products.jsonl`; never
  runs during website requests; never writes the database).
- JSONL importer ported to SQLite (`web/scripts/import-data.mts`) with
  checkpoint/resume, dry-run, idempotent history-preserving upserts.
- API ingestion (`/api/v1/ingest/*`) uses the same upsert pipeline inside one
  transaction — ingestion can never corrupt existing data.

### 1.5 Root-level developer experience

`npm install | dev | build | start | lint | typecheck | test` plus
`db:init | db:migrate | db:verify | db:backup | db:restore | import:data |
import:resume | import:dry-run | scrape` — one way to run Medora; no second
web server required.

---

## 2. Feature preservation checklist (all verified)

Homepage · search with typo tolerance (`paracetmol → Paracetamol` generics) ·
suggestions · product details with per-tablet and per-strip prices · regular
vs offer prices (offer shown only when genuinely below regular) · price
history (append-only, ingestion-tested) · company directory · category
directory · offers · compare (same-origin suggest-by-slug) · favourites ·
dark/light themes · mobile bottom navigation · admin dashboard (Basic auth) ·
public REST API · OpenAPI docs page · SEO metadata · sitemap · robots.txt ·
old-slug 308 redirects · secure ingestion. All **58,297 original records**
preserved; uncertain duplicates flagged, never merged; no prices, images,
offers or medical claims invented.

## 3. Real test results

### 3.1 Build & static checks
- `tsc --noEmit` — **pass** (unified app; strict mode).
- `next lint` — **pass** (2 pre-existing warnings fixed: unused import,
  `prefer-const`; error boundary now logs).
- `next build` — **pass** (all 15 API routes + pages + middleware 35.5 kB).

### 3.2 API integration suite — `platform/scripts/api-tests.mjs`
50 automated checks covering health, stats, list/detail/pagination, **typo
tolerance**, company/category search, empty-query browse mode, suggestions,
offers, admin auth (401 without / 200 with), dashboard HTML, **ingestion
auth + real DB writes** (price change → history row appended → restore
ingestion), safe-error instance with unreachable DB (503 health, safe 500
envelope), rate limiting (429 + `Retry-After`), CORS, cache headers:

| Target | Result |
| --- | --- |
| Unified app on PostgreSQL (pre-SQLite commit) | **50 passed, 0 failed** |
| Legacy Express + PostgreSQL (parity baseline) | **50 passed, 0 failed** |
| **Unified app on embedded SQLite** | **50 passed, 0 failed** |

Test-suite fixes made during the phase (test bugs, not app bugs): response
field name (`generic` not `genericName`), spawn cwd resolution, orphaned
grandchild process group kill, DB-effect verification now reads the database
the API target actually uses (SQLite vs PostgreSQL), numeric comparison for
SQLite's `NUMERIC` affinity (stores 10.80 as 10.8 — same value, different text
formatting than PostgreSQL `NUMERIC`).

### 3.3 Database & operational tests
- **Full JSONL import** into a fresh database: 107,396 input records →
  **58,297 imported in 9.7 s**; 0 failed, 0 corrupt; 49,174 uncertain
  duplicates flagged (never merged); re-run rebuilds identical tables
  (fresh-full-import semantics, same as the PostgreSQL importer).
- **Fresh-import vs migrated equality**: medicines, prices, images, links,
  companies, categories all **MATCH** row-for-row counts; sample record
  identical.
- **Persistence after restart**: server restarted; counts and appended history
  rows intact.
- **Backup**: `db:backup` snapshot 100.3 MB, integrity ok (58,297 medicines).
- **Restore**: `db:restore` verified + atomically swapped; app restarted on
  the restored file with correct counts.
- **Database verification** (`db:verify`): integrity ok, FK check clean,
  slugs unique, no orphan rows, FTS/trigram index row counts match medicines.
  (141 source-listed rows where the API's "offer" exceeds regular exist in
  **both** engines — preserved as crawled and guarded by `hasOffer`.)

### 3.4 Browser smoke tests (headless Chromium)
Desktop homepage (live stats board, offers, categories, companies) ✓ · mobile
viewport (iPhone 14) with bottom navigation ✓ · dark mode media emulation ✓ ·
search interaction ✓ · `/no-such-medicine-xyz` → real 404 via middleware gate ✓
· `/admin` with Basic auth → 200 ✓ · no page errors.

## 4. Deployment readiness

- **Render** (`DEPLOYMENT_RENDER.md`): one web service + persistent disk at
  `/var/data/medora`, `MEDORA_DB_PATH` on the disk, build/start commands,
  `db:init` safe on every deploy, health-check path, backup cron, documented
  single-instance constraint.
- **Vercel** (`DEPLOYMENT_VERCEL.md`): honest limitation — serverless
  filesystem is ephemeral; persistent SQLite is not feasible; Render is the
  self-contained option; no external database was added to fake compatibility.

## 5. Remaining limitations

1. **Single-instance scaling** — SQLite permits one writer; scale vertically
   on Render, not horizontally.
2. **Numeric formatting** — SQLite `NUMERIC` affinity stores `10.80` as
   `10.8` (value-identical; API consumers comparing strings should compare
   numerically).
3. **Placeholder category names** — the source API exposes numeric ids only
   for many categories (`Category 6574`); preserved as crawled in both engines.
4. **Search `total` for typo queries** — totals count lexical/partial matches
   exactly plus qualified fuzzy candidates within the bounded window (an
   approximation of pg_trgm's set semantics; page contents and ordering match).
5. **Database file not in Git** — 106 MB exceeds GitHub's 100 MB limit; the
   dataset, migrator and importer are committed so the file is one command
   away (see README "Recovery paths").

## 6. Git

- Commit 1: `feat: unify Medora frontend and backend for production deployment`
- Commit 2: SQLite embedding, tooling, docs, deployment guides (this phase).
- Pushed to the existing repository (`alaminnnnna/osud`, branch `main`);
  no force-push; no secrets or credentials committed
  (`.env*` files gitignored; SQLite file and backups gitignored).

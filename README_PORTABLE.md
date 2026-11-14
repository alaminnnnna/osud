# Medora — Portable Project Guide

Medora is a Bangladesh medicine price intelligence platform: a single-file Node.js
crawler for the public Arogga catalogue API, a validated dataset of **58,297 unique
medicines** (per-strip **and** per-tablet prices kept separately, offers, price
history, provenance), a PostgreSQL-backed REST API, and a Next.js 15 frontend —
plus the original prerendered static site.

## Architecture

```
scrape.js (independent crawler)
   → data/products.jsonl + validation-report.json (crawl provenance)
      → platform/  PostgreSQL 18  ←  scripts/db-restore.mjs can load database/medora_backup.sql
         Express REST API (src/server.ts) — search, medicines, offers, companies,
         categories, price history, ingestion, admin, dynamic sitemaps
      → web/  Next.js App Router (SSR from the API) + original static site (kept)
```

## Requirements

| Component | Version | Notes |
| --- | --- | --- |
| Node.js | **≥ 20** (`engines` in platform/package.json; root project needs ≥ 18) | tested on Node 24 |
| npm | ≥ 9 | ships with Node |
| PostgreSQL | **≥ 14** (tested on 18.6) | local Docker or managed |
| python3 | optional | only for `npm run serve` (static preview) |

## 1. Install dependencies

```bash
npm install          # in platform/  (API + importer)
npm install          # in web/       (Next.js frontend)
# root package has no dependencies (crawler is dependency-free)
```

## 2. Configure environment variables

```bash
cd platform
cp .env.example .env          # then edit DATABASE_URL etc.
cd ../web
cp .env.example .env.local    # then edit BACKEND_URL etc.
```

Real `.env` / `.env.local` files are **not** in this archive (only `*.example`).
Never commit them. Platform variables: `DATABASE_URL`, `DATA_DIR`, `PORT`,
`ACCESS_CONTROL_ORIGIN`, `RATE_LIMIT_PER_MINUTE`, `CACHE_LIST_SECONDS`,
`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `INGEST_TOKEN`.
Web variables: `BACKEND_URL`, `NEXT_PUBLIC_SITE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`.

## 3. Start PostgreSQL

Option A — Docker (recommended locally):
```bash
cd platform
docker compose up -d        # postgres:16-alpine on localhost:5432 (user/db: medora)
```
Option B — any PostgreSQL 14+ instance: create a database and point
`DATABASE_URL` at it, e.g. `postgres://medora:medora@localhost:5432/medora`.

## 4. Run database migrations

```bash
cd platform
npm run db:migrate          # applies db/migrations/*.sql with a ledger table
```

## 5. Import the dataset (two options)

Option A — restore the verified backup (fastest; contains the exact imported data):
```bash
cd platform
DATABASE_URL=postgres://medora:medora@localhost:5432/medora \
  node scripts/db-restore.mjs ../database/medora_backup.sql
```
Option B — full import from the raw dataset (recomputes validation):
```bash
cd platform
npm run import:data         # streams data/products.jsonl → PostgreSQL
# other modes: npm run import:dry-run | npm run import:resume
```

## 6. Verify the database

```bash
cd platform
npm run db:verify           # row counts, orphans, slug uniqueness, spot checks
# deep dataset↔DB comparison (dev only):
npx tsx scripts/db-integrity.ts
```

## 7. Start the Express API (development)

```bash
cd platform
npm run dev                 # tsx watch src/server.ts → http://localhost:4000
```
Production:
```bash
cd platform
npm run build && npm run start   # tsc → node dist/server.js
```

## 8. Start the Next.js frontend

Development:
```bash
cd web
npm run dev                 # http://localhost:3000
```
Production:
```bash
cd web
npm run build && npm run start
```

## 9. Run tests

```bash
# API integration suite (49 checks) — requires the API running on :4000:
cd platform && node scripts/api-tests.mjs

# Type checking:
cd platform && npm run typecheck
cd web && npm run typecheck
cd web && npm run lint
```

## 10. Run the independent scraper

```bash
npm run scrape              # full crawl → data/ (do NOT run during website requests)
npm run rebuild-web         # re-crawl and rebuild the static site
```
The crawler reads `api.arogga.com/robots.txt` and rate-limits itself. Optional:
set `MEDORA_INGEST_URL` + `MEDORA_INGEST_TOKEN` to stream results into the
platform's ingestion API instead of relying on the file import.

## 11. Rebuild / preview the static website

The prerendered static site ships inside `web/` (HTML at the root, assets in
`web/assets/`, plus prebuilt sitemap XMLs). Regenerate it with:
```bash
npm run rebuild-web         # crawler rebuilds web/ HTML + sitemaps from fresh data
```
Preview it without any backend:
```bash
npm run serve               # python3 -m http.server 8080 --directory web
```

## 12. Deploy

- Frontend (Next.js) → Vercel: see `DEPLOYMENT_VERCEL.md`
- Backend (Express) + managed PostgreSQL → Render: see `DEPLOYMENT_RENDER.md`
- Overall production setup and secrets policy: `PRODUCTION_SETUP.md`

## 13. Restore the SQL backup (summary)

```bash
cd platform
npm run db:migrate                                        # schema first
DATABASE_URL=postgres://user:pass@host:5432/db \
  node scripts/db-restore.mjs ../database/medora_backup.sql
npm run db:verify                                         # ALL CHECKS PASSED
```
The backup contains the actual imported dataset (not mock data) and was
verified by restoring it into a fresh database: all 13 table counts matched and
`db:verify` passed. See `ZIP_VERIFICATION_REPORT.md`.

## Documentation map

| File | Content |
| --- | --- |
| `README.md` | original project README (crawler + static site, Phases 1–2) |
| `PHASE2_AUDIT.md` | Phase-2 audit |
| `POSTGRES_VERIFICATION_REPORT.md` | live PostgreSQL verification + discrepancy analysis |
| `PHASE3_COMPLETION_REPORT.md` | Phase-3 completion status (tested / not tested) |
| `platform/IMPORT_REPORT.md` | import totals |
| `platform/README.md`, `platform/PRISMA.md` | platform details, Prisma rationale |
| `web/DESIGN.md` | design system (source of truth) |
| `platform/docker-compose.yml` | local PostgreSQL via Docker |
| `platform/prisma/schema.prisma` | canonical schema (runtime uses node-postgres) |

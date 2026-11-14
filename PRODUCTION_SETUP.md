# Medora — Production Setup (Phase 3 complete platform)

Architecture:
```
Browser → Next.js frontend (Vercel, web/) → REST API (Render, platform/)
       → PostgreSQL (Render managed, 58,297 medicines)
Scraper (scrape.js, independent host) → optional ingestion API (bearer token)
```

## Local end-to-end run (verified in this repo)
```bash
# 1. Database (any PostgreSQL 14+; docker-compose provided in platform/)
cd platform
cp .env.example .env            # DATABASE_URL=postgres://medora:medora@localhost:5432/medora
docker compose up -d            # or: initdb + pg_ctl (see POSTGRES_VERIFICATION_REPORT.md)

# 2. Migrate + import + verify
npm install
npm run db:migrate              # 12 tables + FTS/trigram search infrastructure
npm run import:data             # 107,396 lines → 58,297 medicines (~12 s locally)
npm run db:verify               # ALL CHECKS PASSED (counts, orphans, slugs, spot checks)

# 3. Backend API
npm run dev                     # http://localhost:4000  (49/49 integration tests: scripts/api-tests.mjs)

# 4. Frontend (separate shell)
cd ../web
cp .env.example .env.local      # BACKEND_URL=http://localhost:4000
npm install
npm run build && npm run start  # http://localhost:3000  (production build verified)
```

## Secrets
- Only `.env.example` files are committed. Real credentials live in platform/.env
  (git-ignored) and in Vercel/Render dashboards.
- The frontend never receives `DATABASE_URL` — it talks to the backend API only.
- Ingestion uses a 64-hex bearer token; admin uses Basic auth with strong values.

## Data pipeline (idempotent, provenance-tracked)
- `npm run import:data` — full import (truncates + rebuilds catalog; exact counts)
- `npm run import:resume` — continues a checkpointed interrupted job
- `POST /api/v1/ingest/records` — validated batches from the scraper, history-preserving
- `POST /api/v1/ingest/runs` — run summaries (scrape.js posts automatically when
  `MEDORA_INGEST_URL` + `MEDORA_INGEST_TOKEN` are set — non-blocking)
- Price changes append to `price_history`; uncertain duplicates are flagged
  (`NEEDS_RECHECK` + `duplicate_of`), never merged; slugs never change.

## Invariants (do not break in future phases)
1. Base-unit and sales-unit prices are separate columns, never derived from each other.
2. Offer prices only surface when the source lists a genuine discount.
3. `scrape.js` stays independent; never run it during website requests.
4. The original `data/` dataset is read-only input.
5. The static site in `web/` remains functional until the Next.js app fully replaces it in deployment.

## Verification artifacts in this repo
- `POSTGRES_VERIFICATION_REPORT.md` — real migrate/import/verify outputs + bug log
- `platform/IMPORT_REPORT.md` — import totals
- `platform/scripts/api-tests.mjs` — 49/49 integration tests (live backend)
- `platform/scripts/db-integrity.ts` — JSONL ↔ DB field-level comparison
- `web/` — Next.js app (16 routes, production build verified, browser-tested
  desktop + mobile + dark theme)

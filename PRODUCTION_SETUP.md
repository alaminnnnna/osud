# Medora — Production Setup (Phase 4: unified app + embedded SQLite)

Architecture:
```
Browser → ONE Next.js application (web/) = frontend + /api/v1 API
                 ↓
        embedded SQLite (data/medora.sqlite or $MEDORA_DB_PATH,
        WAL mode, FTS5 + trigram search, 58,297 medicines)
Scraper (scrape.js, independent host) → ingestion API (bearer token)
```

**No separately rented database service.** The database is a project file.
Recommended host: Render with a persistent disk — see
[`DEPLOYMENT_RENDER.md`](DEPLOYMENT_RENDER.md). Why Vercel is not viable for
persistent writes: [`DEPLOYMENT_VERCEL.md`](DEPLOYMENT_VERCEL.md).

## Environment variables (web/.env.example is the template)

| Variable | Required | Purpose |
| --- | --- | --- |
| `MEDORA_DB_PATH` | no (default `<repo>/data/medora.sqlite`) | database file location; on Render point it at the disk mount |
| `NEXT_PUBLIC_SITE_URL` | yes in production | canonical URLs, metadata, sitemap |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | to enable admin | Basic auth for `/admin` and `/api/v1/admin/metrics` |
| `INGEST_TOKEN` | to enable ingestion | bearer token for `/api/v1/ingest/*` |
| `ACCESS_CONTROL_ORIGIN` | no (`*` default) | CORS allow-list (comma-separated origins) |
| `RATE_LIMIT_PER_MINUTE` | no (`120`) | per-IP fixed-window limiter (`0` disables) |
| `CACHE_LIST_SECONDS` | no (`60`) | public API cache headers |

Never commit real credentials or tokens.

## First production bring-up

```bash
npm install
npm run db:init        # create DB + migrations (never erases existing data)
npm run import:data    # load data/products.jsonl → 58,297 medicines (~10 s)
npm run db:verify      # must pass all checks (counts, slugs, orphans, FTS)
npm run build
npm run start          # :3000 — frontend and API on one origin
npm test               # 50-check suite against http://localhost:3000
```

## Data integrity & operations

- **Verification** (`npm run db:verify`): `PRAGMA integrity_check`, foreign-key
  check, 58,297-medicine count, slug uniqueness, orphan rows, offer-vs-regular
  price semantics, FTS/trigram index sync. Non-zero exit on failure.
- **Backups** (`npm run db:backup`): consistent snapshot with `VACUUM INTO`
  (safe while the app runs), integrity-checked. Schedule daily via a cron job.
- **Restore** (`npm run db:restore -- <backup>`): verifies, keeps the previous
  file as `.pre-restore.bak`, atomically swaps. Restart the app afterwards.
- **Migrations**: `npm run db:migrate` applies pending files from
  `migrations/sqlite/` with a ledger; safe on every deploy.
- **Import safety**: `import:data` uses the same idempotent, history-preserving
  upsert pipeline as API ingestion; uncertain duplicates are flagged, never
  merged. `import:resume` continues a checkpointed job; `import:dry-run`
  validates without writing.

## Security notes

- Database credentials: none to leak — the database is a file; protect the
  host/disk instead.
- Admin and ingestion are disabled unless their env vars are set; tokens live
  only in the hosting provider's environment settings.
- Rate limiting, CORS allow-list, safe error envelopes and `no-store` on
  admin/ingest paths mirror the audited platform API.
- The scraper never runs as part of website request handling.

## Legacy PostgreSQL platform (superseded)

`platform/` retains the Express API, PostgreSQL migrations/tools and the
maintained API test-suite. The unified app replaces it at runtime; its
database can be recovered into SQLite via
`node web/scripts/migrate-pg-to-sqlite.mjs` (preserves price history,
validation records, import jobs, scrape runs, slug redirects, and every ID).

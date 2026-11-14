# Deploying Medora (unified app) to Render — fully self-contained

One Render **Web Service** serves the frontend and the `/api/v1` backend
together. The database is the project's own **embedded SQLite file** stored on
a Render **persistent disk** — no PostgreSQL instance, no rented database
service.

> Requirement recap: the database must survive restarts and redeployments, the
> app must have read/write access, and initialization must never erase existing
> data. All four are satisfied below.

## 1. Persistent disk (the database home)

1. Render Dashboard → **New → Web Service** → connect this repository.
2. Under *Advanced → Disks*, add a disk:
   - **Mount path**: `/var/data/medora`
   - **Size**: 1 GB is comfortable (the database is ~106 MB; WAL + backups add
     headroom). Backups written by `npm run db:backup` land on the same disk.

SQLite WAL mode requires the database file, `-wal` and `-shm` sidecars on the
same filesystem — a single mounted disk satisfies this.

## 2. Environment variables

| Key | Value | Notes |
| --- | --- | --- |
| `MEDORA_DB_PATH` | `/var/data/medora/medora.sqlite` | the database lives on the disk, never in the build directory |
| `NEXT_PUBLIC_SITE_URL` | `https://your-service.onrender.com` | canonical URLs, sitemap |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | strong values | protects `/admin` + `/api/v1/admin/*` (leave empty to disable) |
| `INGEST_TOKEN` | strong random value | bearer token for `/api/v1/ingest/*`; leave empty to disable |
| `ACCESS_CONTROL_ORIGIN` | `*` or comma-separated origins | CORS allow-list |
| `RATE_LIMIT_PER_MINUTE` | `120` | fixed-window per-IP limiter |
| `CACHE_LIST_SECONDS` | `60` | public list cache headers |

Never commit real credentials — set them in the Render dashboard only.

## 3. Build & start commands

- **Build command**: `npm install && npm run build`
- **Start command**: `npm run db:init && npm run start`

`db:init` is safe to run on **every deploy**: it creates the database file only
if missing, applies pending migrations from the ledger (`_medora_migrations`),
and **never deletes or overwrites existing data**.

## 4. Loading the dataset the first time

The disk starts empty, so populate it once (any one of):

- **From the committed dataset** — SSH into the Render shell (or a one-off job)
  and run `npm run import:data` (loads `data/products.jsonl`, ~10 s for all
  58,297 records).
- **From an existing backup** — upload a `*.sqlite` snapshot produced by
  `npm run db:backup` elsewhere, then `npm run db:restore -- <file>`.

Subsequent deploys **do not** re-import: `db:init` sees the existing database
and only applies new migrations.

## 5. Health check & monitoring

- **Health Check Path**: `/api/v1/health` → `200` `{"status":"ok","database":"connected"}`
  or `503` when the database is unreachable. Render uses it for restarts and
  zero-downtime deploys.
- Logs: the app logs route errors without secrets (`API error: …`); Render's
  log stream is the production log source.
- After deploy, verify: `/api/v1/health`, `/api/v1/stats` (medicines = 58,297),
  the homepage, and one product page.

## 6. Restart, scaling and durability characteristics

- **Restarts/redeploys**: the disk persists; the database survives everything
  short of deleting the disk. WAL mode keeps the file consistent across
  unclean shutdowns.
- **Backups**: run `npm run db:backup` on a schedule (Render **Cron Job** with
  the same disk mount, e.g. daily) — snapshots land in
  `/var/data/medora/backups/` with an integrity check each time.
- **Restore**: `npm run db:restore -- <backup>` (verifies integrity first,
  keeps the previous file as `.pre-restore.bak`, then atomically swaps).
- **Single instance only**: SQLite allows one writer process. Run **one**
  Render instance (vertical scaling); do not enable horizontal autoscaling —
  a second instance would fork the database. This is the documented trade-off
  of a self-contained database.
- The scraper remains an independently executed process (your workstation or a
  separate Render Cron/Job running `node scrape.js`); it feeds data back
  through the ingestion API, never by writing the database file directly.

## 7. One-off jobs on Render (optional)

- **Cron Job — nightly backup**: command `npm run db:backup`, same repo +
  disk mount.
- **Cron Job — verify**: command `npm run db:verify` (exits non-zero on any
  integrity failure — visible in the job log).

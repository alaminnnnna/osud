# Deploying the Medora backend + database to Render

## 1. PostgreSQL
1. Render Dashboard → New → **PostgreSQL** (any plan ≥ the dataset's needs; the
   full import is ~500 MB with indexes).
2. Copy the **Internal Database URL** (for the web service) and note the
   External URL for one-off import runs from your workstation.

## 2. Web service (platform API)
1. New → **Web Service** → repo root **`platform/`**.
2. Runtime: Node · Build: `npm install && npm run build` · Start: `npm run start`.
3. Environment:
| Key | Value |
| --- | --- |
| `DATABASE_URL` | Render *Internal* Database URL |
| `DATA_DIR` | `../data` (or mount/copy `data/` — see §4) |
| `ACCESS_CONTROL_ORIGIN` | `https://medora.vercel.app` (comma-separated list; never `*` in production) |
| `RATE_LIMIT_PER_MINUTE` | `120` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | strong values (secrets) |
| `INGEST_TOKEN` | `openssl rand -hex 32` (secret, shared with the scraper host) |

4. First deploy — run migrations + import once (Render Shell or release command):
```bash
npm run db:migrate     # applies db/migrations/*.sql with a ledger
npm run import:data    # streams data/products.jsonl (~12 s for 58k records locally;
                       # allow longer on first remote run)
npm run db:verify      # must print ALL CHECKS PASSED
```
Re-runs are idempotent; changed prices append to `price_history` automatically.

## 3. Health check
Render Health Check Path: `/api/v1/health` (returns 200 when the DB is connected).

## 4. Getting the dataset to Render
The importer reads `data/products.jsonl` (+ `categories.json`, `crawl-report.json`
for provenance). Options:
- Commit a compressed `data/products.jsonl` to a private release branch, or
- `scp`/rsync the three files to the service, or
- use the ingestion API from the scraper host instead of file import:
  `POST /api/v1/ingest/records` (batches ≤ 5000, Bearer `INGEST_TOKEN`).

## 5. Post-deploy verification
```bash
curl https://<render-host>/api/v1/health
curl "https://<render-host>/api/v1/medicines/napa-500-tablet"
curl "https://<render-host>/api/v1/search?q=napa&limit=3"
curl -u admin:*** https://<render-host>/api/v1/admin/metrics
curl -I https://<render-host>/sitemap-medicines-1.xml
```

## 6. Multi-instance note
The rate limiter is in-memory per instance. Behind more than one instance, move
it to Redis (documented in `platform/README.md`).

# Bangladesh Medicine Price Database — MedPrice BD

A local, self-contained **medicine price intelligence platform** for Bangladesh:

- **`scrape.js`** — one Node.js file that crawls the public Arogga catalogue API,
  validates every record, keeps price history, and writes the entire dataset +
  the web app bundles. No backend server, no npm dependencies, no credentials.
- **`data/`** — the raw dataset (JSON / JSONL / CSV) plus crawl, validation and
  failure reports.
- **`web/`** — a static, premium price-catalogue app (light & deep dark themes,
  instant search, filters, offers, compare, price-history charts, public file API,
  sitemaps, prerendered SEO pages, data dashboard) served from plain files.

> This is a **price catalogue** — it is not medical advice, not a pharmacy, and it
> never prescribes or recommends treatments.

---

## Quick start

Requirements: Node.js ≥ 18 (uses the built-in `fetch`).

A full crawl collected **58,297 unique products** (101.28% of the search API's declared
57,563 — the reconciliation pass recovers products the category buckets cannot reach
from their public product pages; 2 retired product ids failed and are reported).

```bash
# 1. Crawl the catalogue (first run discovers + collects everything)
node scrape.js

# 2. Serve the web app (or open web/index.html directly — no server needed)
npm run serve          # http://localhost:8080
# …or any static server: python3 -m http.server 8080 --directory web
```

Subsequent runs update prices, detect new products, keep history, retry failed
pages and regenerate the web bundles:

```bash
node scrape.js                # update run (resumes an interrupted run first)
node scrape.js --rebuild-web  # rebuild web/ bundles only (no re-crawl)
```

## CLI options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--per-page=N` | 100 | rows per API page (5–100) |
| `--concurrency=N` | 3 | parallel requests |
| `--rate-ms=N` | 150 | minimum ms between request starts |
| `--timeout-ms=N` | 20000 | per-request timeout |
| `--retries=N` | 4 | retries per request (exponential backoff) |
| `--category=ID` | — | restrict crawl to one category subtree |
| `--max-pages=N` | — | safety cap on pages per bucket |
| `--no-verify` | — | skip secondary (product-page) price verification |
| `--max-verify=N` | 25 | detail-page verifications per run |
| `--fresh` | — | ignore checkpoint, start a new run |
| `--rebuild-web` | — | rebuild `web/` bundles from existing data |
| `--site-base=URL` | `https://example.com` | public base URL used in sitemaps / canonicals |

Environment variants exist for everything (`SCRAPER_PER_PAGE`, `SCRAPER_CONCURRENCY`,
`SCRAPER_RATE_MS`, `SITE_BASE`, …).

## How the crawler reaches every product

The source API serves **at most ~1,000 rows per query window** (page 11 with
`_perPage=100` answers `status:"fail"`), and the catalogue holds 57,563 products per the search API (58,299 product pages listed in the public sitemaps).
The engine therefore crawls in *buckets* that each fit the window:

1. **Discovery** — global probe (totals, product-type taxonomy) + the full
   category tree harvested from the public sitemap files (~1,300 categories).
2. **Sweep** — one tiny request per category (facets included). The single returned
   row reveals whether the category is a *leaf* (its products carry its id) and its
   exact total.
3. **Partition** — leaf categories ≤ 990 rows are buckets; bigger leaves are
   subdivided by dosage form (`_form`), and if still too big, by brand
   (`_brand_id`) inside (category × form). Anywhere facet sums fall short of the
   parent total, a **coverage gap is recorded** — never silently ignored.
4. **Crawl** — bounded worker pool, global rate limit, exponential-backoff
   retries, per-page checkpointing, final failure sweep.

The system **never reports full coverage** unless every planned bucket page was
processed and no gap remains — interrupted runs resume; failed pages are retried
on the next run.

## Data files (`data/`)

| File | Contents |
| --- | --- |
| `products.json` | normalised product records (validation status included) |
| `products.jsonl` | raw API records, one JSON object per line (full provenance) |
| `products.csv` | flat spreadsheet export |
| `prices.json` | current price per product (regular + offer, base + sales unit) |
| `price-history.json` | append-only price-change history |
| `companies.json` / `generics.json` / `categories.json` | directories with counts |
| `images.json` | image URL registry (original CDN URLs, no downloads) |
| `crawl-progress.json` | checkpoint (resume) |
| `failed-records.json` | failed pages, failed records, verification failures |
| `validation-report.json` | validation statuses, conflicts, duplicate candidates |
| `crawl-report.json` | the full run report (also printed to the console) |

### Price semantics (important)

| Field | Meaning | Source |
| --- | --- | --- |
| `regular.base` | regular price per **base unit** (e.g. per tablet) | `pv_mrp` |
| `offer.base` | offer price per base unit | `pv_b2c_discounted_price` |
| `regular.sales` | regular price per **sales unit** (e.g. per strip) | `pv_b2c_mrp` |
| `offer.sales` | offer price per sales unit | `pv_b2c_price` |

Base-unit and sales-unit prices are **separate values with their own units** — they
are never mixed or recomputed. B2B fields exist in the raw data but are never shown.
If the offer equals the regular price, both are kept as-is (no invented discount).
If a price is missing, it is marked missing.

### Validation statuses

`VERIFIED` · `PARTIALLY_VERIFIED` (minor gaps) · `NEEDS_RECHECK` (price anomaly,
missing prices, or API vs product-page disagreement — both values preserved) ·
`FAILED` (structurally broken). Duplicate detection: exact product-id duplicates
are de-duplicated and reported; same-fingerprint candidates (name + strength +
generic + manufacturer + form + pack) are listed in the validation report and
**never merged**.

## Web app (`web/`)

Works from `file://` (bundles load via `<script>`) or any static host.

- Home: hero search with suggestions + popular chips, live "price board" of real
  offers, dataset stats, recently updated prices, verified offers, company and
  category directories, data-transparency sections.
- Search: instant client-side search (exact / prefix / substring / Bengali /
  typo tolerance) over a generated postings index; filter sidebar (company,
  category, form, type, prescription, offer-only, price range), sorting,
  pagination, active filter chips, smart empty states.
- Medicine page: full price panel (regular vs offer per sales unit **and** base
  unit), pack composition, quantity limits, verification stamp, price-history
  chart (only real recordings — history builds across runs), related medicines,
  share / favourite / compare, link to the source listing.
- Companies & categories: directories with real counts + paginated product grids.
- Offers: only items whose listed offer price is genuinely below regular.
- Compare: side-by-side table (up to 4), with base-unit price for fair pack-size
  comparison.
- API docs: documents the bundled read-only JSON API + OpenAPI download.
- Data dashboard: monitoring-style dataset health (coverage, failures, gaps,
  duplicates, freshness) from the crawl report.
- Themes: light / **deep dark** / system, no flash on load, persisted.
- SEO: per-route titles, descriptions, canonicals, Open Graph, JSON-LD
  (WebSite + SearchAction, Product + Offer — only real values, never invented
  ratings/availability), `sitemap.xml` index (static/company/category/products),
  `robots.txt`, prerendered static pages for top medicines, companies, categories,
  and a `404.html` SPA fallback.

## Public JSON API (bundled)

Read-only static files under `web/api/v1/`:

```
GET /api/v1/health.json
GET /api/v1/meta.json
GET /api/v1/medicines.json            → page links
GET /api/v1/medicines/page-0001.json  (100/page; capped — see file's "truncated" flag)
GET /api/v1/offers.json
GET /api/v1/offers/page-0001.json
GET /api/v1/companies.json
GET /api/v1/categories.json
GET /api/v1/openapi.json              (OpenAPI 3.1 spec of the above)
```

The full per-medicine dataset lives in `web/assets/js/db/` (chunked product rows +
postings search index) — the same schema a dynamic server would expose.

## Deployment

Static hosting only — no build step, no server:

- **Vercel** — project root = `web/` (framework preset “Other”). `vercel.json` is
  optional; add a rewrite of `/(.*)` to `/index.html` for SPA routes. Set no env
  vars. Deploy the whole repo instead if you also want `data/` private.
- **Render** — New → Static Site. Build command: *none*; publish directory: `web`.
  SPA rewrite rule: `/*  →  /index.html  200`.
- **Netlify / GitHub Pages / nginx / python http.server** — serve `web/`;
  for clean-URL sitemap paths (`/m/<slug>`) enable “pretty URLs” or an equivalent
  rewrite. Regenerate before deploying with your real domain:
  `node scrape.js --rebuild-web --site-base=https://your-domain`.
- **Do not** deploy `data/` publicly if you consider crawl details private — the
  web app itself only needs `web/`.

## Phase 2 — production backend (`platform/`)

A database-backed, dynamic platform layer now ships alongside the static app
(see `PHASE2_AUDIT.md` and `platform/README.md`):

- **PostgreSQL schema** for 12 normalized tables (Medicine, Company, Category,
  MedicineCategory, MedicinePrice, PriceHistory, ProductImage, Source,
  ScrapeRun, ImportJob, DataValidation, SlugRedirect) — canonical
  `prisma/schema.prisma` + versioned SQL migrations (`npm run db:migrate`).
- **Import engine** (`npm run import:data` / `import:resume` / `import:dry-run`)
  — streaming JSONL import of the 58k-record dataset with checkpoint/resume,
  idempotent upserts, price-history preservation, duplicate-candidate reporting
  (never auto-merged), and `IMPORT_REPORT.md`.
- **REST API** `/api/v1/*` — medicines, server-side search (FTS + trigram with
  deterministic ranking), offers, companies, categories, price history,
  health/stats — rate limiting, CORS, cache headers, safe errors.
- **SEO** — dynamic partitioned sitemaps + robots.txt; **admin** dashboard and
  **ingestion** API behind authentication.
- TypeScript + zod throughout; see `platform/PRISMA.md` for adopting the
  Prisma client.

## Project structure

```
├── scrape.js            # the entire crawling engine (single file)
├── data/                # dataset + reports (generated)
├── web/
│   ├── index.html       # app shell (no build step)
│   ├── DESIGN.md        # design direction, tokens, audit results
│   ├── assets/
│   │   ├── css/         # tokens / base / components / views
│   │   ├── js/          # shell, router, store, db loader, search engine, ui kit
│   │   │   ├── db/      # AUTO-GENERATED: meta, dicts, slugs, index, chunks, history
│   │   │   └── views/   # one file per route
│   │   └── icons/       # favicon
│   ├── api/v1/          # AUTO-GENERATED: static JSON API + OpenAPI
│   ├── m/, companies/, categories/   # AUTO-GENERATED prerendered SEO pages
│   └── sitemap*.xml, robots.txt      # AUTO-GENERATED
└── README.md
```

## Compliance & fair use

- No credentials, cookies or sessions are used; no paywalled or private data.
- Defaults are deliberately gentle (rate limit, low concurrency, retries with
  backoff); the API is public and its responses are explicitly cacheable.
- `api.arogga.com/robots.txt` currently disallows crawling: keep volume modest
  (defaults do), use this locally for personal price reference, and contact the
  source before any large-scale or commercial reuse.
- Product data © the respective manufacturers and the source platform.

## Known limitations

- The API window (~1,000 rows/query) is probed at runtime; if the source changes
  its caps or facets, coverage gaps are reported honestly rather than papered over.
- The static JSON API exposes paginated listings (capped, flagged `truncated`);
  arbitrary server-side queries need a small server, documented in `/api-docs`.
- Price-history charts need ≥ 2 recordings (they build as re-runs happen).
- Client-side search ships the postings index (~a few MB) on first search — fine
  locally and on static hosts; swap in a server-backed search for low-bandwidth
  production use.

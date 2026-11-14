# PHASE3_COMPLETION_REPORT — Medora Production Integration

Date: 2026-11-14. Every number below comes from a command actually executed in this
environment; nothing is extrapolated. The four required categories are marked:
**[tested]** · **[implemented, not tested]** · **[not implemented]** · **[external setup required]**.

---

## 1. What the platform now is

A real, running full-stack system, verified end-to-end on this machine:

```
PostgreSQL 18.6 (58,297 medicines, 1,414 companies, 1,000 categories, 79,919 images)
  ↑ SQL
Express REST API :4000 (search with FTS+trigram ranking, ingestion, admin, sitemaps)
  ↑ REST
Next.js 15 production build :3000 (16 routes, SSR from the live API, design preserved)
```

## 2. Implemented and tested ✅

| Item | Evidence |
| --- | --- |
| PostgreSQL 18.6 running (no Docker/sudo available — official binaries via npm, unprivileged, port 5433) | `POSTGRES_VERIFICATION_REPORT.md` §1.1 |
| `db:migrate` — 12 tables + FTS/trigram, ledger-tracked, re-runnable | §1.2: "Migration complete (2 applied, 2 total)" |
| `import:data` — 107,396 lines → **58,297 imported, 0 failed, 12.3 s** | §1.3 |
| `db:verify` — counts, orphans, slug uniqueness, unit sanity, Napa 500 spot check | §1.4: **ALL CHECKS PASSED** |
| Deep JSONL↔DB field comparison (30 sampled records, every price column, units, multipliers, company links) | §1.5: **0 mismatches, INTEGRITY OK** |
| Idempotent re-import (identical counts + stable slugs) | §1.6 |
| Price history recording via authenticated ingestion (0→1→2 entries, restore verified) | §1.7 + visible on the live medicine page |
| **49/49 API integration tests** — all 11 endpoints, envelope schema, pagination clamping, ranking (exact first), typo tolerance (`paracetmol`→Paracetamol), company/category/offer filters, cache headers, CORS, rate limiting (429 + Retry-After), admin auth (401/200), ingestion auth + history, safe DB-error 500/503 (separate broken-DB instance) | `platform/scripts/api-tests.mjs`, full output preserved |
| Discrepancy investigation: 107,396 / 58,297 / 58,222 — **75 uncertain duplicates were being silently skipped**; now imported + flagged (`duplicate_of` + NEEDS_RECHECK), DB flags = 75 exactly | `POSTGRES_VERIFICATION_REPORT.md` §2 |
| Next.js frontend: production build succeeded (16 routes), typecheck clean | build output in this report §4 |
| Pages verified in a real browser (agent-browser): homepage desktop (live price board, stats, offers), search flow (debounced suggestions with prices → results grid, exact match first, 24 cards), mobile 390×844 (compact header, floating bottom tab bar, blur backdrop), dark theme medicine page (price block per-strip + per-tablet separate, verification stamp, price history table, source image, related generics) | screenshots reviewed during this session |
| SEO: dynamic title/canonical/OG on detail pages; Product JSON-LD + Offer JSON-LD **only with real data** (BDT 10.8 for Napa 500 offer); robots.txt (admin + /api disallowed, both sitemaps); backend sitemap index with **exactly 20,000 URLs per medicine partition** | curl outputs, this report §5 |
| Old-slug redirect: `slug_redirects` row → `/napa-500-tablet-old` → **HTTP 308 → /napa-500-tablet** | curl |
| Proper 404s: unknown medicine/company/category → **HTTP 404** (middleware gate, Next 15 streaming-metadata workaround documented in code) | curl |
| Admin protection end-to-end: frontend middleware Basic auth (401/200), backend metrics behind same creds | curl |
| Production builds: `next build` ✓ (16 routes) + `next start` serving; `tsc --noEmit` clean in both packages | this session |

## 3. Implemented, not tested here ⚠️

| Item | Why | How to verify |
| --- | --- | --- |
| Vercel deployment of the frontend | No external account access from this sandbox | `DEPLOYMENT_VERCEL.md` — deploy + 4-item checklist |
| Render deployment of the backend + managed PostgreSQL | Same | `DEPLOYMENT_RENDER.md` §1–5 |
| Rate limiter under multi-instance load | In-memory per instance by design; Redis migration documented | load test after adding Redis |
| Sitemap scale beyond partition 1–3 rendering time on a cold managed DB | Local partitions render instantly; remote latency unmeasured | curl `/sitemap-medicines-3.xml` post-deploy |

## 4. Not implemented ❌

- None from the Phase-3 requirement list. (Two conscious, documented scope choices:
  search facets are reduced to company/form/price/offer filters; the mobile filter
  sheet reuses the desktop filter fields rather than a separate mobile-only facet set.)

## 5. External setup required 🔧

1. Managed PostgreSQL + Render service (§3 of `DEPLOYMENT_RENDER.md`).
2. Vercel project + the four environment variables (§3 of `DEPLOYMENT_VERCEL.md`).
3. Secrets: `ADMIN_*`, `INGEST_TOKEN` (`openssl rand -hex 32`), CORS origin lock-down.
4. Dataset transfer to the Render service (three files, or ingestion API).
5. Optional: Redis if the API runs with >1 instance.

## 6. Real bugs found and fixed during this phase (evidence of testing, not generation)

1. Importer: `source_company_id` column mismatch (schema had evolved) → caught on first real run.
2. Importer: PostgreSQL `unnest` flattens 2-D arrays → `missing_fields` re-aggregated via JSON; `changed_fields` as constant array.
3. Importer: empty-array → NULL NOT NULL violation → COALESCE.
4. Importer: 75 uncertain duplicates silently dropped → now imported + flagged (the 58,222 mystery solved).
5. Importer: cross-batch `duplicate_of` resolution (17 flags lost).
6. Search: score tie-break favored recency over name → deterministic `ORDER BY score DESC, name`; fuzzy matching extended to generic names.
7. Search API returned flat rows while all clients expect the nested `price` object → unified via `rowToMedicine` (caught by browser test: results grid rendered 0 cards).
8. Next 15 streaming metadata turns `notFound()` into HTTP 200 → middleware 404-gate for medicine/company/category detail routes (proper 404 + 308 verified).
9. Unlayered custom CSS classes overrode Tailwind utilities (`md:hidden` broken → mobile Filters button leaked to desktop) → moved to `@layer components` (caught by screenshot audit).
10. Ingestion 500 (`changed_fields does not exist`) caught by live API test.

## 7. How to reproduce everything locally

See `PRODUCTION_SETUP.md` §"Local end-to-end run" — four commands + two servers;
`platform/scripts/api-tests.mjs` (49 checks) and `platform/scripts/db-integrity.ts`
(field-level JSONL↔DB comparison) are the regression suites. Local `.env` values used
during testing are documented in the respective `.env.example` files; real secrets were
never committed.

## 8. Dataset integrity statement

The original dataset in `data/` was **never modified** (read-only input; verified by
re-running the Phase-1 suite after all work: `scripts/verify.js` → **41/41 PASS**).
The scraper (`scrape.js`) remains an independent process; the only Phase-3 touch is the
previously delivered optional, env-gated ingestion hook. The static site in `web/` is
untouched and remains deployable; the Next.js app coexists in the same folder and does
not serve those files.

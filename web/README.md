# web/ — static price intelligence app

Plain files, no build step. Regenerate every generated file with:

```bash
node scrape.js --rebuild-web          # from data/ on disk
node scrape.js                        # full crawl + rebuild
```

## Layout

| Path | Source | Contents |
| --- | --- | --- |
| `index.html` | hand-written | app shell (theme bootstrap, meta, script order) |
| `404.html` | generated | copy of the shell — SPA fallback for static hosts |
| `assets/css/` | hand-written | `tokens.css` (light/dark), `base.css`, `components.css`, `views.css` |
| `assets/js/` | hand-written | `icons.js`, `store.js`, `db.js`, `search.js`, `ui.js`, `router.js`, `main.js`, `reports.js` (generated) |
| `assets/js/views/` | hand-written | one file per route (home, search, medicine, companies, categories, offers, compare, api-docs, about, admin) |
| `assets/js/db/` | **generated** | `meta.js`, `dicts.js`, `slugs.js`, `index.js` (search postings), `history.js`, `chunk-XXX.js` (product rows) |
| `api/v1/` | **generated** | static JSON API + `openapi.json` |
| `m/<slug>.html` | **generated** | prerendered medicine pages (SEO: Product JSON-LD, canonical, OG) |
| `companies/<id>.html` | **generated** | prerendered company pages |
| `categories/<id>.html` | **generated** | prerendered category pages |
| `sitemap.xml` + parts, `robots.txt` | **generated** | sitemap index (static/company/category/products), robots |
| `DESIGN.md` | hand-written | design direction, tokens, contrast math, audit checklist |

## Serving

```bash
python3 -m http.server 8080 --directory web
# then open http://localhost:8080
```

`index.html` also works from `file://` — bundles are classic scripts, so no CORS
is involved; only the admin dashboard's raw-report links prefer an http server.

## Data flow

```
data/products.jsonl ── scrape.js --rebuild-web ──▶ assets/js/db/*.js   (chunks + index)
                                                   ├─▶ api/v1/*.json    (file API + OpenAPI)
                                                   ├─▶ sitemap*.xml, robots.txt
                                                   └─▶ m/ companies/ categories/ 404.html
```

Product rows are compact arrays (`meta.js → productSchema`) with dictionaries for
company/generic/form/type; images are stored as CDN keys and rebuilt client-side
as imgix URLs. The postings index (`index.js`) maps each token (English + Bengali)
and each facet (`@co:`, `@gen:`, `@cat:`, `@form:`, `@type:`, `@rx`, `@offer`) to
product-id arrays — the client search engine intersects them.

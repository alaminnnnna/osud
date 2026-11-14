/* MedPrice BD — API documentation page: endpoint list, examples (curl/JS/Python),
   schema notes, OpenAPI download, honest note about the static file API. */
(function () {
  var ICON = window.MDB_ICONS.icon;
  var UI = window.MDB_UI;

  var ENDPOINTS = [
    ['GET', '/api/v1/health.json', 'Service + dataset health: counts, completion, last crawl id.'],
    ['GET', '/api/v1/meta.json', 'Dataset metadata: product schema, chunk map, category list, coverage.'],
    ['GET', '/api/v1/medicines.json', 'Index of paginated medicine listings with per-page links.'],
    ['GET', '/api/v1/medicines/page-0001.json', 'Medicines page 1 (100 items per page).'],
    ['GET', '/api/v1/offers.json', 'Index of offer listings (items where offer < regular).'],
    ['GET', '/api/v1/offers/page-0001.json', 'Offers page 1, sorted by discount.'],
    ['GET', '/api/v1/companies.json', 'All pharmaceutical companies with product counts.'],
    ['GET', '/api/v1/categories.json', 'All categories with product counts.'],
  ];

  function renderApiDocs(ctx) {
    ctx.setMeta('Public API — MedPrice BD', 'Read-only JSON API over the crawled Bangladesh medicine price dataset: health, medicines, offers, companies, categories.', '/api-docs', null);
    var host = location.protocol === 'http:' || location.protocol === 'https:'
      ? (location.origin + location.pathname.replace(/index\.html$/, ''))
      : 'https://your-static-host/';

    var epHtml = ENDPOINTS.map(function (e) {
      return '<div class="ep"><div class="head"><span class="method">' + e[0] + '</span><a class="path" href="' + e[1] + '">' + e[1] + '</a></div><div class="desc">' + UI.esc(e[2]) + '</div></div>';
    }).join('');

    ctx.root.innerHTML =
      '<div class="container doc" style="margin-top:32px">'
      + '<h1 style="font-size:24px">Public API</h1>'
      + '<p class="muted" style="margin:8px 0 4px">A read-only JSON API ships with every crawl. Version <span class="mono">v1</span> · cache-friendly static files · no authentication for read paths.</p>'
      + '<div class="notice" style="margin-top:16px"><b>How it is served here:</b> this build ships the API as static JSON files under <code>/api/v1/</code> — reliable on any static host, no server process. Query parameters (search, arbitrary filters) are implemented by the built-in search engine and by the file pages above; point a small server at the same dataset to unlock dynamic queries, the item schema is identical.</div>'

      + '<h2 style="margin-top:32px;font-size:17px">Endpoints</h2>' + epHtml

      + '<h2 style="margin-top:32px;font-size:17px">Price fields</h2>'
      + '<div class="tbl-wrap"><table class="tbl"><tbody>'
      + '<tr><th scope="row">regular.base</th><td>Regular price per <b>base unit</b> (e.g. per tablet) — source field <code>pv_mrp</code></td></tr>'
      + '<tr><th scope="row">offer.base</th><td>Offer price per base unit — source field <code>pv_b2c_discounted_price</code></td></tr>'
      + '<tr><th scope="row">regular.sales</th><td>Regular price per <b>sales unit</b> (e.g. per strip) — source field <code>pv_b2c_mrp</code></td></tr>'
      + '<tr><th scope="row">offer.sales</th><td>Offer price per sales unit — source field <code>pv_b2c_price</code></td></tr>'
      + '<tr><th scope="row">discountPercent</th><td>As listed by the source — never recomputed</td></tr>'
      + '</tbody></table></div>'
      + '<p class="kv-note" style="margin-top:10px">B2B prices exist in the raw dataset but are never exposed through customer-facing endpoints.</p>'

      + '<h2 style="margin-top:32px;font-size:17px">Examples</h2>'
      + '<div class="code-head">curl</div>'
      + '<pre class="code">curl ' + host + 'api/v1/health.json\n\ncurl ' + host + 'api/v1/offers/page-0001.json | jq \'.items[0]\'</pre>'
      + '<div class="code-head">JavaScript</div>'
      + '<pre class="code">const res = await fetch(\'' + host + 'api/v1/companies.json\');\nconst data = await res.json();\nconsole.log(data.count, data.items[0]);</pre>'
      + '<div class="code-head">Python</div>'
      + '<pre class="code">import requests\n\nr = requests.get("' + host + 'api/v1/offers/page-0001.json", timeout=10)\nr.raise_for_status()\nfor item in r.json()["items"]:\n    print(item["name"], item["price"]["offerSales"], item["price"]["regularSales"])</pre>'

      + '<h2 style="margin-top:32px;font-size:17px">Specification</h2>'
      + '<p class="muted" style="margin-bottom:12px">An OpenAPI 3.1 description of every generated file is bundled with the dataset.</p>'
      + '<a class="btn" href="api/v1/openapi.json">' + ICON('file', 15) + ' openapi.json</a>'

      + '<h2 style="margin-top:32px;font-size:17px">Rate limits &amp; etiquette</h2>'
      + '<div class="notice warn">The upstream catalogue API is a public service — the crawler keeps request volume low, caches aggressively and identifies as a browser client without credentials. If you redeploy this dataset publicly, mirror the same restraint and consider contacting the source for bulk access.</div>'
      + '</div>';
  }

  MDB_ROUTER.add('/api-docs', renderApiDocs);
})();

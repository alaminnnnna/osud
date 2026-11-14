/* MedPrice BD — data dashboard (admin view): monitoring-style dataset health
   from the crawl report + validation summary. Read-only, no ingestion here. */
(function () {
  var ICON = window.MDB_ICONS.icon;
  var UI = window.MDB_UI;
  var DB = window.MDB_DB;

  function pill(kind, label) {
    return '<span class="pill ' + kind + '"><i></i>' + label + '</span>';
  }

  function renderAdmin(ctx) {
    ctx.setMeta('Data dashboard — MedPrice BD', 'Dataset health: crawl coverage, validation status, failures and freshness.', '/admin', null);
    ctx.root.innerHTML = '<div class="container" style="margin-top:32px"><div class="loading-block" aria-busy="true"><div class="skel" style="height:28px;width:220px"></div><div class="skel" style="height:120px"></div></div></div>';

    DB.loadReports().then(function (R) {
      var crawl = R.crawl, v = R.validation.summary;
      var pagesOk = crawl.totalPagesFailed === 0;
      var gaps = crawl.coverageGaps || [];
      var overall = pagesOk && gaps.length === 0 && crawl.fullCoverageAchieved ? 'ok' : (pagesOk || crawl.fullCoverageAchieved ? 'deg' : 'err');

      var cards = [
        ['Medicines collected', UI.num(crawl.uniqueProductsCollected), 'of ' + UI.num(crawl.totalProductsDiscovered) + ' in source', pill(overall, overall === 'ok' ? 'operational' : overall === 'deg' ? 'partial coverage' : 'degraded')],
        ['Crawl completion', crawl.completionPercent + '%', crawl.totalPagesProcessed + ' / ' + crawl.totalPagesDiscovered + ' pages', pill(pagesOk ? 'ok' : 'deg', crawl.totalPagesFailed + ' failed')],
        ['ID coverage', crawl.idCoveragePercent + '%', 'unique product ids vs source total', pill(crawl.idCoveragePercent >= 99 ? 'ok' : crawl.idCoveragePercent >= 95 ? 'deg' : 'err', '')],
        ['Verified records', UI.num(v.VERIFIED || 0), (v.VERIFIED || 0) === v.totalProducts ? 'all checks passed' : UI.num(v.totalProducts - (v.VERIFIED || 0)) + ' with gaps', pill('ok', '')],
        ['Needs re-check', UI.num(v.NEEDS_RECHECK || 0), 'price anomalies / conflicts', pill((v.NEEDS_RECHECK || 0) === 0 ? 'ok' : 'deg', '')],
        ['Missing prices', UI.num(v.missingPrices || 0), 'records without any price', pill((v.missingPrices || 0) === 0 ? 'ok' : 'deg', '')],
        ['Missing images', UI.num(v.missingImages || 0), 'records without a valid image URL', pill((v.missingImages || 0) === 0 ? 'ok' : 'deg', '')],
        ['Duplicate candidates', UI.num(v.duplicateCandidateGroups || 0), 'fingerprint groups — reported, never merged', pill((v.duplicateCandidateGroups || 0) === 0 ? 'ok' : 'deg', '')],
        ['Price-unit conflicts', UI.num(v.priceUnitConflicts || 0), 'offer above regular — both values kept', pill((v.priceUnitConflicts || 0) === 0 ? 'ok' : 'deg', '')],
        ['Coverage gaps', UI.num(gaps.length), 'buckets where facet sums fall short', pill(gaps.length === 0 ? 'ok' : 'deg', '')],
        ['API requests', UI.num(crawl.apiRequests), UI.num(crawl.apiRetries) + ' retries · ' + UI.num(crawl.apiRateLimited) + ' rate-limited', pill('ok', '')],
        ['Crawl duration', crawl.durationHuman, 'started ' + UI.esc(String(crawl.startedAt).slice(0, 16).replace('T', ' ')), pill('ok', '')],
      ];

      ctx.root.innerHTML =
        '<div class="container" style="margin-top:32px">'
        + '<div class="spread"><h1 style="font-size:24px">Data dashboard</h1>' + pill(overall, overall === 'ok' ? 'all systems operational' : overall === 'deg' ? 'partial coverage' : 'needs attention') + '</div>'
        + '<p class="muted" style="margin:6px 0 4px">Dataset <span class="mono">' + UI.esc(crawl.runId) + '</span> · generated ' + UI.esc(String(crawl.generatedAt).slice(0, 19).replace('T', ' ')) + ' · mode ' + UI.esc(crawl.mode) + '</p>'
        + '<div class="status-grid">'
        + cards.map(function (c) {
          return '<div class="status-card"><div class="lab"><span>' + c[0] + '</span>' + c[3] + '</div><div class="val">' + c[1] + '</div><div class="sub">' + c[2] + '</div></div>';
        }).join('')
        + '</div>'

        + (crawl.coverageNote ? '<div class="notice' + (crawl.fullCoverageAchieved ? '' : ' warn') + '" style="margin-top:24px">' + UI.esc(crawl.coverageNote) + '</div>' : '')

        + ((R.failedPages || []).length ? '<section class="section"><h2 style="font-size:17px">Failed pages</h2><div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Bucket</th><th class="num">Page</th><th class="num">Attempts</th><th>Last error</th></tr></thead><tbody>'
          + R.failedPages.slice(0, 50).map(function (f) {
            return '<tr><td class="mono">' + UI.esc(f.bucketKey || String(f.page)) + '</td><td class="num">' + UI.esc(f.page) + '</td><td class="num">' + UI.esc(f.attempts || 1) + '</td><td class="muted">' + UI.esc(f.lastError || '') + '</td></tr>';
          }).join('')
          + '</tbody></table></div>' + ((R.failedPages.length > 50) ? '<p class="kv-note" style="margin-top:8px">showing 50 of ' + R.failedPages.length + '</p>' : '') + '</section>' : '')

        + ((gaps || []).length ? '<section class="section"><h2 style="font-size:17px">Coverage gaps</h2><div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Bucket</th><th class="num">Expected</th><th class="num">Covered</th><th>Note</th></tr></thead><tbody>'
          + gaps.slice(0, 50).map(function (g) {
            return '<tr><td class="mono">' + UI.esc(g.bucketKey) + '</td><td class="num">' + UI.esc(g.expected == null ? '—' : g.expected) + '</td><td class="num">' + UI.esc(g.covered) + '</td><td class="muted">' + UI.esc(g.note) + '</td></tr>';
          }).join('')
          + '</tbody></table></div></section>' : '')

        + '<section class="section"><h2 style="font-size:17px">Import history</h2><div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>Run</th><th class="num">Products</th><th class="num">New</th><th class="num">Updated</th><th class="num">History entries</th><th>Duration</th></tr></thead><tbody>'
        + '<tr><td class="mono">' + UI.esc(crawl.runId) + '</td><td class="num">' + UI.num(crawl.uniqueProductsCollected) + '</td><td class="num">' + UI.num(crawl.newProducts) + '</td><td class="num">' + UI.num(crawl.updatedProducts) + '</td><td class="num">' + UI.num(crawl.priceHistoryEntriesAppended) + '</td><td>' + UI.esc(crawl.durationHuman) + '</td></tr>'
        + '</tbody></table></div><p class="kv-note" style="margin-top:8px">Each run of <code>node scrape.js</code> appends a row here and preserves all previous price records.</p></section>'

        + '<section class="section"><h2 style="font-size:17px">Raw reports</h2>'
        + '<div class="dir-grid" style="max-width:640px;margin-top:12px">'
        + '<a class="dir-item" href="../api/v1/crawl-report.json"><span class="n">crawl-report.json</span><span class="c">JSON</span></a>'
        + '<a class="dir-item" href="../api/v1/validation-report.json"><span class="n">validation-report.json</span><span class="c">JSON</span></a>'
        + '<a class="dir-item" href="../api/v1/failed-records.json"><span class="n">failed-records.json</span><span class="c">JSON</span></a>'
        + '<a class="dir-item" href="../api/v1/health.json"><span class="n">health.json</span><span class="c">JSON</span></a>'
        + '</div><p class="kv-note" style="margin-top:8px">Bundled with the dataset under <code>web/api/v1/</code> — they refresh on every crawl.</p></section>'
        + '</div>';
    }).catch(function (e) {
      ctx.root.innerHTML = '<div class="container" style="margin-top:48px"><div class="notice">' + UI.esc(e.message) + '</div></div>';
    });
  }

  MDB_ROUTER.add('/admin', renderAdmin);
})();

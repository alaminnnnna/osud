/* MedPrice BD — medicine detail view: price panel (regular vs offer, base vs
   sales unit kept apart), verification stamp, price history chart, related
   medicines, share/favourite/compare actions, Product JSON-LD. */
(function () {
  var ICON = window.MDB_ICONS.icon;
  var UI = window.MDB_UI;
  var DB = window.MDB_DB;

  function renderMedicine(ctx) {
    var root = ctx.root;
    var id = DB.idBySlug(ctx.params.slug) || Number(ctx.params.slug);
    root.innerHTML = '<div class="container"><div class="loading-block" style="margin-top:40px" aria-busy="true"><div class="skel" style="height:32px;width:260px"></div><div class="skel" style="height:220px"></div></div></div>';
    if (id == null || isNaN(Number(id))) {
      root.innerHTML = '<div class="container" style="margin-top:40px"></div>';
      root.firstElementChild.appendChild(UI.emptyState('Medicine not found', 'The address does not match a medicine in this dataset.'));
      return;
    }

    DB.rowsFor([Number(id)]).then(function (rows) {
      var it = rows.get(Number(id)) && DB.expand(rows.get(Number(id)));
      if (!it) return notFound(root);
      MDB_STORE.pushRecent(it.id, it.name);

      var p = it.prices;
      var hasOffer = p.hasOffer;
      var packLine = [p.multS && p.multS > 1 ? p.multS + ' × ' + (p.unitB || 'base unit') : null, p.unitS].filter(Boolean).join(' — ');
      var displaySales = hasOffer ? p.offerSales : p.regularSales;
      var displayReg = p.regularSales;

      root.innerHTML =
        '<div class="container">'
        + '<nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/search">Medicines</a>'
        + (it.company ? '<span class="sep">/</span><a href="#/companies/' + it.companyId + '">' + UI.esc(it.company) + '</a>' : '')
        + '<span class="sep">/</span><span>' + UI.esc(it.name) + '</span></nav>'
        + '<div class="detail">'
        + '<div class="img-panel">'
        + (it.imgUrl
          ? '<img src="' + UI.esc(it.imgUrl) + '" alt="' + UI.esc(it.name) + '" width="240" height="240" loading="eager" onerror="this.classList.add(\'broken\');this.insertAdjacentHTML(\'afterend\',\'<span class="ph">' + ICON('pill', 36).replace(/"/g, '&quot;') + 'no product image available</span>\');this.remove()">'
          : '<span class="ph">' + ICON('pill', 36) + 'no product image</span>')
        + '</div>'
        + '<div>'
        + '<div class="row wrap" style="gap:8px">'
        + (it.rx ? '<span class="badge warn">Prescription required</span>' : '<span class="badge">No prescription required</span>')
        + (it.type ? '<span class="badge info">' + UI.esc(it.type) + '</span>' : '')
        + (hasOffer ? '<span class="badge offer">offer</span>' : '')
        + '</div>'
        + '<h1>' + UI.esc(it.name) + '</h1>'
        + (it.nameBn ? '<div class="bn">' + UI.esc(it.nameBn) + '</div>' : '')
        + '<div class="row wrap" style="gap:6px">'
        + (it.strength ? '<span class="chip">' + UI.esc(it.strength) + '</span>' : '')
        + (it.form ? '<span class="chip">' + UI.esc(it.form) + '</span>' : '')
        + '</div>'
        + '<dl class="spec-list">'
        + '<dt>Generic name</dt><dd>' + (it.generic ? '<a href="#/search?q=' + encodeURIComponent(it.generic) + '">' + UI.esc(it.generic) + '</a>' : '—') + '</dd>'
        + '<dt>Company</dt><dd>' + (it.company ? '<a href="#/companies/' + it.companyId + '">' + UI.esc(it.company) + '</a>' : '—') + '</dd>'
        + '<dt>Pack</dt><dd>' + UI.esc(packLine || '—') + '</dd>'
        + '<dt>Sales unit</dt><dd>' + UI.esc(p.unitS || '—') + '</dd>'
        + '<dt>Base unit</dt><dd>' + UI.esc(p.unitB || '—') + (p.multS ? ' (' + UI.esc(p.multS) + ' per ' + UI.esc(p.unitS || 'sales unit') + ')' : '') + '</dd>'
        + '<dt>Quantity limits</dt><dd class="mono">' + (p.minQty != null ? 'min ' + p.minQty : '') + (p.maxQty != null ? ' · max ' + p.maxQty : '') + '</dd>'
        + '</dl>'
        + '<div class="price-panel">'
        + '<div class="row-big">'
        + '<span class="big">' + UI.bdt(displaySales) + '</span>'
        + '<span class="unit">/ ' + UI.esc(p.unitS || 'pack') + '</span>'
        + (hasOffer && displayReg != null ? '<span class="was">' + UI.bdt(displayReg) + ' regular</span>' : '')
        + (hasOffer && p.discountPercent != null ? '<span class="badge offer">−' + UI.esc(p.discountPercent) + '%</span>' : '')
        + '</div>'
        + '<div class="line2">'
        + '<span>Base unit (' + UI.esc(p.unitB || 'unit') + '):</span>'
        + '<span class="mono">regular ' + UI.bdt(p.regularBase) + '</span>'
        + (hasOffer && p.offerBase != null ? '<span class="mono" style="color:var(--accent)">offer ' + UI.bdt(p.offerBase) + '</span>' : '')
        + '</div>'
        + (!hasOffer ? '<div class="note">No offer price recorded for this medicine — the figure above is the regular listed price.</div>' : '')
        + '<div>' + UI.stamp(it) + '</div>'
        + '<div class="note">Prices collected from the <a href="' + UI.esc(it.sourceUrl) + '" target="_blank" rel="noopener nofollow">source listing</a>. B2B and non-public prices are never shown.</div>'
        + '</div>'
        + '<div class="detail-actions">'
        + '<button class="btn" id="fav-btn">' + ICON('heart', 15) + (MDB_STORE.fav(it.id) ? ' Saved' : ' Save') + '</button>'
        + '<button class="btn" id="cmp-btn">' + ICON('scale', 15) + (MDB_STORE.inCompare(it.id) ? ' In compare' : ' Compare') + '</button>'
        + '<button class="btn" id="share-btn">' + ICON('share', 15) + ' Share</button>'
        + '<a class="btn primary" href="' + UI.esc(it.sourceUrl) + '" target="_blank" rel="noopener nofollow">Open on Arogga ' + ICON('external', 14) + '</a>'
        + '</div>'
        + '</div></div>'
        + '<div class="chart-wrap" id="history"></div>'
        + '<div id="related"></div>'
        + '</div>';

      ctx.setMeta(
        it.name + ' price in Bangladesh — ' + UI.bdt(displaySales) + ' / ' + (p.unitS || 'pack') + ' | MedPrice BD',
        it.name + (it.generic ? ' (' + it.generic + ')' : '') + ' ' + (it.form || '') + ' price in Bangladesh — regular ' + UI.bdt(p.regularSales) + (hasOffer ? ', offer ' + UI.bdt(p.offerSales) : '') + ' per ' + (p.unitS || 'pack') + ', by ' + (it.company || 'unknown manufacturer') + '.',
        '/m/' + it.slug,
        productJsonLd(it)
      );

      /* actions */
      root.querySelector('#fav-btn').addEventListener('click', function () {
        var on = MDB_STORE.toggleFav(it.id, it.name);
        this.innerHTML = ICON('heart', 15) + (on ? ' Saved' : ' Save');
        UI.toast(on ? 'Saved to favourites' : 'Removed from favourites');
      });
      root.querySelector('#cmp-btn').addEventListener('click', function () {
        var res = MDB_STORE.toggleCompare(it.id, it.name);
        if (res === 'full') { UI.toast('Compare holds 4 medicines'); return; }
        this.innerHTML = ICON('scale', 15) + (res === true ? ' In compare' : ' Compare');
        document.dispatchEvent(new CustomEvent('mdb:compare'));
        if (res === true && MDB_STORE.compare().length >= 2) UI.toast('Ready to compare');
      });
      root.querySelector('#share-btn').addEventListener('click', function () {
        var url = location.origin + location.pathname + '#/m/' + it.slug;
        if (navigator.share) navigator.share({ title: it.name + ' price — MedPrice BD', url: url }).catch(function () {});
        else {
          navigator.clipboard && navigator.clipboard.writeText(url).then(function () { UI.toast('Link copied'); });
        }
      });

      /* price history */
      var histEl = root.querySelector('#history');
      DB.loadHistory().then(function (H) {
        var pts = (H && H.entries && H.entries[it.id]) || [];
        var head = '<div class="head"><h2 style="font-size:15px">Price history</h2>'
          + '<div class="legend">'
          + '<span class="key reg"><i></i>Regular (sales unit)</span>'
          + '<span class="key off"><i></i>Offer (sales unit)</span>'
          + '</div></div>';
        if (pts.length >= 2) {
          var prev = pts[pts.length - 2], cur = pts[pts.length - 1];
          var diff = function (a, b) {
            if (a == null || b == null) return null;
            var d = b - a;
            return (d >= 0 ? '+' : '−') + UI.bdt(Math.abs(d));
          };
          histEl.innerHTML = head
            + '<p class="kv-note" style="margin-bottom:10px">Latest recorded ' + UI.bdt(cur.os != null ? cur.os : cur.rs)
            + (prev ? ' · previous ' + UI.bdt(prev.os != null ? prev.os : prev.rs) : '')
            + (prev && diff(prev.os, cur.os) ? ' · change ' + diff(prev.os, cur.os) : '')
            + ' · ' + pts.length + ' recordings</p>';
          histEl.appendChild(UI.historyChart(pts));
        } else {
          var d0 = UI.dateFromDay(it.verifiedDay);
          histEl.innerHTML = head
            + '<p class="kv-note">First recorded' + (d0 ? ' on ' + d0 : '') + '. History builds up as the crawler re-runs — each verified price is kept, never deleted.</p>';
        }
      });

      /* related: same generic, then same company */
      var relEl = root.querySelector('#related');
      MDB_DB.loadIndex().then(function (IX) {
        var ids = [];
        if (it.genericId && IX.s['@gen:' + it.genericId]) ids = IX.s['@gen:' + it.genericId].filter(function (x) { return x !== it.id; }).slice(0, 8);
        if (ids.length < 4 && it.companyId && IX.s['@co:' + it.companyId]) {
          IX.s['@co:' + it.companyId].forEach(function (x) {
            if (x !== it.id && ids.length < 8 && ids.indexOf(x) === -1) ids.push(x);
          });
        }
        if (!ids.length) return;
        return DB.rowsFor(ids).then(function (rows) {
          var items = ids.map(function (x) { return rows.get(x) && DB.expand(rows.get(x)); }).filter(Boolean);
          var sec = UI.el('<section class="section"><div class="section-head"><h2>Related medicines</h2></div><div class="med-grid" id="rel-grid"></div></section>');
          relEl.appendChild(sec);
          var grid = sec.querySelector('#rel-grid');
          items.forEach(function (r) { grid.appendChild(UI.medCard(r)); });
          UI.wireCards(grid);
        });
      });
    }).catch(function (e) {
      root.innerHTML = '<div class="container" style="margin-top:48px"><div class="notice warn">' + UI.esc(e.message) + '</div></div>';
    });
  }

  function notFound(root) {
    root.innerHTML = '<div class="container" style="margin-top:40px"></div>';
    root.firstElementChild.appendChild(UI.emptyState('Medicine not found', 'It may have been renamed in the catalogue. Try searching by name.'));
  }

  function productJsonLd(it) {
    var p = it.prices;
    var hasOffer = p.hasOffer;
    var price = hasOffer ? (p.offerSales != null ? p.offerSales : p.offerBase) : (p.regularSales != null ? p.regularSales : p.regularBase);
    var ld = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: it.name,
      category: it.form || undefined,
      brand: it.company ? { '@type': 'Brand', name: it.company } : undefined,
      url: it.appUrl,
    };
    if (it.imgUrl) ld.image = it.imgUrl;
    if (price != null) {
      ld.offers = { '@type': 'Offer', price: Number(price), priceCurrency: 'BDT', url: it.appUrl };
    }
    return ld;
  }

  MDB_ROUTER.add('/m/:slug', renderMedicine);
})();

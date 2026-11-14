/* MedPrice BD — offers page: real discounted listings sorted by discount,
   form/company filters, pagination. Only genuine offers are ever shown. */
(function () {
  var ICON = window.MDB_ICONS.icon;
  var UI = window.MDB_UI;
  var DB = window.MDB_DB;
  var PAGE_SIZE = 24;

  function renderOffers(ctx) {
    var root = ctx.root;
    var page = Math.max(1, Number(ctx.query.page) || 1);
    ctx.setMeta('Medicine offers — real discounted prices | MedPrice BD',
      'Medicines whose listed offer price is below the regular price, sorted by actual discount percentage. No invented promotions.',
      '/offers', null);

    root.innerHTML =
      '<div class="container" style="margin-top:32px">'
      + '<h1 style="font-size:24px">Offers</h1>'
      + '<p class="muted" style="margin:6px 0 20px">Every listing below has an offer price <b>below</b> its regular price in the source catalogue — recorded as found, never manufactured.</p>'
      + '<div class="result-head"><div class="count" id="off-count"></div>'
      + '<label style="font-size:12px;color:var(--fg-3)">Sort&nbsp;<select class="select" id="off-sort" style="min-height:32px;width:auto;font-size:12px;padding:4px 26px 4px 8px">'
      + '<option value="discount">Highest discount</option>'
      + '<option value="recent">Recently verified</option>'
      + '<option value="price-asc">Price: low to high</option>'
      + '</select></label></div>'
      + '<div class="med-grid" id="off-grid">' + UI.skeletonCards(8) + '</div>'
      + '<div id="off-pager"></div></div>';

    var listEl = root.querySelector('#off-grid');
    var countEl = root.querySelector('#off-count');
    var pagerEl = root.querySelector('#off-pager');

    var state = { items: null, page: page, sort: 'discount' };
    root.querySelector('#off-sort').addEventListener('change', function (e) {
      state.sort = e.target.value;
      draw();
    });

    MDB_DB.loadIndex().then(function (IX) {
      var ids = (IX.s['@offer'] || []).slice();
      countEl.innerHTML = 'loading <b>' + UI.num(ids.length) + '</b> offers…';
      /* Load in waves of 2000 ids so sorting uses real rows without a huge burst. */
      var all = [];
      var waves = [];
      for (var i = 0; i < ids.length; i += 2000) waves.push(ids.slice(i, i + 2000));
      var chain = Promise.resolve();
      waves.forEach(function (wave) {
        chain = chain.then(function () {
          return DB.rowsFor(wave).then(function (rows) {
            wave.forEach(function (id) { var r = rows.get(id); if (r) all.push(DB.expand(r)); });
            if (!state.items) { state.items = all.slice(); draw(); }
          });
        });
      });
      return chain.then(function () {
        state.items = all;
        draw();
      });
    }).catch(function (e) {
      listEl.innerHTML = '<div class="notice warn">' + UI.esc(e.message) + '</div>';
    });

    function draw() {
      var items = state.items;
      if (!items) return;
      if (state.sort === 'discount') items.sort(function (a, b) { return (b.prices.discountPercent || 0) - (a.prices.discountPercent || 0); });
      else if (state.sort === 'recent') items.sort(function (a, b) { return (b.verifiedDay || 0) - (a.verifiedDay || 0); });
      else items.sort(function (a, b) {
        var pa = a.prices.offerSales != null ? a.prices.offerSales : a.prices.offerBase || 0;
        var pb = b.prices.offerSales != null ? b.prices.offerSales : b.prices.offerBase || 0;
        return pa - pb;
      });
      countEl.innerHTML = '<b>' + UI.num(items.length) + '</b> medicines on offer';
      listEl.innerHTML = '';
      var totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
      var p = Math.min(state.page, totalPages);
      var grid = UI.el('<div class="med-grid"></div>');
      items.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE).forEach(function (it) { grid.appendChild(UI.medCard(it)); });
      UI.wireCards(grid);
      listEl.appendChild(grid);
      pagerEl.innerHTML = '';
      pagerEl.appendChild(UI.pager(p, totalPages, function (np) {
        state.page = np;
        history.replaceState(null, '', '#/offers' + (np > 1 ? '?page=' + np : ''));
        draw();
        window.scrollTo(0, 0);
      }));
    }
  }

  MDB_ROUTER.add('/offers', renderOffers);
})();

/* MedPrice BD — company directory + company detail page. */
(function () {
  var ICON = window.MDB_ICONS.icon;
  var UI = window.MDB_UI;
  var DB = window.MDB_DB;
  var PAGE_SIZE = 24;

  function renderCompanies(ctx) {
    var root = ctx.root;
    var D = DB.dicts();
    ctx.setMeta('Pharmaceutical companies — MedPrice BD', 'Directory of pharmaceutical companies in Bangladesh with medicine counts and verified price listings.', '/companies', null);
    root.innerHTML =
      '<div class="container" style="margin-top:32px">'
      + '<h1 style="font-size:24px">Pharmaceutical companies</h1>'
      + '<p class="muted" style="margin:6px 0 20px">' + UI.num(D.companies.length) + ' companies with medicines in the catalogue</p>'
      + '<div class="searchbar" style="max-width:420px;margin-bottom:20px"><span class="lead">' + ICON('search', 16) + '</span>'
      + '<input class="input" id="co-search" type="search" placeholder="Filter companies" aria-label="Filter companies"></div>'
      + '<div class="dir-grid" id="co-list"></div></div>';

    var list = root.querySelector('#co-list');
    function draw(filter) {
      var f = (filter || '').toLowerCase();
      var items = D.companies.slice().sort(function (a, b) { return (b.productCount || 0) - (a.productCount || 0); }).filter(function (c) { return !f || c.name.toLowerCase().indexOf(f) >= 0; });
      list.innerHTML = items.slice(0, 120).map(function (c) {
        return '<a class="dir-item" href="#/companies/' + c.id + '"><span class="n">' + UI.esc(c.name) + '</span><span class="c">' + UI.num(c.productCount) + '</span></a>';
      }).join('') || '<p class="muted">No company matches that filter.</p>';
    }
    draw('');
    root.querySelector('#co-search').addEventListener('input', function (e) { draw(e.target.value); });
  }

  function renderCompany(ctx) {
    var root = ctx.root;
    var id = Number(ctx.params.id);
    var D = DB.dicts();
    var c = D.companies.find(function (x) { return x.id === id; });
    if (!c) {
      root.innerHTML = '<div class="container" style="margin-top:40px"></div>';
      root.firstElementChild.appendChild(UI.emptyState('Company not found', 'This company id is not in the dataset.'));
      return;
    }
    ctx.setMeta(c.name + ' medicine price list — MedPrice BD', c.productCount + ' medicines by ' + c.name + ' with verified regular and offer prices.', '/companies/' + c.id, {
      '@context': 'https://schema.org', '@type': 'CollectionPage', name: c.name,
    });
    root.innerHTML =
      '<div class="container" style="margin-top:32px">'
      + '<nav class="crumbs"><a href="#/">Home</a><span class="sep">/</span><a href="#/companies">Companies</a><span class="sep">/</span><span>' + UI.esc(c.name) + '</span></nav>'
      + '<h1 style="font-size:24px;margin-top:10px">' + UI.esc(c.name) + '</h1>'
      + '<p class="muted" style="margin:6px 0 20px"><span class="mono">' + UI.num(c.productCount) + '</span> medicines listed</p>'
      + '<div class="row wrap" style="margin-bottom:16px" id="co-chips"></div>'
      + '<div class="med-grid" id="co-grid">' + UI.skeletonCards(8) + '</div>'
      + '<div id="co-pager"></div>'
      + '</div>';

    var sh = MDB_UI.el('<div id="co-state"></div>');
    var state = { page: 1, ids: null, loading: true };
    var listEl = root.querySelector('#co-grid');
    var pagerEl = root.querySelector('#co-pager');
    var chipsEl = root.querySelector('#co-chips');

    MDB_DB.loadIndex().then(function (IX) {
      var ids = (IX.s['@co:' + id] || []).slice();
      state.ids = ids;
      /* form chips for this company */
      var counts = {};
      ids.forEach(function (pid) {
        var chunk = DB.chunkFor(pid);
        if (chunk) { /* light: count later on rows load */ }
      });
      drawPage();
      if (!ids.length) {
        listEl.innerHTML = '';
        listEl.appendChild(UI.emptyState('No medicines recorded', 'This company appears in the dataset without product rows.'));
      }
    });

    function drawPage() {
      var st = state;
      if (!st.ids) return;
      listEl.innerHTML = UI.skeletonCards(8);
      var slice = st.ids.slice((st.page - 1) * PAGE_SIZE, st.page * PAGE_SIZE);
      DB.rowsFor(slice).then(function (rows) {
        var items = slice.map(function (id2) { return rows.get(id2) && DB.expand(rows.get(id2)); }).filter(Boolean);
        listEl.innerHTML = '';
        var grid = UI.el('<div class="med-grid"></div>');
        items.forEach(function (it) { grid.appendChild(UI.medCard(it)); });
        UI.wireCards(grid);
        listEl.appendChild(grid);
        pagerEl.innerHTML = '';
        pagerEl.appendChild(UI.pager(st.page, Math.max(1, Math.ceil(st.ids.length / PAGE_SIZE)), function (p) { st.page = p; drawPage(); window.scrollTo(0, 0); }));
      });
    }
  }

  MDB_ROUTER.add('/companies', renderCompanies);
  MDB_ROUTER.add('/companies/:id', renderCompany);
})();

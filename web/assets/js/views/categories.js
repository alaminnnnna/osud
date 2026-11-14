/* MedPrice BD — category directory + category detail page. */
(function () {
  var ICON = window.MDB_ICONS.icon;
  var UI = window.MDB_UI;
  var DB = window.MDB_DB;
  var PAGE_SIZE = 24;

  function renderCategories(ctx) {
    var root = ctx.root;
    var D = DB.dicts();
    ctx.setMeta('Medicine categories — MedPrice BD', 'Browse medicines by therapeutic category and product type, with counts from the crawled catalogue.', '/categories', null);
    /* group by type */
    var byType = {};
    D.categories.forEach(function (c) {
      if (!c.name || !c.productCount) return;
      var t = c.type || 'other';
      (byType[t] = byType[t] || []).push(c);
    });
    var groups = Object.keys(byType).sort(function (a, b) {
      return byType[b].reduce(function (s, c) { return s + c.productCount; }, 0) - byType[a].reduce(function (s, c) { return s + c.productCount; }, 0);
    });
    root.innerHTML =
      '<div class="container" style="margin-top:32px">'
      + '<h1 style="font-size:24px">Categories</h1>'
      + '<p class="muted" style="margin:6px 0 20px">' + UI.num(D.categories.filter(function (c) { return c.productCount > 0; }).length) + ' categories across the catalogue</p>'
      + '<div class="searchbar" style="max-width:420px;margin-bottom:20px"><span class="lead">' + ICON('search', 16) + '</span>'
      + '<input class="input" id="cat-search" type="search" placeholder="Filter categories" aria-label="Filter categories"></div>'
      + '<div id="cat-groups"></div></div>';

    var holder = root.querySelector('#cat-groups');
    function draw(filter) {
      var f = (filter || '').toLowerCase();
      holder.innerHTML = groups.map(function (t) {
        var cats = byType[t].filter(function (c) { return !f || c.name.toLowerCase().indexOf(f) >= 0; })
          .sort(function (a, b) { return b.productCount - a.productCount; }).slice(0, 40);
        if (!cats.length) return '';
        return '<section class="section" style="margin-top:28px"><div class="section-head"><h2 style="font-size:15px">' + UI.esc(t.charAt(0).toUpperCase() + t.slice(1)) + '</h2></div>'
          + '<div class="dir-grid">' + cats.map(function (c) {
            return '<a class="dir-item" href="#/categories/' + c.id + '"><span class="n">' + UI.esc(c.name) + '</span><span class="c">' + UI.num(c.productCount) + '</span></a>';
          }).join('') + '</div></section>';
      }).join('');
    }
    draw('');
    root.querySelector('#cat-search').addEventListener('input', function (e) { draw(e.target.value); });
  }

  function renderCategory(ctx) {
    var root = ctx.root;
    var id = Number(ctx.params.id);
    var D = DB.dicts();
    var c = D.categories.find(function (x) { return x.id === id; });
    ctx.setMeta(
      (c && c.name ? c.name : 'Category') + ' medicine prices — MedPrice BD',
      'Medicines in ' + (c && c.name ? c.name : 'category ' + id) + ' with verified regular and offer prices.',
      '/categories/' + id,
      { '@context': 'https://schema.org', '@type': 'CollectionPage', name: c && c.name }
    );
    root.innerHTML =
      '<div class="container" style="margin-top:32px">'
      + '<nav class="crumbs"><a href="#/">Home</a><span class="sep">/</span><a href="#/categories">Categories</a><span class="sep">/</span><span>' + UI.esc(c && c.name ? c.name : 'Category ' + id) + '</span></nav>'
      + '<h1 style="font-size:24px;margin-top:10px">' + UI.esc(c && c.name ? c.name : 'Category ' + id) + '</h1>'
      + '<p class="muted" style="margin:6px 0 20px"><span class="mono" id="cat-count">' + (c ? UI.num(c.productCount) : '…') + '</span> medicines listed</p>'
      + '<div class="med-grid" id="cat-grid">' + UI.skeletonCards(8) + '</div>'
      + '<div id="cat-pager"></div></div>';

    var listEl = root.querySelector('#cat-grid');
    var pagerEl = root.querySelector('#cat-pager');
    var state = { page: 1 };

    MDB_DB.loadIndex().then(function (IX) {
      var ids = (IX.s['@cat:' + id] || []).slice();
      root.querySelector('#cat-count').textContent = UI.num(ids.length);
      if (!ids.length) {
        listEl.innerHTML = '';
        listEl.appendChild(UI.emptyState('Nothing in this category', 'The category exists in the site tree but no products carry it in this dataset.'));
        return;
      }
      drawPage();
      function drawPage() {
        listEl.innerHTML = UI.skeletonCards(8);
        var slice = ids.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
        DB.rowsFor(slice).then(function (rows) {
          listEl.innerHTML = '';
          var grid = UI.el('<div class="med-grid"></div>');
          slice.map(function (pid) { return rows.get(pid) && DB.expand(rows.get(pid)); }).filter(Boolean)
            .forEach(function (it) { grid.appendChild(UI.medCard(it)); });
          UI.wireCards(grid);
          listEl.appendChild(grid);
          pagerEl.innerHTML = '';
          pagerEl.appendChild(UI.pager(state.page, Math.max(1, Math.ceil(ids.length / PAGE_SIZE)), function (p) { state.page = p; drawPage(); window.scrollTo(0, 0); }));
        });
      }
    });
  }

  MDB_ROUTER.add('/categories', renderCategories);
  MDB_ROUTER.add('/categories/:id', renderCategory);
})();

/* MedPrice BD — home view: hero search + price board preview, stat strip,
   recently updated, offers, companies, categories, data transparency. */
(function () {
  var ICON = window.MDB_ICONS.icon;
  var UI = window.MDB_UI;
  var DB = window.MDB_DB;

  function priceBoard(items) {
    var rows = items.map(function (it) {
      var p = it.prices;
      var has = p.hasOffer;
      return '<li>'
        + '<span class="n">' + UI.esc(it.name) + '</span>'
        + '<span class="p">' + (has ? '<span class="now">' + UI.bdt(p.offerSales != null ? p.offerSales : p.offerBase) + '</span> <span class="was">' + UI.bdt(p.regularSales != null ? p.regularSales : p.regularBase) + '</span>' : '<span class="now">' + UI.bdt(p.regularSales != null ? p.regularSales : p.regularBase) + '</span>') + '</span>'
        + '<span class="g">' + UI.esc(it.generic || it.company || '') + '</span>'
        + '</li>';
    }).join('');
    var m = DB.meta();
    return '<div class="board" aria-label="Sample of today\'s prices">'
      + '<div class="head"><span>price board</span><span>' + (m ? UI.esc(String(m.generatedAt).slice(0, 10)) : '') + '</span></div>'
      + '<ul>' + rows + '</ul>'
      + '<div class="foot"><span>regular / offer, per sales unit</span><span>arogga.com</span></div>'
      + '</div>';
  }

  function section(id, title, moreHref, moreLabel, inner) {
    return '<section class="section" id="' + id + '">'
      + '<div class="section-head"><h2>' + title + '</h2>'
      + (moreHref ? '<a class="more" href="' + moreHref + '">' + (moreLabel || 'See all') + '</a>' : '')
      + '</div>' + inner + '</section>';
  }

  function renderHome(ctx) {
    var root = ctx.root;
    root.innerHTML = '<div class="container"><div class="loading-block" style="margin-top:48px" aria-busy="true"><div class="skel" style="height:40px;width:320px"></div><div class="skel" style="height:56px;max-width:640px"></div><div class="skel" style="height:180px"></div></div></div>';

    DB.ready.then(function (m) {
      var heroHtml =
        '<section class="hero"><div class="split">'
        + '<div>'
        + '<h1>Medicine prices in Bangladesh, checked against the source</h1>'
        + '<p class="sub">Search ' + UI.num(m.totalProducts) + ' medicines by brand name, generic, company, strength or dosage form. Regular and offer prices shown separately, with the date each price was verified.</p>'
        + '<div class="searchbar"><span class="lead">' + ICON('search', 18) + '</span>'
        + '<input class="input" id="hero-search" type="search" placeholder="Search — e.g. Napa, Seclo, paracetamol" aria-label="Search medicines">'
        + '<span class="kbd"><kbd>/</kbd></span></div>'
        + '<div class="popular" id="popular-chips"><span class="lbl">Popular:</span></div>'
        + '</div>'
        + '<div id="board-slot">' + '<div class="skel" style="height:280px"></div>' + '</div>'
        + '</div>'
        + '<div class="stat-strip">'
        + '<div class="stat"><div class="v" id="st-total">…</div><div class="k">medicines tracked</div></div>'
        + '<div class="stat"><div class="v" id="st-companies">…</div><div class="k">pharmaceutical companies</div></div>'
        + '<div class="stat"><div class="v" id="st-offers">…</div><div class="k">medicines on offer</div></div>'
        + '<div class="stat"><div class="v" id="st-verified">…</div><div class="k">fully verified records</div></div>'
        + '</div>'
        + '</section>'
        + '<div id="home-sections"></div>';

      root.innerHTML = heroHtml;

      /* search combobox */
      var input = root.querySelector('#hero-search');
      UI.combobox(input, {
        onSubmit: function (q) { if (q) MDB_ROUTER.nav('#/search?q=' + encodeURIComponent(q)); },
        onPick: function (id) { var slug = DB.slugOf(id); MDB_ROUTER.nav('#/m/' + (slug || id)); },
      });
      document.addEventListener('keydown', slashHandler);
      function slashHandler(e) {
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          var inp = document.getElementById('hero-search');
          inp && inp.focus();
        }
      }

      /* popular chips (real top-ordered names) */
      DB.rowsFor(m.popular.slice(0, 8)).then(function (rows) {
        var wrap = root.querySelector('#popular-chips');
        m.popular.slice(0, 8).forEach(function (id) {
          var it = rows.get(id) && DB.expand(rows.get(id));
          if (!it) return;
          var b = UI.el('<button class="chip">' + UI.esc(it.name) + '</button>');
          b.addEventListener('click', function () { MDB_ROUTER.nav('#/search?q=' + encodeURIComponent(it.name)); });
          wrap.appendChild(b);
        });
      });

      /* price board: top ordered with offers first */
      var boardIds = m.recentUpdated.slice(0, 40).concat(m.popular).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 40);
      DB.rowsFor(boardIds).then(function (rows) {
        var items = boardIds.map(function (id) { return rows.get(id) && DB.expand(rows.get(id)); }).filter(Boolean);
        var withOffers = items.filter(function (i) { return i.prices.hasOffer; }).slice(0, 6);
        if (withOffers.length < 6) withOffers = items.slice(0, 6);
        root.querySelector('#board-slot').innerHTML = priceBoard(withOffers);
      });

      /* stat strip */
      root.querySelector('#st-total').textContent = UI.num(m.totalProducts);
      root.querySelector('#st-companies').textContent = UI.num(m.companiesCount);
      root.querySelector('#st-offers').textContent = UI.num(m.offerCount);
      root.querySelector('#st-verified').textContent = UI.num(m.verifiedCount);

      /* content sections */
      var secs = root.querySelector('#home-sections');
      DB.rowsFor(m.recentUpdated.slice(0, 24)).then(function (rows) {
        var cards = m.recentUpdated.slice(0, 8).map(function (id) { return rows.get(id) && DB.expand(rows.get(id)); }).filter(Boolean);
        var sec1 = UI.el(section('recent', 'Recently updated prices', '#/search?sort=recent', 'Browse all',
          '<div class="med-grid" id="recent-grid"></div>'));
        secs.appendChild(sec1);
        var grid = sec1.querySelector('#recent-grid');
        cards.forEach(function (it) { grid.appendChild(UI.medCard(it)); });
        UI.wireCards(grid);
      });

      DB.rowsFor(Array.from(new Set(m.popular.slice(0, 40).concat(m.recentUpdated.slice(0, 120))))).then(function (rows) {
        var all = Array.from(new Set(m.popular.slice(0, 40).concat(m.recentUpdated.slice(0, 120))))
          .map(function (id) { return rows.get(id) && DB.expand(rows.get(id)); }).filter(Boolean)
          .filter(function (i) { return i.prices.hasOffer; })
          .sort(function (a, b) { return (b.prices.discountPercent || 0) - (a.prices.discountPercent || 0); })
          .slice(0, 8);
        if (all.length) {
          var sec2 = UI.el(section('offers', 'Verified offers', '#/offers', 'All offers',
            '<div class="med-grid" id="offers-grid"></div>'));
          secs.appendChild(sec2);
          var g2 = sec2.querySelector('#offers-grid');
          all.forEach(function (it) { g2.appendChild(UI.medCard(it)); });
          UI.wireCards(g2);
        }
      });

      /* browse companies + categories */
      var D = DB.dicts();
      var topCompanies = D.companies.slice().sort(function (a, b) { return (b.productCount || 0) - (a.productCount || 0); }).slice(0, 12).map(function (c) {
        return '<a class="dir-item" href="#/companies/' + c.id + '"><span class="n">' + UI.esc(c.name) + '</span><span class="c">' + UI.num(c.productCount) + '</span></a>';
      }).join('');
      var topCats = D.categories.filter(function (c) { return c.name && c.productCount > 0; }).sort(function (a, b) { return (b.productCount || 0) - (a.productCount || 0); }).slice(0, 12).map(function (c) {
        return '<a class="dir-item" href="#/categories/' + c.id + '"><span class="n">' + UI.esc(c.name) + '</span><span class="c">' + UI.num(c.productCount) + '</span></a>';
      }).join('');
      secs.appendChild(UI.el(section('companies', 'Browse pharmaceutical companies', '#/companies', 'All companies',
        '<div class="dir-grid">' + topCompanies + '</div>')));
      secs.appendChild(UI.el(section('categories', 'Browse categories', '#/categories', 'All categories',
        '<div class="dir-grid">' + topCats + '</div>')));

      /* transparency + API */
      secs.appendChild(UI.el(section('how', 'How the data works', '#/about', 'Methodology',
        '<div class="feature-row">'
        + '<div class="feature"><span class="ic">' + ICON('shield') + '</span><h3>Verified against the source</h3><p>Every price carries the date it was collected from the Arogga public catalogue API. Records that fail checks are marked for re-check, never silently fixed.</p></div>'
        + '<div class="feature"><span class="ic">' + ICON('scale') + '</span><h3>Regular vs offer, kept apart</h3><p>Regular (MRP) and offer prices are stored as separate values with their own units — base unit and sales unit are never mixed.</p></div>'
        + '<div class="feature"><span class="ic">' + ICON('clock') + '</span><h3>Price history preserved</h3><p>Every crawl keeps previous prices. When a price moves, the old value stays in history — the catalogue only ever shows the latest verified figure.</p></div>'
        + '</div>')));

      secs.appendChild(UI.el(section('api', 'Open data for developers', '#/api-docs', 'API documentation',
        '<div class="feature-row" style="grid-template-columns: 1fr">'
        + '<div class="feature"><h3>A read-only JSON API ships with every crawl</h3><p style="margin-bottom:12px">Health, dataset metadata, companies, categories, paginated medicine and offer listings — plain JSON files, no server required. Point any static host at the <code>web/</code> folder.</p>'
        + '<pre class="code"><span class="cmt"># latest dataset health</span>\ncurl ' + (location.origin.startsWith('http') ? location.origin : 'https://your-host') + '/api/v1/health.json</pre>'
        + '</div></div>')));

      root.querySelector('#hero-search').focus();
      ctx.setMeta && ctx.setMeta(
        'MedPrice BD — Medicine prices in Bangladesh',
        'Search ' + UI.num(m.totalProducts) + ' medicines by brand name, generic, company, strength or dosage form. Regular and offer prices verified from the public Arogga catalogue.',
        '/',
        null
      );
    }).catch(function (e) {
      root.innerHTML = '<div class="container" style="margin-top:48px"><div class="notice warn">' + UI.esc(e.message) + '</div></div>';
    });
  }

  MDB_ROUTER.add('/', renderHome);
})();

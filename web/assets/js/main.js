/* MedPrice BD — application shell: top navigation, mobile tab bar, footer,
   theme control, compare tray, boot. */
(function () {
  var ICON = window.MDB_ICONS.icon;
  var LOGO = window.MDB_LOGO;

  /* ---------- theme control (light / system / dark) ---------- */
  function themeControl() {
    var pref = MDB_STORE.theme();
    var btn = function (val, icon, label) {
      return '<button class="chip theme-opt' + (pref === val ? ' on' : '') + '" data-theme="' + val + '" aria-pressed="' + (pref === val) + '" aria-label="' + label + '">' + ICON(icon, 14) + label + '</button>';
    };
    return '<div class="row wrap" style="gap:8px" role="group" aria-label="Colour theme">'
      + btn('light', 'sun', 'Light') + btn('system', 'monitor', 'System') + btn('dark', 'moon', 'Dark')
      + '</div>';
  }
  function wireTheme(root) {
    root.querySelectorAll('.theme-opt').forEach(function (b) {
      b.addEventListener('click', function () {
        MDB_STORE.setTheme(b.dataset.theme);
        var wrap = b.closest('[role="group"]');
        if (wrap) {
          wrap.innerHTML = themeControl();
          wireTheme(wrap);
        }
      });
    });
  }

  /* ---------- top navigation ---------- */
  function renderTopnav() {
    var nav = document.getElementById('topnav');
    nav.innerHTML =
      '<div class="bar">'
      + '<a class="brand" href="#/" aria-label="MedPrice BD home"><span class="mark">' + LOGO() + '</span>MedPrice BD</a>'
      + '<div class="nav-search"><span class="lead">' + ICON('search', 14) + '</span>'
      + '<input class="input" id="nav-search-input" type="search" placeholder="Search medicines, generics, companies" aria-label="Search medicines"></div>'
      + '<nav class="links" aria-label="Primary">'
      + link('#/search', 'Medicines', 'search')
      + link('#/companies', 'Companies', 'building')
      + link('#/categories', 'Categories', 'grid')
      + link('#/offers', 'Offers', 'tag')
      + link('#/api-docs', 'API', 'code')
      + '</nav>'
      + '<button class="btn icon" id="theme-btn" aria-label="Colour theme" aria-haspopup="dialog">' + ICON('sun', 16) + '</button>'
      + '</div>';
    function link(href, label, ic) { return '<a href="' + href + '" data-route="' + href + '">' + esc(label) + '</a>'; }
    function esc(s) { return s; }

    var input = nav.querySelector('#nav-search-input');
    if (input) {
      MDB_UI.combobox(input, {
        onSubmit: function (q) { if (q) MDB_ROUTER.nav('#/search?q=' + encodeURIComponent(q)); },
        onPick: function (id, name) { var slug = MDB_DB.slugOf(id); MDB_ROUTER.nav('#/m/' + (slug || id)); },
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && input.value.trim()) {
          MDB_ROUTER.nav('#/search?q=' + encodeURIComponent(input.value.trim()));
        }
      });
    }
    var tb = nav.querySelector('#theme-btn');
    tb.addEventListener('click', function () {
      var sh = MDB_UI.sheet(
        '<h3 style="font-size:15px;margin-bottom:12px">Colour theme</h3>' + themeControl(),
        { label: 'Colour theme' }
      );
      wireTheme(sh);
    });
    markActiveLink();
  }

  function markActiveLink() {
    var cur = MDB_ROUTER.current();
    document.querySelectorAll('#topnav .links a').forEach(function (a) {
      var route = a.dataset.route;
      var on = cur.path === route.slice(1) || (route !== '#/' && cur.path.startsWith(route.slice(1) + '/'));
      a.classList.toggle('on', on);
    });
  }

  /* ---------- mobile tab bar ---------- */
  function renderTabbar() {
    var bar = document.getElementById('tabbar');
    var tabs = [
      ['/', 'home', 'Home'],
      ['/search', 'search', 'Search'],
      ['/offers', 'tag', 'Offers'],
      ['/categories', 'grid', 'Categories'],
      ['more', 'more', 'More'],
    ];
    bar.innerHTML = tabs.map(function (t) {
      if (t[0] === 'more') return '<a href="#/more" data-route="more" id="tab-more"><span class="ic">' + ICON(t[1], 18) + '</span>' + t[2] + '</a>';
      return '<a href="#' + t[0] + '" data-route="' + t[0] + '"><span class="ic">' + ICON(t[1], 18) + '</span>' + t[2] + '</a>';
    }).join('');
    bar.querySelector('#tab-more').addEventListener('click', function (e) {
      e.preventDefault();
      moreSheet();
    });
  }

  function moreSheet() {
    var sh = MDB_UI.sheet(
      '<h3 style="font-size:15px;margin-bottom:14px">More</h3>'
      + '<div class="grid" style="gap:8px">'
      + sheetLink('#/compare', 'scale', 'Compare prices')
      + sheetLink('#/companies', 'building', 'Companies')
      + sheetLink('#/api-docs', 'code', 'Public API')
      + sheetLink('#/about', 'info', 'About & data transparency')
      + sheetLink('#/admin', 'db', 'Data dashboard')
      + '</div>'
      + '<h3 style="font-size:13px;color:var(--fg-3);margin:20px 0 10px">Colour theme</h3>' + themeControl(),
      { label: 'More menu' }
    );
    function sheetLink(href, ic, label) {
      return '<a class="dir-item" href="' + href + '" style="text-decoration:none"><span class="row" style="gap:10px;color:var(--accent)">' + ICON(ic, 16) + '<span class="n">' + label + '</span></span><span class="c">' + ICON('arrow', 14) + '</span></a>';
    }
    wireTheme(sh);
  }

  /* ---------- footer ---------- */
  function renderFooter() {
    var m = MDB_DB.meta();
    var f = document.getElementById('footer');
    f.innerHTML =
      '<div class="inner">'
      + '<div style="max-width:360px">'
      + '<a class="brand" href="#/" style="font-size:14px"><span class="mark">' + LOGO(18) + '</span>MedPrice BD</a>'
      + '<p style="margin-top:10px">Medicine price catalogue for Bangladesh. Regular and offer prices collected from the public Arogga catalogue. Price reference only — not medical advice, not a pharmacy.</p>'
      + (m ? '<p class="mono" style="margin-top:10px">dataset ' + m.runId + '</p>' : '')
      + '</div>'
      + '<div class="cols">'
      + '<div><h4>Catalogue</h4><ul>'
      + '<li><a href="#/search">All medicines</a></li>'
      + '<li><a href="#/offers">Offers</a></li>'
      + '<li><a href="#/companies">Companies</a></li>'
      + '<li><a href="#/categories">Categories</a></li>'
      + '</ul></div>'
      + '<div><h4>Data</h4><ul>'
      + '<li><a href="#/api-docs">Public API</a></li>'
      + '<li><a href="#/about">About & methodology</a></li>'
      + '<li><a href="#/admin">Data dashboard</a></li>'
      + '<li><a href="api/v1/health.json">Health (JSON)</a></li>'
      + '</ul></div>'
      + '</div>'
      + '</div>';
  }

  /* ---------- compare tray ---------- */
  function renderTray() {
    var tray = document.querySelector('.tray');
    var items = MDB_STORE.compare();
    if (!tray) {
      tray = MDB_UI.el('<div class="tray" role="region" aria-label="Compare tray"></div>');
      document.body.appendChild(tray);
    }
    if (items.length < 2) { tray.classList.remove('show'); return; }
    tray.innerHTML = '<span class="t-meta mono">' + items.length + ' to compare</span>'
      + '<a class="btn small primary" href="#/compare">Compare</a>'
      + '<button class="btn icon" aria-label="Clear compare">' + ICON('x', 14) + '</button>';
    tray.querySelector('.btn.icon').addEventListener('click', function () {
      MDB_STORE.clearCompare();
      document.dispatchEvent(new CustomEvent('mdb:compare'));
    });
    tray.classList.add('show');
  }

  /* ---------- boot ---------- */
  document.addEventListener('mdb:compare', renderTray);
  window.addEventListener('hashchange', markActiveLink);

  MDB_DB.ready.then(function () {
    renderTopnav();
    renderTabbar();
    renderFooter();
    renderTray();
    MDB_ROUTER.start();
    // refresh meta-driven bits on later loads
    document.dispatchEvent(new CustomEvent('mdb:ready'));
  }).catch(function (e) {
    document.getElementById('main').innerHTML =
      '<div class="container" style="margin-top:48px"><div class="notice warn"><b>Dataset not found.</b> The web bundles under <code>web/assets/js/db/</code> are missing. Run <code>node scrape.js --rebuild-web</code> in the project root to generate them from the crawled data.</div></div>';
    console.error(e);
  });
})();

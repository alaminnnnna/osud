/* MedPrice BD — search view: instant search, filter sidebar, sort, pagination,
   active filter chips, empty states with suggestions. State lives in the URL. */
(function () {
  var ICON = window.MDB_ICONS.icon;
  var UI = window.MDB_UI;
  var DB = window.MDB_DB;

  var PAGE_SIZE = 24;

  function stateFrom(query) {
    return {
      q: query.q || '',
      company: query.company ? Number(query.company) : null,
      category: query.category ? Number(query.category) : null,
      generic: query.generic ? Number(query.generic) : null,
      form: query.form || null,
      type: query.type || null,
      rx: query.rx === '1',
      offer: query.offer === '1',
      min: query.min ? Number(query.min) : null,
      max: query.max ? Number(query.max) : null,
      sort: query.sort || 'relevance',
      page: Math.max(1, Number(query.page) || 1),
    };
  }

  function stateToHash(st) {
    var p = new URLSearchParams();
    if (st.q) p.set('q', st.q);
    if (st.company) p.set('company', st.company);
    if (st.category) p.set('category', st.category);
    if (st.generic) p.set('generic', st.generic);
    if (st.form) p.set('form', st.form);
    if (st.type) p.set('type', st.type);
    if (st.rx) p.set('rx', '1');
    if (st.offer) p.set('offer', '1');
    if (st.min != null) p.set('min', st.min);
    if (st.max != null) p.set('max', st.max);
    if (st.sort && st.sort !== 'relevance') p.set('sort', st.sort);
    if (st.page > 1) p.set('page', st.page);
    var qs = p.toString();
    return '#/search' + (qs ? '?' + qs : '');
  }

  function setState(st) {
    MDB_ROUTER.nav(stateToHash(st));
  }

  function sortItems(items, sort) {
    switch (sort) {
      case 'name': items.sort(function (a, b) { return a.name.localeCompare(b.name); }); break;
      case 'price-asc': items.sort(function (a, b) { return price(a) - price(b); }); break;
      case 'price-desc': items.sort(function (a, b) { return price(b) - price(a); }); break;
      case 'discount': items.sort(function (a, b) { return (b.prices.discountPercent || 0) - (a.prices.discountPercent || 0); }); break;
      case 'recent': items.sort(function (a, b) { return (b.verifiedDay || 0) - (a.verifiedDay || 0); }); break;
      default: break; // relevance — keep search order
    }
    return items;
  }
  function price(it) {
    var p = it.prices;
    var v = p.offerSales != null ? p.offerSales : p.regularSales != null ? p.regularSales : p.offerBase != null ? p.offerBase : p.regularBase;
    return v == null ? Number.MAX_SAFE_INTEGER : v;
  }

  function renderSearch(ctx) {
    var st = stateFrom(ctx.query);
    var root = ctx.root;
    root.innerHTML =
      '<div class="container">'
      + '<div class="row wrap" style="margin-top:24px;gap:12px">'
      + '<div class="searchbar" style="flex:1;min-width:240px;max-width:560px"><span class="lead">' + ICON('search', 16) + '</span>'
      + '<input class="input" id="page-search" type="search" value="' + UI.esc(st.q) + '" placeholder="Search medicines, generics, companies" aria-label="Search medicines"></div>'
      + '<button class="btn small mobile-filter-btn" id="open-filters">' + ICON('sliders', 14) + 'Filters</button>'
      + '</div>'
      + '<div class="search-layout">'
      + '<aside class="filters" id="filters" aria-label="Filters"></aside>'
      + '<div id="results" aria-live="polite">'
      + '<div class="result-head"><div class="count" id="count"></div>'
      + '<label style="font-size:12px;color:var(--fg-3)">Sort&nbsp;'
      + '<select class="select" id="sort" style="min-height:32px;width:auto;font-size:12px;padding:4px 26px 4px 8px">'
      + sortOptions(st.sort)
      + '</select></label></div>'
      + '<div class="active-filters" id="active-filters"></div>'
      + '<div id="list">' + UI.skeletonCards(8) + '</div>'
      + '</div>'
      + '</div></div>';

    var input = root.querySelector('#page-search');
    UI.combobox(input, {
      onSubmit: function (q) { st.q = q; st.page = 1; setNative(st); },
      onPick: function (id) { var slug = DB.slugOf(id); MDB_ROUTER.nav('#/m/' + (slug || id)); },
    });
    var debounce = null;
    input.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        st.q = input.value.trim(); st.page = 1; setNative(st);
      }, 250);
    });
    root.querySelector('#sort').addEventListener('change', function (e) {
      st.sort = e.target.value; st.page = 1; setNative(st);
    });
    root.querySelector('#open-filters').addEventListener('click', function () {
      var sh = UI.sheet('<h3 style="font-size:15px;margin-bottom:14px">Filters</h3><div id="sheet-filters"></div>', { label: 'Filters' });
      var holder = sh.querySelector('#sheet-filters');
      var rebuild = function (patch) {
        if (patch) Object.assign(st, patch, { page: 1 });
        setNative(st);
        buildFilters(holder, st, rebuild);
      };
      buildFilters(holder, st, rebuild);
    });

    buildFilters(root.querySelector('#filters'), st, function (patch) {
      Object.assign(st, patch, { page: 1 });
      setNative(st);
    });

    runSearch(root, st);
  }

  function setNative(st) { /* update URL without re-creating the whole view */ 
    history.replaceState(null, '', stateToHash(st));
    runSearch(document.getElementById('main'), st);
    updateActiveFilters(st);
  }

  function sortOptions(cur) {
    var opts = [
      ['relevance', 'Relevance'],
      ['name', 'Name A–Z'],
      ['price-asc', 'Price: low to high'],
      ['price-desc', 'Price: high to low'],
      ['discount', 'Highest discount'],
      ['recent', 'Recently updated'],
    ];
    return opts.map(function (o) { return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
  }

  function buildFilters(holder, st, onChange) {
    var D = DB.dicts();
    var formOpts = D.forms.slice().sort(function (a, b) { return (b.productCount || 0) - (a.productCount || 0); }).slice(0, 24).map(function (f) {
      return '<button class="opt' + (st.form === f.name ? ' on' : '') + '" data-kind="form" data-v="' + UI.esc(f.name) + '"><span class="n">' + UI.esc(f.name) + '</span><span class="c">' + UI.num(f.productCount) + '</span></button>';
    }).join('');
    var typeOpts = D.types.slice().sort(function (a, b) { return (b.productCount || 0) - (a.productCount || 0); }).map(function (t) {
      return '<button class="opt' + (st.type === t.name ? ' on' : '') + '" data-kind="type" data-v="' + UI.esc(t.name) + '"><span class="n">' + UI.esc(t.name) + '</span><span class="c">' + UI.num(t.productCount) + '</span></button>';
    }).join('');
    var catOpts = D.categories.filter(function (c) { return c.name && c.productCount > 0; }).sort(function (a, b) { return (b.productCount || 0) - (a.productCount || 0); }).slice(0, 40).map(function (c) {
      return '<button class="opt' + (st.category === c.id ? ' on' : '') + '" data-kind="category" data-v="' + c.id + '"><span class="n">' + UI.esc(c.name) + '</span><span class="c">' + UI.num(c.productCount) + '</span></button>';
    }).join('');
    var compOpts = D.companies.slice().sort(function (a, b) { return (b.productCount || 0) - (a.productCount || 0); }).slice(0, 40).map(function (c) {
      return '<button class="opt' + (st.company === c.id ? ' on' : '') + '" data-kind="company" data-v="' + c.id + '"><span class="n">' + UI.esc(c.name) + '</span><span class="c">' + UI.num(c.productCount) + '</span></button>';
    }).join('');
    holder.innerHTML =
      '<div class="group"><h4>Availability</h4><div class="opts">'
      + '<button class="opt' + (st.offer ? ' on' : '') + '" data-kind="offer" data-v="1"><span class="n">On offer only</span></button>'
      + '<button class="opt' + (st.rx ? ' on' : '') + '" data-kind="rx" data-v="1"><span class="n">Prescription required</span></button>'
      + '</div></div>'
      + '<div class="group"><h4>Price range (৳)</h4><div class="range">'
      + '<input class="input" id="f-min" type="number" min="0" placeholder="Min" value="' + (st.min != null ? st.min : '') + '" aria-label="Minimum price">'
      + '<span class="faint">–</span>'
      + '<input class="input" id="f-max" type="number" min="0" placeholder="Max" value="' + (st.max != null ? st.max : '') + '" aria-label="Maximum price">'
      + '</div></div>'
      + '<div class="group"><h4>Dosage form</h4><div class="opts">' + formOpts + '</div></div>'
      + '<div class="group"><h4>Type</h4><div class="opts">' + typeOpts + '</div></div>'
      + '<div class="group"><h4>Category</h4><div class="opts">' + catOpts + '</div></div>'
      + '<div class="group"><h4>Company</h4><div class="opts">' + compOpts + '</div></div>';

    holder.querySelectorAll('.opt').forEach(function (b) {
      b.addEventListener('click', function () {
        var kind = b.dataset.kind, v = b.dataset.v;
        var patch = {};
        if (kind === 'offer') patch.offer = !st.offer;
        else if (kind === 'rx') patch.rx = !st.rx;
        else if (kind === 'form') patch.form = st.form === v ? null : v;
        else if (kind === 'type') patch.type = st.type === v ? null : v;
        else if (kind === 'category') patch.category = st.category === Number(v) ? null : Number(v);
        else if (kind === 'company') patch.company = st.company === Number(v) ? null : Number(v);
        onChange(patch);
      });
    });
    ['f-min', 'f-max'].forEach(function (id) {
      var inp = holder.querySelector('#' + id);
      if (!inp) return;
      inp.addEventListener('change', function () {
        onChange({
          min: holder.querySelector('#f-min').value ? Number(holder.querySelector('#f-min').value) : null,
          max: holder.querySelector('#f-max').value ? Number(holder.querySelector('#f-max').value) : null,
        });
      });
    });
  }

  function updateActiveFilters(st) {
    var holder = document.getElementById('active-filters');
    if (!holder) return;
    var chips = [];
    function chip(label, clear) {
      chips.push('<span class="chip on">' + UI.esc(label) + '<button class="btn icon" style="width:18px;min-height:18px;margin-left:2px" data-clear="' + clear + '" aria-label="Clear filter">' + ICON('x', 12) + '</button></span>');
    }
    if (st.company) { var c = DB.dicts().companies.find(function (x) { return x.id === st.company; }); chip(c ? c.name : 'company ' + st.company, 'company'); }
    if (st.category) { var ct = DB.dicts().categories.find(function (x) { return x.id === st.category; }); chip(ct && ct.name ? ct.name : 'category ' + st.category, 'category'); }
    if (st.generic) chip('generic ' + st.generic, 'generic');
    if (st.form) chip(st.form, 'form');
    if (st.type) chip(st.type, 'type');
    if (st.rx) chip('Prescription required', 'rx');
    if (st.offer) chip('On offer', 'offer');
    if (st.min != null || st.max != null) chip('৳' + (st.min != null ? st.min : '0') + ' – ' + (st.max != null ? st.max : '∞'), 'price');
    holder.innerHTML = chips.join('');
    holder.querySelectorAll('[data-clear]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.clear;
        if (k === 'price') { st.min = null; st.max = null; }
        else st[k] = null;
        st.page = 1;
        setNative(st);
      });
    });
  }

  var lastRunId = 0;
  function runSearch(root, st) {
    var runId = ++lastRunId;
    var listEl = root.querySelector('#list');
    var countEl = root.querySelector('#count');
    if (!listEl) return;
    listEl.innerHTML = UI.skeletonCards(8);

    var filters = {
      company: st.company, category: st.category, generic: st.generic,
      form: st.form, type: st.type, rx: st.rx, offer: st.offer,
    };
    var q = st.q;
    // Support "g:<generic>" typed queries from card links
    if (q && q.startsWith('g:')) { filters.genericName = q.slice(2); q = q.slice(2); }

    MDB_SEARCH.query(q, filters).then(function (res) {
      if (runId !== lastRunId) return;
      return DB.rowsFor(res.ids.map(function (x) { return x.id; })).then(function (rows) {
        if (runId !== lastRunId) return;
        var items = res.ids
          .map(function (x) { var r = rows.get(x.id); return r ? DB.expand(r) : null; })
          .filter(Boolean);
        // generic-name filter (when used via g: links) + price range
        if (filters.genericName) {
          var g = filters.genericName.toLowerCase();
          items = items.filter(function (it) { return it.generic && it.generic.toLowerCase() === g; });
        }
        if (st.min != null || st.max != null) {
          items = items.filter(function (it) {
            var v = price(it);
            if (v === Number.MAX_SAFE_INTEGER) return false;
            if (st.min != null && v < st.min) return false;
            if (st.max != null && v > st.max) return false;
            return true;
          });
        }
        if (st.sort !== 'relevance') sortItems(items, st.sort);
        else if (res.mode === 'or') items.sort(function (a, b) { return b.ordered - a.ordered; });

        var totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
        var page = Math.min(st.page, totalPages);
        var slice = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

        countEl.innerHTML = items.length
          ? '<b>' + UI.num(items.length) + '</b> medicine' + (items.length === 1 ? '' : 's') + (q ? ' for “' + UI.esc(q) + '”' : '')
          + (res.mode === 'or' ? ' <span class="badge">loose match</span>' : '')
          : '';

        listEl.innerHTML = '';
        if (!items.length) {
          var hints = ['Napa', 'Seclo', 'Ace'];
          var es = UI.emptyState(
            'No matches' + (q ? ' for “' + q + '”' : ' with these filters'),
            q ? 'Check the spelling, or try a shorter search — brand name, generic name or company.'
              : 'Loosen the filters, or clear them to browse the full catalogue.',
            hints
          );
          UI.wireEmptyHints(es, function (t) {
            var input = document.getElementById('page-search');
            if (input) { input.value = t; }
            st.q = t; st.page = 1; st.form = null; st.type = null; st.company = null; st.category = null;
            setNative(st);
          });
          listEl.appendChild(es);
          if (res.didYouMean && res.didYouMean.length) {
            var note = UI.el('<p class="kv-note" style="margin-top:10px">Searched with typo tolerance for: ' + UI.esc(res.didYouMean.join(', ')) + '</p>');
            listEl.appendChild(note);
          }
          return;
        }

        var grid = UI.el('<div class="med-grid"></div>');
        slice.forEach(function (it) { grid.appendChild(UI.medCard(it)); });
        UI.wireCards(grid);
        listEl.appendChild(grid);
        listEl.appendChild(UI.pager(page, totalPages, function (p) {
          st.page = p;
          history.replaceState(null, '', stateToHash(st));
          runSearch(document.getElementById('main'), st);
          document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
        updateActiveFilters(st);
      });
    }).catch(function (e) {
      listEl.innerHTML = '<div class="notice warn">' + UI.esc(e.message) + '</div>';
    });
  }

  MDB_ROUTER.add('/search', renderSearch);
})();

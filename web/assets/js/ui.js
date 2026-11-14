/* MedPrice BD — UI helpers & shared components. Vanilla DOM, no framework. */
window.MDB_UI = (function () {
  var ICON = window.MDB_ICONS.icon;

  /* ---------- tiny DOM helpers ---------- */
  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- formatting ---------- */
  function bdt(v) {
    if (v == null || isNaN(Number(v))) return '—';
    var n = Number(v);
    var s = Math.abs(n % 1) < 0.005 ? String(Math.round(n)) : n.toFixed(2);
    return '৳' + s;
  }
  function dateFromDay(day) {
    if (!day) return null;
    var s = String(day);
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  }
  function fmtDate(day) {
    var d = dateFromDay(day);
    if (!d) return 'unverified';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[Number(d.slice(5, 7)) - 1] + ' ' + Number(d.slice(8, 10)) + ' ' + d.slice(0, 4);
  }
  function num(n) {
    if (n == null || isNaN(Number(n))) return '—';
    return Number(n).toLocaleString('en-US');
  }

  /* ---------- verification stamp (product signature) ---------- */
  function stamp(item) {
    var cls = 'stamp';
    if (item.status === 'NEEDS_RECHECK' || item.status === 'FAILED') cls += ' bad';
    else if (item.status !== 'VERIFIED') cls += ' warn';
    var label = { VERIFIED: 'verified', PARTIALLY_VERIFIED: 'partial', NEEDS_RECHECK: 'recheck', FAILED: 'failed' }[item.status] || 'partial';
    return '<span class="' + cls + '" title="Validation: ' + esc(item.status) + '"><span class="dot"></span>' + fmtDate(item.verifiedDay) + ' · ' + label + '</span>';
  }

  /* ---------- medicine card ---------- */
  function medCard(item, opts) {
    opts = opts || {};
    var p = item.prices;
    var favOn = MDB_STORE.fav(item.id);
    var cmpOn = MDB_STORE.inCompare(item.id);
    var priceHtml;
    if (p.hasOffer) {
      priceHtml = '<span class="price-xl">' + bdt(p.offerSales != null ? p.offerSales : p.offerBase) + '</span>'
        + '<span class="unit">/ ' + esc(p.unitS || 'pack') + '</span>'
        + '<span class="price-reg">' + bdt(p.regularSales != null ? p.regularSales : p.regularBase) + '</span>'
        + (p.discountPercent != null ? '<span class="badge offer">−' + esc(p.discountPercent) + '%</span>' : '');
    } else {
      priceHtml = '<span class="price-xl">' + bdt(p.regularSales != null ? p.regularSales : p.regularBase) + '</span>'
        + '<span class="unit">/ ' + esc(p.unitS || 'pack') + '</span>';
    }
    var img = item.imgUrl
      ? '<img loading="lazy" src="' + esc(item.imgUrl) + '" alt="' + esc(item.name) + '" width="88" height="88" onerror="this.remove()">'
      : ICON('pill', 28);
    return el(
      '<article class="med-card" data-id="' + item.id + '">'
      + '<div class="actions">'
      + '<button class="btn icon fav' + (favOn ? ' on' : '') + '" data-act="fav" aria-label="' + (favOn ? 'Remove from' : 'Add to') + ' favourites" aria-pressed="' + favOn + '">' + ICON('heart', 16) + '</button>'
      + '<button class="btn icon cmp' + (cmpOn ? ' on' : '') + '" data-act="cmp" aria-label="' + (cmpOn ? 'Remove from' : 'Add to') + ' compare" aria-pressed="' + cmpOn + '">' + ICON('scale', 16) + '</button>'
      + '</div>'
      + '<div class="thumb">' + img + '</div>'
      + '<div class="name"><a href="' + item.appUrl + '">' + esc(item.name) + '</a></div>'
      + (item.nameBn ? '<div class="t-meta">' + esc(item.nameBn) + '</div>' : '')
      + '<div class="meta">'
      + (item.generic ? '<a href="#/search?q=' + encodeURIComponent('g:' + item.generic) + '" data-generic="' + esc(item.generic) + '">' + esc(item.generic) + '</a>' : '')
      + (item.company ? '<a href="#/companies/' + esc(item.companyId) + '">' + esc(item.company) + '</a>' : '')
      + '</div>'
      + '<div class="meta">' + [item.strength, item.form].filter(Boolean).map(esc).join(' · ') + '</div>'
      + '<div class="prices">' + priceHtml + '</div>'
      + '<div>' + stamp(item) + '</div>'
      + '</article>'
    );
  }

  /* Wire card actions (fav/compare) inside a container. */
  function wireCards(container) {
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var card = btn.closest('.med-card');
      var id = Number(card.dataset.id);
      var nameEl = card.querySelector('.name');
      var name = nameEl ? nameEl.textContent : '';
      if (btn.dataset.act === 'fav') {
        var on = MDB_STORE.toggleFav(id, name);
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', on);
        toast(on ? 'Saved to favourites' : 'Removed from favourites');
      } else if (btn.dataset.act === 'cmp') {
        var res = MDB_STORE.toggleCompare(id, name);
        if (res === 'full') { toast('Compare holds 4 medicines'); return; }
        var on2 = res === true;
        btn.classList.toggle('on', on2);
        btn.setAttribute('aria-pressed', on2);
        document.dispatchEvent(new CustomEvent('mdb:compare'));
        toast(on2 ? 'Added to compare' : 'Removed from compare');
      }
    });
  }

  /* ---------- search combobox ---------- */
  function combobox(inputEl, opts) {
    opts = opts || {};
    var box = el('<div class="suggest" role="listbox" aria-label="Search suggestions"></div>');
    inputEl.setAttribute('autocomplete', 'off');
    inputEl.setAttribute('aria-expanded', 'false');
    inputEl.insertAdjacentElement('afterend', box);
    var items = [], active = -1, timer = null, lastQ = '';

    function close() {
      box.classList.remove('open');
      inputEl.setAttribute('aria-expanded', 'false');
      active = -1;
    }
    function render(res) {
      items = [];
      var html = '';
      res.products.forEach(function (hit) { items.push({ type: 'p', id: hit.id }); });
      res.terms.forEach(function (t) { items.push({ type: 't', term: t }); });
      items.forEach(function (it, i) {
        if (it.type === 't') {
          html += '<button class="item" role="option" data-i="' + i + '"><span class="lead" style="display:flex;color:var(--fg-3)">' + ICON('search', 14) + '</span><span class="name">' + esc(it.term) + '</span><span class="kind">search</span></button>';
        } else {
          html += '<button class="item" role="option" data-i="' + i + '"><span class="lead" style="display:flex;color:var(--fg-3)">' + ICON('pill', 14) + '</span><span class="name">' + esc(it.name || '') + '</span><span class="kind">medicine</span></button>';
        }
      });
      if (!items.length) { close(); return; }
      box.innerHTML = html;
      box.classList.add('open');
      inputEl.setAttribute('aria-expanded', 'true');
      active = -1;
    }
    function run() {
      var q = inputEl.value.trim();
      if (q === lastQ) return;
      lastQ = q;
      if (q.length < 2) { close(); return; }
      MDB_SEARCH.suggestions(q, 6).then(function (res) {
        var names = MDB_DB.ready.then(function () {
          return MDB_DB.rowsFor(res.products.map(function (p) { return p.id; }));
        }).then(function (rows) {
          return res.products.map(function (p) {
            var row = rows.get(p.id);
            var item = row ? MDB_DB.expand(row) : null;
            return { id: p.id, name: item ? item.name : '#' + p.id, item: item };
          }).filter(function (x) { return x.item; });
        });
        names.then(function (list) { render({ products: list, terms: res.terms }); }).catch(function () { close(); });
      });
    }
    function pick(i) {
      var it = items[i];
      if (!it) return;
      if (it.type === 't') { inputEl.value = it.term; opts.onSubmit(it.term); close(); return; }
      opts.onPick && opts.onPick(it.id, it.name);
      close();
    }
    inputEl.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(run, 120);
    });
    inputEl.addEventListener('focus', run);
    inputEl.addEventListener('keydown', function (e) {
      if (!box.classList.contains('open')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = e.key === 'ArrowDown' ? Math.min(active + 1, items.length - 1) : Math.max(active - 1, 0);
        box.querySelectorAll('.item').forEach(function (n, i) {
          n.classList.toggle('active', i === active);
          n.setAttribute('aria-selected', i === active ? 'true' : 'false');
        });
      } else if (e.key === 'Enter') {
        if (active >= 0) { e.preventDefault(); pick(active); }
        else { opts.onSubmit(inputEl.value.trim()); close(); }
      } else if (e.key === 'Escape') { close(); }
    });
    box.addEventListener('mousedown', function (e) {
      var b = e.target.closest('.item');
      if (b) { e.preventDefault(); pick(Number(b.dataset.i)); }
    });
    document.addEventListener('click', function (e) {
      if (!box.contains(e.target) && e.target !== inputEl) close();
    });
    return { close: close };
  }

  /* ---------- sheet / dialog ---------- */
  var openOverlay = null;
  function sheet(innerHtml, opts) {
    opts = opts || {};
    closeSheet();
    var ov = el('<div class="overlay"></div>');
    var sh = el('<div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(opts.label || 'Dialog') + '"><div class="grabber"></div></div>');
    sh.insertAdjacentHTML('beforeend', innerHtml);
    document.getElementById('overlays').appendChild(ov);
    document.getElementById('overlays').appendChild(sh);
    requestAnimationFrame(function () { ov.classList.add('open'); sh.classList.add('open'); });
    function onKey(e) { if (e.key === 'Escape') closeSheet(); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', closeSheet);
    var focusables = sh.querySelectorAll('button, [href], input, select');
    if (focusables.length) focusables[0].focus();
    openOverlay = { ov: ov, sh: sh, onKey: onKey };
    return sh;
  }
  function closeSheet() {
    if (!openOverlay) return;
    var o = openOverlay; openOverlay = null;
    document.removeEventListener('keydown', o.onKey);
    o.ov.classList.remove('open');
    o.sh.classList.remove('open');
    setTimeout(function () { o.ov.remove(); o.sh.remove(); }, 240);
  }

  /* ---------- toast ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = document.querySelector('.toast');
    if (!t) { t = el('<div class="toast" role="status" aria-live="polite"></div>'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  /* ---------- skeleton ---------- */
  function skeletonCards(n) {
    var out = '';
    for (var i = 0; i < (n || 8); i++) {
      out += '<div class="med-card" aria-hidden="true">'
        + '<div class="skel" style="width:88px;height:88px"></div>'
        + '<div class="skel" style="height:14px;width:70%"></div>'
        + '<div class="skel" style="height:12px;width:45%"></div>'
        + '<div class="skel" style="height:20px;width:55%"></div>'
        + '</div>';
    }
    return '<div class="med-grid">' + out + '</div>';
  }

  /* ---------- pagination ---------- */
  function pager(page, totalPages, onGo) {
    if (totalPages <= 1) return el('<div></div>');
    var w = el('<nav class="pager" aria-label="Pagination"></nav>');
    function btn(label, target, disabled, aria) {
      var b = el('<button class="btn small' + (disabled ? '' : '') + '" ' + (disabled ? 'disabled' : '') + ' aria-label="' + esc(aria || label) + '">' + label + '</button>');
      if (!disabled) b.addEventListener('click', function () { onGo(target); });
      return b;
    }
    w.appendChild(btn('Previous', page - 1, page <= 1, 'Previous page'));
    var span = el('<span class="cur">Page ' + page + ' of ' + totalPages + '</span>');
    w.appendChild(span);
    w.appendChild(btn('Next', page + 1, page >= totalPages, 'Next page'));
    return w;
  }

  /* ---------- empty state ---------- */
  function emptyState(title, body, hints) {
    var h = (hints || []).map(function (t) { return '<button class="chip">' + esc(t) + '</button>'; }).join('');
    return el(
      '<div class="empty"><h3>' + esc(title) + '</h3><p>' + esc(body || '') + '</p>'
      + (h ? '<div class="hints">' + h + '</div>' : '') + '</div>'
    );
  }
  function wireEmptyHints(node, onHint) {
    node.querySelectorAll('.hints .chip').forEach(function (c) {
      c.addEventListener('click', function () { onHint(c.textContent); });
    });
  }

  /* ---------- price history chart (SVG) ---------- */
  function historyChart(points, opts) {
    // points: [{at, rb, rs, ob, os}] chronological
    var W = 640, H = 220, padL = 46, padR = 12, padT = 14, padB = 28;
    var iw = W - padL - padR, ih = H - padT - padB;
    var series = points.map(function (pt, i) {
      return {
        x: padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw),
        rs: pt.rs != null ? pt.rs : null,
        os: pt.os != null ? pt.os : null,
        at: pt.at,
      };
    });
    var vals = [];
    series.forEach(function (s) { if (s.rs != null) vals.push(s.rs); if (s.os != null) vals.push(s.os); });
    if (!vals.length) return null;
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = (max - min) || max * 0.1 || 1;
    min = Math.max(0, min - span * 0.15); max = max + span * 0.15;
    function y(v) { return padT + ih - ((v - min) / (max - min)) * ih; }
    var g = '';
    // grid: 4 hairlines + labels
    for (var i = 0; i <= 3; i++) {
      var v = min + (max - min) * (i / 3);
      var yy = y(v);
      g += '<line class="gridline" x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '"/>';
      g += '<text class="axis-label" x="' + (padL - 8) + '" y="' + (yy + 3) + '" text-anchor="end">' + bdt(v) + '</text>';
    }
    function path(key) {
      var d = '', started = false;
      series.forEach(function (s) {
        if (s[key] == null) return;
        d += (started ? ' L' : 'M') + s.x.toFixed(1) + ' ' + y(s[key]).toFixed(1);
        started = true;
      });
      return started ? d : null;
    }
    var reg = path('rs'), off = path('os');
    if (reg) g += '<path class="line-reg" d="' + reg + '"/>';
    if (off) g += '<path class="line-off" d="' + off + '"/>';
    // dots
    series.forEach(function (s) {
      if (s.os != null) g += '<circle class="dot-off" cx="' + s.x + '" cy="' + y(s.os) + '" r="3"/>';
      if (s.rs != null) g += '<circle class="dot-reg" cx="' + s.x + '" cy="' + y(s.rs) + '" r="2.5"/>';
    });
    // x labels: first + last
    if (series.length > 1) {
      g += '<text class="axis-label" x="' + series[0].x + '" y="' + (H - 8) + '" text-anchor="start">' + esc(String(series[0].at).slice(0, 10)) + '</text>';
      g += '<text class="axis-label" x="' + series[series.length - 1].x + '" y="' + (H - 8) + '" text-anchor="end">' + esc(String(series[series.length - 1].at).slice(0, 10)) + '</text>';
    } else {
      g += '<text class="axis-label" x="' + series[0].x + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(String(series[0].at).slice(0, 10)) + '</text>';
    }
    var wrap = el('<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Price history chart">' + g + '</svg><div class="tip hidden"></div></div>');
    // tooltip: nearest point on pointer move (pointer-fine only)
    var svg = wrap.querySelector('svg'), tip = wrap.querySelector('.tip');
    wrap.addEventListener('pointermove', function (e) {
      var rect = svg.getBoundingClientRect();
      var px = (e.clientX - rect.left) / rect.width * W;
      var best = null, bestD = 1e9;
      series.forEach(function (s) { var d = Math.abs(s.x - px); if (d < bestD) { bestD = d; best = s; } });
      if (!best) return;
      tip.classList.remove('hidden');
      tip.style.left = (best.x / W * rect.width) + 'px';
      tip.style.top = (y(best.os != null ? best.os : best.rs) / H * rect.height) + 'px';
      tip.innerHTML = '<div class="d">' + esc(String(best.at).slice(0, 10)) + '</div>'
        + (best.os != null ? '<div>Offer ' + bdt(best.os) + '</div>' : '')
        + (best.rs != null ? '<div>Regular ' + bdt(best.rs) + '</div>' : '');
    });
    wrap.addEventListener('pointerleave', function () { tip.classList.add('hidden'); });
    return wrap;
  }

  return {
    el: el, esc: esc, bdt: bdt, num: num, fmtDate: fmtDate, dateFromDay: dateFromDay,
    stamp: stamp, medCard: medCard, wireCards: wireCards,
    combobox: combobox, sheet: sheet, closeSheet: closeSheet,
    toast: toast, skeletonCards: skeletonCards, pager: pager,
    emptyState: emptyState, wireEmptyHints: wireEmptyHints,
    historyChart: historyChart,
  };
})();

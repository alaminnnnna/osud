/* MedPrice BD — compare view: side-by-side price table for up to 4 medicines. */
(function () {
  var ICON = window.MDB_ICONS.icon;
  var UI = window.MDB_UI;
  var DB = window.MDB_DB;

  function renderCompare(ctx) {
    var root = ctx.root;
    var items = MDB_STORE.compare();
    ctx.setMeta('Compare medicine prices — MedPrice BD', 'Compare regular price, offer price, pack size and base-unit price for up to four medicines side by side.', '/compare', null);

    root.innerHTML = '<div class="container" style="margin-top:32px">'
      + '<div class="spread"><h1 style="font-size:24px">Compare prices</h1>'
      + (items.length ? '<button class="btn small quiet" id="cmp-clear">Clear all</button>' : '')
      + '</div>'
      + '<p class="muted" style="margin:6px 0 20px">Prices are per sales unit as listed in the catalogue. Base-unit rows let you compare across different pack sizes.</p>'
      + '<div id="cmp-body"></div></div>';

    var body = root.querySelector('#cmp-body');
    var clearBtn = root.querySelector('#cmp-clear');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      MDB_STORE.clearCompare();
      document.dispatchEvent(new CustomEvent('mdb:compare'));
      renderCompare(ctx);
    });

    if (items.length < 1) {
      body.appendChild(UI.emptyState('Nothing to compare yet', 'Add medicines from any card — the scale icon — then come back here.', ['Napa', 'Seclo']));
      UI.wireEmptyHints(body, function (t) { MDB_ROUTER.nav('#/search?q=' + encodeURIComponent(t)); });
      return;
    }

    body.innerHTML = UI.skeletonCards(4);
    DB.rowsFor(items.map(function (c) { return c.id; })).then(function (rows) {
      var meds = items.map(function (c) { return rows.get(c.id) && DB.expand(rows.get(c.id)); }).filter(Boolean);
      if (!meds.length) { body.innerHTML = '<div class="notice warn">Saved medicines are no longer in the dataset.</div>'; return; }

      var rowsHtml = '';
      function row(label, fn, numClass) {
        rowsHtml += '<tr><th scope="row">' + label + '</th>' + meds.map(function (m) { return '<td class="' + (numClass ? 'num' : '') + '">' + fn(m) + '</td>'; }).join('') + '</tr>';
      }
      row('', function (m) {
        return '<div class="row" style="gap:10px"><span class="thumb" style="width:48px;height:48px;border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden">'
          + (m.imgUrl ? '<img src="' + UI.esc(m.imgUrl) + '" width="48" height="48" alt="" loading="lazy">' : ICON('pill', 20))
          + '</span><a href="' + m.appUrl + '" style="font-weight:500">' + UI.esc(m.name) + '</a></div>';
      });
      row('Company', function (m) { return UI.esc(m.company || '—'); });
      row('Generic', function (m) { return UI.esc(m.generic || '—'); });
      row('Strength · form', function (m) { return UI.esc([m.strength, m.form].filter(Boolean).join(' · ') || '—'); });
      row('Pack', function (m) {
        var p = m.prices;
        return UI.esc([p.multS && p.multS > 1 ? p.multS + ' × ' + (p.unitB || 'unit') : null, p.unitS].filter(Boolean).join(' — ') || '—');
      });
      row('Regular price', function (m) { return UI.bdt(m.prices.regularSales != null ? m.prices.regularSales : m.prices.regularBase); }, true);
      row('Offer price', function (m) {
        var p = m.prices;
        return p.hasOffer ? '<span style="color:var(--accent)">' + UI.bdt(p.offerSales != null ? p.offerSales : p.offerBase) + '</span>' : '—';
      }, true);
      row('Discount', function (m) { return m.prices.hasOffer && m.prices.discountPercent != null ? '−' + UI.esc(m.prices.discountPercent) + '%' : '—'; }, true);
      row('Base-unit price', function (m) {
        var p = m.prices;
        return '<span class="mono">' + UI.bdt(p.regularBase) + '</span>' + (p.hasOffer && p.offerBase != null ? ' / <span style="color:var(--accent)">' + UI.bdt(p.offerBase) + '</span>' : '');
      }, true);
      row('Verified', function (m) { return UI.fmtDate(m.verifiedDay); }, true);
      row('', function (m) { return '<button class="btn small cmp-remove" data-rm="' + m.id + '">' + ICON('x', 12) + ' Remove</button>'; });

      body.innerHTML =
        '<div class="tbl-wrap"><table class="tbl"><tbody>' + rowsHtml + '</tbody></table></div>'
        + '<p class="kv-note" style="margin-top:12px">Tip: base-unit price is the fairest comparison when pack sizes differ.</p>';

      body.querySelectorAll('[data-rm]').forEach(function (b) {
        b.addEventListener('click', function () {
          MDB_STORE.toggleCompare(Number(b.dataset.rm));
          document.dispatchEvent(new CustomEvent('mdb:compare'));
          renderCompare(ctx);
        });
      });
    });
  }

  MDB_ROUTER.add('/compare', renderCompare);
})();

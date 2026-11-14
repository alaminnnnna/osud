/* MedPrice BD — hash router with query params, per-route meta + JSON-LD. */
window.MDB_ROUTER = (function () {
  var routes = [];
  var viewsEl = null;

  function parseHash() {
    var h = location.hash.replace(/^#/, '') || '/';
    var qIdx = h.indexOf('?');
    var path = qIdx >= 0 ? h.slice(0, qIdx) : h;
    var query = {};
    if (qIdx >= 0) {
      new URLSearchParams(h.slice(qIdx + 1)).forEach(function (v, k) { query[k] = v; });
    }
    var parts = path.split('/').filter(Boolean);
    return { path: path, parts: parts, query: query };
  }

  function add(pattern, handler) {
    // pattern like '/m/:slug' or '/search'
    routes.push({ parts: pattern.split('/').filter(Boolean), handler: handler });
  }

  function match(parts) {
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      if (r.parts.length !== parts.length) continue;
      var params = {}, ok = true;
      for (var j = 0; j < r.parts.length; j++) {
        if (r.parts[j].startsWith(':')) params[r.parts[j].slice(1)] = decodeURIComponent(parts[j]);
        else if (r.parts[j] !== parts[j]) { ok = false; break; }
      }
      if (ok) return { handler: r.handler, params: params };
    }
    return null;
  }

  function setMeta(title, description, canonicalPath, jsonLd) {
    document.title = title;
    var set = function (sel, attr, val) {
      var n = document.head.querySelector(sel);
      if (!n) { n = document.createElement('meta'); n.setAttribute(attr, sel.includes('property=') ? sel.match(/property="([^"]+)"/)[1] : sel.match(/name="([^"]+)"/)[1]); document.head.appendChild(n); }
      n.setAttribute('content', val);
    };
    set('meta[name="description"]', 'name', description);
    var ogT = document.head.querySelector('meta[property="og:title"]');
    if (!ogT) { ogT = document.createElement('meta'); ogT.setAttribute('property', 'og:title'); document.head.appendChild(ogT); }
    ogT.setAttribute('content', title);
    var ogD = document.head.querySelector('meta[property="og:description"]');
    if (!ogD) { ogD = document.createElement('meta'); ogD.setAttribute('property', 'og:description'); document.head.appendChild(ogD); }
    ogD.setAttribute('content', description);
    var oldLd = document.getElementById('route-jsonld');
    if (oldLd) oldLd.remove();
    if (jsonLd) {
      var s = document.createElement('script');
      s.type = 'application/ld+json';
      s.id = 'route-jsonld';
      s.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(s);
    }
  }

  function nav(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function render() {
    var loc = parseHash();
    var m = match(loc.parts);
    if (!viewsEl) viewsEl = document.getElementById('main');
    MDB_UI.closeSheet();
    window.scrollTo(0, 0);
    if (!m) {
      viewsEl.innerHTML = '';
      var nf = MDB_UI.emptyState('Page not found', 'The address does not match any page of this catalogue.');
      viewsEl.appendChild(nf);
      MDB_UI.wireEmptyHints(nf, function () { nav('#/'); });
      return;
    }
    try {
      m.handler({
        params: m.params,
        query: loc.query,
        path: loc.path,
        setMeta: setMeta,
        nav: nav,
        root: viewsEl,
      });
    } catch (e) {
      viewsEl.innerHTML = '';
      viewsEl.appendChild(MDB_UI.emptyState('Something went wrong', String(e.message || e)));
      console.error(e);
    }
  }

  function start() {
    window.addEventListener('hashchange', render);
    render();
  }

  return { add: add, start: start, nav: nav, current: parseHash };
})();

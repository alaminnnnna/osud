/* MedPrice BD — dataset loader over the auto-generated bundles in assets/js/db/.
   meta/dicts/slugs load with the shell; the postings index, price history and
   reports load on demand; product rows live in ~1000-product chunks fetched
   lazily and cached. */
window.MDB_DB = (function () {
  var loaded = {};
  var chunkPromises = {};
  var slugMap = null;
  var chunkIndex = null; // sorted [{from, to, i}]

  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  var base = 'assets/js/db/';
  var ready = Promise.all([
    loadScript(base + 'meta.js'),
    loadScript(base + 'dicts.js'),
    loadScript(base + 'slugs.js'),
  ]).then(function () {
    var meta = window.MDB_META;
    if (!meta) throw new Error('Dataset bundles missing — run `node scrape.js --rebuild-web`.');
    chunkIndex = meta.chunks.map(function (c) { return { from: c.from, to: c.to, i: c.i }; });
    slugMap = new Map();
    var ids = window.MDB_SLUGS.ids, slugs = window.MDB_SLUGS.slugs;
    for (var k = 0; k < ids.length; k++) slugMap.set(ids[k], slugs[k]);
    return meta;
  });

  function meta() { return window.MDB_META; }
  function dicts() { return window.MDB_DICTS; }

  function loadIndex() { return ready.then(function () { return loadScript(base + 'index.js'); }).then(function () { return window.MDB_INDEX; }); }
  function loadHistory() { return ready.then(function () { return loadScript(base + 'history.js'); }).then(function () { return window.MDB_HISTORY; }); }
  function loadReports() { return ready.then(function () { return loadScript('assets/js/reports.js'); }).then(function () { return window.MDB_REPORTS; }); }

  function chunkFor(id) {
    var lo = 0, hi = chunkIndex.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var c = chunkIndex[mid];
      if (id < c.from) hi = mid - 1;
      else if (id > c.to) lo = mid + 1;
      else return c;
    }
    return null;
  }

  function loadChunk(i) {
    if (window.MDB_CHUNKS && window.MDB_CHUNKS[i]) return Promise.resolve(window.MDB_CHUNKS[i]);
    if (chunkPromises[i]) return chunkPromises[i];
    var file = 'chunk-' + String(i).padStart(3, '0') + '.js';
    chunkPromises[i] = loadScript(base + file).then(function () {
      if (!window.MDB_CHUNKS || !window.MDB_CHUNKS[i]) throw new Error('Chunk ' + i + ' did not register');
      return window.MDB_CHUNKS[i];
    });
    return chunkPromises[i];
  }

  /* Fetch raw rows for a set of product ids (dedupes chunk loads). */
  function rowsFor(ids) {
    return ready.then(function () {
      var byChunk = new Map();
      ids.forEach(function (id) {
        var c = chunkFor(id);
        if (!c) return;
        if (!byChunk.has(c.i)) byChunk.set(c.i, []);
        byChunk.get(c.i).push(id);
      });
      return Promise.all(Array.from(byChunk.keys()).map(loadChunk)).then(function () {
        var out = new Map();
        byChunk.forEach(function (idList, ci) {
          var rows = window.MDB_CHUNKS[ci];
          idList.forEach(function (id) {
            var lo = 0, hi = rows.length - 1, row = null;
            while (lo <= hi) {
              var mid = (lo + hi) >> 1;
              if (rows[mid][0] === id) { row = rows[mid]; break; }
              if (rows[mid][0] < id) lo = mid + 1; else hi = mid - 1;
            }
            if (row) out.set(id, row);
          });
        });
        return out;
      });
    });
  }

  /* ---- image URL rebuild ---- */
  function imageUrl(key, size) {
    if (!key) return null;
    if (/^https?:\/\//.test(key)) return key;
    // The CDN accepts fixed resize boxes only: 200, 216, 300, 1000.
    var s = [200, 216, 300, 1000].indexOf(size) >= 0 ? size : 300;
    try {
      var payload = JSON.stringify({ bucket: 'arogga', key: key, edits: { resize: { width: s, height: s, fit: 'outside' } } });
      return 'https://cdn2.arogga.com/' + btoa(payload);
    } catch (e) { return null; }
  }

  /* ---- row expansion ---- */
  var SCHEMA = window.MDB_META_SCM || ['id', 'name', 'nameBn', 'genIdx', 'compIdx', 'formIdx', 'typeIdx', 'catId', 'strength', 'rx', 'img', 'rb', 'ob', 'rs', 'os', 'disc', 'unitB', 'unitS', 'multS', 'vDay', 'status', 'cDay', 'ord'];
  var STATUS = ['VERIFIED', 'PARTIALLY_VERIFIED', 'NEEDS_RECHECK', 'FAILED'];

  function expand(row) {
    if (!row) return null;
    var D = window.MDB_DICTS;
    var company = D.companies[row[4]] || null;
    var generic = D.generics[row[3]] || null;
    var id = row[0];
    var slug = (slugMap && slugMap.get(id)) || String(id);
    var status = STATUS[row[20]] || 'PARTIALLY_VERIFIED';
    var ob = row[12], os = row[14];
    var hasOffer = (ob != null && row[11] != null && ob < row[11]) || (os != null && row[13] != null && os < row[13]);
    return {
      id: id,
      name: row[1] || ('Medicine #' + id),
      nameBn: row[2],
      genericId: generic ? generic.id : null,
      generic: generic ? generic.name : null,
      companyId: company ? company.id : null,
      company: company ? company.name : null,
      form: (D.forms[row[5]] || {}).name || null,
      type: (D.types[row[6]] || {}).name || null,
      categoryId: row[7],
      strength: row[8],
      rx: !!row[9],
      imgUrl: imageUrl(row[10], 240),
      prices: {
        regularBase: row[11], offerBase: ob, regularSales: row[13], offerSales: os,
        discountPercent: row[15], unitB: row[16], unitS: row[17], multS: row[18],
        hasOffer: !!hasOffer,
      },
      verifiedDay: row[19],
      status: status,
      createdDay: row[21],
      ordered: row[22] || 0,
      slug: slug,
      appUrl: '#/m/' + slug,
      sourceUrl: 'https://www.arogga.com/product/' + id + '/' + slug,
    };
  }

  function slugOf(id) { return (slugMap && slugMap.get(Number(id))) || null; }
  function idOfSlug(slug) {
    if (!slugMap) return null;
    for (var _ = 0; _ < 1; _++) { /* built lazily below */ }
    return null;
  }

  /* reverse slug lookup built on demand (only needed for /m/ routes) */
  var revSlug = null;
  function idBySlug(slug) {
    if (!revSlug) {
      revSlug = new Map();
      var ids = window.MDB_SLUGS.ids, slugs = window.MDB_SLUGS.slugs;
      for (var k = 0; k < slugs.length; k++) revSlug.set(slugs[k], ids[k]);
    }
    return revSlug.get(slug) || null;
  }

  return {
    ready: ready, meta: meta, dicts: dicts,
    loadIndex: loadIndex, loadHistory: loadHistory, loadReports: loadReports,
    rowsFor: rowsFor, expand: expand, imageUrl: imageUrl,
    slugOf: slugOf, idBySlug: idBySlug,
    chunkFor: function (id) { return chunkFor(Number(id)); },
  };
})();

/* Row schema carried from the generator (kept in sync with scrape.js). */
window.MDB_META_SCM = ['id', 'name', 'nameBn', 'genIdx', 'compIdx', 'formIdx', 'typeIdx', 'catId', 'strength', 'rx', 'img', 'rb', 'ob', 'rs', 'os', 'disc', 'unitB', 'unitS', 'multS', 'vDay', 'status', 'cDay', 'ord'];
if (window.MDB_CHUNKS === undefined) window.MDB_CHUNKS = [];

/* MedPrice BD — client-side search engine over the generated postings index.
   Supports exact/prefix/substring matching, Bengali tokens, typo tolerance
   (edit distance 1), facet intersection and relevance ranking. */
window.MDB_SEARCH = (function () {
  var indexPromise = null;
  function index() {
    if (!indexPromise) indexPromise = MDB_DB.loadIndex();
    return indexPromise;
  }

  function tokenize(q) {
    return String(q || '').toLowerCase()
      .split(/[^a-z0-9\u0980-\u09FF]+/)
      .filter(function (t) { return t.length >= 2 && t.length <= 40; });
  }

  function lowerBound(arr, prefix) {
    var lo = 0, hi = arr.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (arr[mid] < prefix) lo = mid + 1; else hi = mid; }
    return lo;
  }

  function editDistance1(a, b) {
    // true when Levenshtein(a, b) <= 1 (for similar-length strings)
    if (a === b) return false; // exact handled elsewhere
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0;
    while (i < la && i < lb && a[i] === b[i]) i++;
    if (i === la && i === lb) return false;
    if (la === lb) { // one substitution
      for (var k = i + 1; k < la; k++) if (a[k] !== b[k]) return false;
      return true;
    }
    var longer = la > lb ? a : b, shorter = la > lb ? b : a; // one insertion/deletion
    var j = i;
    while (j < shorter.length && longer[j + 1] === shorter[j]) j++;
    return j === shorter.length;
  }

  /* Match one query token against the vocabulary. Returns {tokens: [...], mode} */
  function matchToken(qt, tokens) {
    var out = [];
    var exact = tokens.has ? null : null;
    // exact
    if (binaryHas(tokens, qt)) { out.push({ t: qt, w: 3 }); }
    // prefix range (up to 40 entries)
    var lo = lowerBound(tokens.array, qt);
    for (var i = lo; i < tokens.array.length && tokens.array[i].startsWith(qt) && out.length < 48; i++) {
      if (tokens.array[i] !== qt) out.push({ t: tokens.array[i], w: 2 });
    }
    // substring (capped scan)
    if (out.length < 8 && qt.length >= 3) {
      for (var s = 0; s < tokens.array.length && out.length < 40; s++) {
        var tk = tokens.array[s];
        if (tk.indexOf(qt) > 0) out.push({ t: tk, w: 1.5 });
      }
    }
    // typo tolerance
    if (!out.length && qt.length >= 5) {
      for (var d = 0; d < tokens.array.length && out.length < 12; d++) {
        if (editDistance1(tokens.array[d], qt)) out.push({ t: tokens.array[d], w: 1 });
      }
    }
    return out;
  }

  function binaryHas(tokens, qt) { return tokens.set ? tokens.set.has(qt) : false; }

  function buildVocab(MDB_INDEX) {
    var array = [];
    for (var k in MDB_INDEX.p) if (Object.prototype.hasOwnProperty.call(MDB_INDEX.p, k)) array.push(k);
    array.sort();
    return { array: array, set: new Set(array) };
  }

  var vocab = null;
  function getVocab(MDB_INDEX) { return vocab || (vocab = buildVocab(MDB_INDEX)); }

  function postingsFor(MDB_INDEX, t) { return MDB_INDEX.p[t] || null; }
  function special(MDB_INDEX, key) { return (MDB_INDEX.s && MDB_INDEX.s[key]) || null; }

  /* Facet keys: {company, generic, category, form, type, rx, offer} */
  function facetIds(MDB_INDEX, f) {
    if (!f) return null;
    var keys = [];
    if (f.company != null) keys.push('@co:' + f.company);
    if (f.generic != null) keys.push('@gen:' + f.generic);
    if (f.category != null) keys.push('@cat:' + f.category);
    if (f.form) keys.push('@form:' + String(f.form).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
    if (f.type) keys.push('@type:' + f.type);
    if (f.rx) keys.push('@rx');
    if (f.offer) keys.push('@offer');
    if (!keys.length) return null;
    var acc = null;
    for (var i = 0; i < keys.length; i++) {
      var ids = special(MDB_INDEX, keys[i]);
      if (!ids) return [];
      if (!acc) acc = new Set(ids);
      else acc = new Set(ids.filter(function (id) { return acc.has(id); }));
      if (!acc.size) return [];
    }
    return acc;
  }

  /*
   * query(q, filters) -> Promise<{ids:[{id,score}], mode, suggestions}>
   */
  function query(q, filters, opts) {
    opts = opts || {};
    return index().then(function (MDB_INDEX) {
      var v = getVocab(MDB_INDEX);
      var qts = tokenize(q);
      var facetSet = facetIds(MDB_INDEX, filters);
      var suggestions = null;

      if (!qts.length) {
        var ids = facetSet ? Array.from(facetSet) : [];
        return { ids: ids.map(function (id) { return { id: id, score: 0 }; }), mode: 'browse', suggestions: null };
      }

      var sets = [];
      var didYouMean = [];
      for (var i = 0; i < qts.length; i++) {
        var matches = matchToken(qts[i], v);
        if (!matches.length) { didYouMean.push(qts[i]); sets.push(new Set()); continue; }
        if (didYouMean.length && matches[0].w >= 3) didYouMean.pop();
        var set = new Map(); // id -> best weight
        matches.forEach(function (m) {
          var ids = postingsFor(MDB_INDEX, m.t);
          if (!ids) return;
          var w = m.w * (m.t === qts[i] ? 1.2 : 1) / Math.log(10 + ids.length);
          for (var k = 0; k < ids.length; k++) {
            var id = ids[k];
            if (!set.has(id) || set.get(id) < w) set.set(id, w);
          }
        });
        sets.push(set);
      }

      // AND across tokens
      var acc = null;
      for (var s2 = 0; s2 < sets.length; s2++) {
        if (!acc) { acc = sets[s2]; continue; }
        var next = new Map();
        acc.forEach(function (w, id) {
          if (sets[s2].has(id)) next.set(id, w + sets[s2].get(id));
        });
        acc = next;
      }
      var mode = 'and';
      // fallback: OR (any token)
      if (!acc || acc.size === 0) {
        mode = 'or';
        acc = new Map();
        sets.forEach(function (set) {
          set.forEach(function (w, id) {
            if (!acc.has(id) || acc.get(id) < w) acc.set(id, w);
          });
        });
      }
      if (facetSet) {
        var fnext = new Map();
        acc.forEach(function (w, id) { if (facetSet.has(id)) fnext.set(id, w); });
        acc = fnext;
      }

      var list = Array.from(acc, function (entry) { return { id: entry[0], score: entry[1] }; });
      list.sort(function (a, b) { return b.score - a.score; });
      if (list.length > (opts.maxCandidates || 4000)) list = list.slice(0, opts.maxCandidates);
      return { ids: list, mode: mode, didYouMean: didYouMean };
    });
  }

  /* Suggestions for the combobox: top products + generic/company hints. */
  function suggestions(q, limit) {
    limit = limit || 8;
    return index().then(function (MDB_INDEX) {
      var v = getVocab(MDB_INDEX);
      var qt = tokenize(q)[0];
      if (!qt) return { products: [], terms: [] };
      var matches = matchToken(qt, v).slice(0, 6);
      var terms = matches.map(function (m) { return m.t; });
      return query(q, null, { maxCandidates: 300 }).then(function (res) {
        return { products: res.ids.slice(0, limit), terms: terms };
      });
    });
  }

  return { query: query, suggestions: suggestions, tokenize: tokenize, index: index };
})();

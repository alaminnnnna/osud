/* MedPrice BD — client state & persistence (theme, favorites, recents, compare). */
window.MDB_STORE = (function () {
  var KEY = 'mdb-prefs-v1';
  var defaults = { theme: 'system', favorites: {}, recents: [], recentSearches: [], compare: [] };
  var prefs;
  try { prefs = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch (e) { prefs = Object.assign({}, defaults); }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ }
  }

  /* ---- theme ---- */
  function applyTheme() {
    var pref = prefs.theme;
    var dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themePref = pref;
  }
  function setTheme(pref) {
    prefs.theme = pref;
    save();
    applyTheme();
    document.dispatchEvent(new CustomEvent('mdb:theme'));
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  /* ---- favorites ---- */
  function fav(id) { return !!prefs.favorites[id]; }
  function toggleFav(id, name) {
    if (prefs.favorites[id]) delete prefs.favorites[id];
    else prefs.favorites[id] = { name: name || '', at: Date.now() };
    save();
    return !!prefs.favorites[id];
  }
  function favList() { return Object.keys(prefs.favorites).map(Number); }

  /* ---- recently viewed ---- */
  function pushRecent(id, name) {
    prefs.recents = [{ id: id, name: name || '', at: Date.now() }]
      .concat(prefs.recents.filter(function (r) { return r.id !== id; }))
      .slice(0, 24);
    save();
  }
  function recents() { return prefs.recents; }

  /* ---- recent searches ---- */
  function pushSearch(q) {
    q = (q || '').trim();
    if (!q) return;
    prefs.recentSearches = [q].concat(prefs.recentSearches.filter(function (s) { return s.toLowerCase() !== q.toLowerCase(); })).slice(0, 8);
    save();
  }
  function recentSearches() { return prefs.recentSearches; }
  function clearSearches() { prefs.recentSearches = []; save(); }

  /* ---- compare ---- */
  function inCompare(id) { return prefs.compare.some(function (c) { return c.id === id; }); }
  function toggleCompare(id, name) {
    if (inCompare(id)) prefs.compare = prefs.compare.filter(function (c) { return c.id !== id; });
    else {
      if (prefs.compare.length >= 4) return 'full';
      prefs.compare.push({ id: id, name: name || '' });
    }
    save();
    return inCompare(id);
  }
  function compare() { return prefs.compare; }
  function clearCompare() { prefs.compare = []; save(); }

  return {
    applyTheme: applyTheme, setTheme: setTheme, theme: function () { return prefs.theme; },
    fav: fav, toggleFav: toggleFav, favList: favList,
    pushRecent: pushRecent, recents: recents,
    pushSearch: pushSearch, recentSearches: recentSearches, clearSearches: clearSearches,
    inCompare: inCompare, toggleCompare: toggleCompare, compare: compare, clearCompare: clearCompare,
  };
})();

#!/usr/bin/env node
'use strict';
/**
 * ============================================================================
 *  BANGLADESH MEDICINE PRICE DATABASE — Scraping Engine (scrape.js)
 * ============================================================================
 *  A single-file Node.js crawler for Arogga's public product catalogue.
 *
 *  Primary source   : https://api.arogga.com/general/v3/search
 *                     Params: _type=web, _page=N, _perPage=N, _is_base=1,
 *                             _get_filters=1, _product_category_id=N,
 *                             _form=<dosage form>, _brand_id=<brand id>
 *  Secondary source : https://www.arogga.com/product/{id}/{slug}
 *                     (used ONLY to re-check records whose prices are
 *                      missing/invalid; values found are preserved alongside
 *                      the API values, never silently overwriting them)
 *
 *  The API serves at most ~1000 rows per query window (page 11+ with
 *  _perPage=100 returns status:"fail"), so the catalogue (57k+ products) is
 *  crawled in FILTERED BUCKETS that each stay under the window:
 *
 *    1. Discovery  — global probe + full category list harvested from the
 *                    public sitemap files (all product types covered).
 *    2. Sweep      — page 1 of EVERY category (with facets): gives the real
 *                    category totals, the first rows, and — from the product
 *                    payloads — the set of TRUE leaf categories.
 *    3. Partition  — every leaf category with ≤990 products is a bucket;
 *                    bigger leaves are subdivided by dosage form (_form) and,
 *                    if still too big, by brand (_brand_id) inside
 *                    (category × form). Facet sums that fall short of the
 *                    parent total are recorded as coverage gaps — never
 *                    silently ignored.
 *    4. Crawl      — every bucket page fetched with a bounded worker pool,
 *                    global rate limit, retries with exponential backoff,
 *                    per-page checkpointing and a final failure sweep.
 *
 *  What a full run does:
 *    1-4 as above, then:
 *    5.  Extracts full product metadata, packaging units, B2C prices
 *        (regular + offer, base-unit and sales-unit) and image URLs
 *    6.  Validates every record (VERIFIED / PARTIALLY_VERIFIED /
 *        NEEDS_RECHECK / FAILED)
 *    7.  Detects duplicates (exact ID duplicates + fuzzy candidates)
 *    8.  Compares against the previous crawl and appends price history
 *    9.  Writes data/ files incrementally + atomically, with checkpoint /
 *        resume and graceful interruption (Ctrl+C)
 *   10.  Builds the static web platform bundles (search index, product
 *        chunks, slugs, sitemaps, file-based JSON API, prerendered SEO pages)
 *   11.  Prints a full crawl report
 *
 *  Usage:
 *    node scrape.js                     normal run (resumes interrupted run)
 *    node scrape.js --fresh             ignore checkpoint, start a new crawl
 *    node scrape.js --rebuild-web       rebuild web/ bundles from existing data
 *    node scrape.js --per-page=100      page size (5..100, default 100)
 *    node scrape.js --concurrency=3     parallel requests (default 3)
 *    node scrape.js --rate-ms=150       min ms between request starts
 *    node scrape.js --timeout-ms=20000  per-request timeout
 *    node scrape.js --retries=4         retries per request (exponential)
 *    node scrape.js --category=6574     restrict crawl to one category tree
 *    node scrape.js --max-pages=N       safety cap on pages per bucket (0=off)
 *    node scrape.js --no-verify         skip detail-page re-verification
 *    node scrape.js --max-verify=25     max detail-page verifications / run
 *    node scrape.js --site-base=URL     public base URL for sitemaps/canonicals
 *
 *  No third-party dependencies (Node >= 18, global fetch).
 *
 *  Fair-use notes:
 *   - No credentials, cookies or sessions are used or stored.
 *   - Requests are rate-limited and retried gently; defaults are low-volume.
 *   - api.arogga.com/robots.txt currently disallows crawling: keep the volume
 *     modest (defaults do), use this for a personal local price catalogue,
 *     and contact Arogga before any large-scale or commercial use.
 * ============================================================================
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');

const VERSION = '1.1.0';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const WEB_DIR = path.join(ROOT, 'web');
const WEB_JS_DIR = path.join(WEB_DIR, 'assets', 'js');

const API_SEARCH_URL = 'https://api.arogga.com/general/v3/search';
const SITE_ORIGIN = 'https://www.arogga.com';
const SITEMAP_INDEX = SITE_ORIGIN + '/sitemap.xml';

// Deep-pagination guard observed on the API: offsets beyond ~1000 rows fail.
const SAFE_MAX_ROWS = 990;

const REQUEST_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://www.arogga.com/',
};

/* ============================== CLI / CONFIG ============================== */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > -1) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++; }
    else out[a.slice(2)] = true;
  }
  return out;
}

const ARGV = parseArgs(process.argv.slice(2));
const toNum = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const CONFIG = {
  perPage: Math.min(100, Math.max(5, toNum(ARGV['per-page'] ?? process.env.SCRAPER_PER_PAGE, 100))),
  concurrency: Math.min(10, Math.max(1, toNum(ARGV['concurrency'] ?? process.env.SCRAPER_CONCURRENCY, 3))),
  timeoutMs: toNum(ARGV['timeout-ms'] ?? process.env.SCRAPER_TIMEOUT_MS, 20000),
  retries: Math.min(10, Math.max(0, toNum(ARGV['retries'] ?? process.env.SCRAPER_RETRIES, 4))),
  rateMs: Math.max(0, toNum(ARGV['rate-ms'] ?? process.env.SCRAPER_RATE_MS, 150)),
  maxVerify: toNum(ARGV['max-verify'] ?? process.env.SCRAPER_MAX_VERIFY, 25),
  verify: !ARGV['no-verify'],
  category: ARGV.category != null && ARGV.category !== true ? Number(ARGV.category)
    : process.env.SCRAPER_CATEGORY ? Number(process.env.SCRAPER_CATEGORY) : null,
  maxPages: toNum(ARGV['max-pages'] ?? process.env.SCRAPER_MAX_PAGES, 0),
  siteBase: String(ARGV['site-base'] ?? process.env.SITE_BASE ?? 'https://example.com').replace(/\/+$/, ''),
  fresh: !!ARGV.fresh,
  quiet: !!ARGV.quiet,
};

/* ================================ LOGGING ================================= */

let T0 = Date.now();
const ts = () => { const s = ((Date.now() - T0) / 1000).toFixed(1).padStart(8); return `[${s}s]`; };
const log = (...a) => { if (!CONFIG.quiet) console.log(ts(), ...a); };
const warn = (...a) => console.warn(ts(), 'WARN', ...a);
const errLog = (...a) => console.error(ts(), 'ERROR', ...a);

/* ============================ SMALL HELPERS =============================== */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataPath = (f) => path.join(DATA_DIR, f);
const round2 = (n) => Math.round(n * 100) / 100;
const slugify = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]+/g, '-').replace(/^-+|-+$/g, '') || 'product';
const titleCase = (slug) =>
  String(slug || '').split(/[-_]/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const numEq = (a, b) => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 0.005;
};

// Per-file write lock: concurrent workers must not race the same tmp file.
const _writeLocks = new Map();
async function atomicWriteJson(file, obj) {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const prev = _writeLocks.get(file) || Promise.resolve();
  const job = prev.catch(() => {}).then(async () => {
    await fsp.writeFile(tmp, JSON.stringify(obj), 'utf8');
    await fsp.rename(tmp, file);
  });
  _writeLocks.set(file, job);
  try {
    await job;
  } finally {
    if (_writeLocks.get(file) === job) _writeLocks.delete(file);
  }
}

async function ensureDirs() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(WEB_JS_DIR, { recursive: true });
}

/* ============================== HTTP LAYER ================================ */

const httpStats = { requests: 0, retries: 0, rateLimited: 0, hardFailures: 0 };

let nextSlotAt = 0;
async function rateGate() {
  const now = Date.now();
  const wait = Math.max(0, nextSlotAt - now);
  nextSlotAt = Math.max(now, nextSlotAt) + CONFIG.rateMs;
  if (wait > 0) await sleep(wait);
}

const backoffMs = (attempt) => Math.round(500 * Math.pow(2, attempt) + Math.random() * 400);

let stopping = false; // set by SIGINT/SIGTERM handlers

async function fetchWithRetry(url, { accept = 'application/json', tries = CONFIG.retries, label = 'request' } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= tries; attempt++) {
    if (stopping) throw new Error('Interrupted by user');
    await rateGate();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), CONFIG.timeoutMs);
    try {
      httpStats.requests++;
      const res = await fetch(url, {
        headers: { ...REQUEST_HEADERS, Accept: accept },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      if (res.status === 429 || res.status >= 500) {
        httpStats.retries++;
        if (res.status === 429) httpStats.rateLimited++;
        lastErr = new Error(`HTTP ${res.status}`);
        const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 0;
        if (attempt < tries) {
          const wait = Math.max(retryAfter, backoffMs(attempt));
          log(`  retry ${attempt + 1}/${tries} (${label}): ${lastErr.message}, waiting ${wait}ms`);
          await sleep(wait);
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status} ${res.statusText}`);
        e.permanent = res.status === 404 || res.status === 403 || res.status === 410;
        throw e;
      }
      return await res.text();
    } catch (e) {
      if (e && e.name === 'AbortError') lastErr = new Error(`timeout after ${CONFIG.timeoutMs}ms`);
      else lastErr = e;
      if (e && e.permanent) { httpStats.hardFailures++; throw e; }
      if (stopping) throw new Error('Interrupted by user');
      if (attempt < tries) {
        httpStats.retries++;
        const wait = backoffMs(attempt);
        log(`  retry ${attempt + 1}/${tries} (${label}): ${lastErr.message}, waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('fetch failed');
}

async function fetchJson(url, opts = {}) {
  const text = await fetchWithRetry(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    const e = new Error('Response was not valid JSON');
    e.permanent = false;
    throw e;
  }
}

/* ============================== CHECKPOINT ================================ */

const CHECKPOINT_VERSION = 4;
let checkpoint = null;
let lastCheckpointSave = 0;

function loadCheckpoint() {
  const file = dataPath('crawl-progress.json');
  try {
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j && j.version === CHECKPOINT_VERSION) return j;
      warn('crawl-progress.json has an incompatible version; starting fresh');
    }
  } catch (e) {
    warn('Could not load checkpoint:', e.message);
  }
  return null;
}

function newCheckpoint() {
  return {
    version: CHECKPOINT_VERSION,
    runId: new Date().toISOString().replace(/[:.]/g, '-'),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    incomplete: true,
    mode: CONFIG.category ? `category:${CONFIG.category}` : 'full-catalogue',
    perPage: CONFIG.perPage,
    phases: { discovery: false, sweep: false, plan: false, crawl: false },
    globalTotal: 0,
    types: [],
    siteCategories: [],
    sweep: {},        // catId -> { total, forms: {...}, brands: [...], at }
    observedLeaves: {}, // catId -> true (seen as a product's p_product_category_id)
    buckets: {},      // bucketKey -> { kind, catId, form, brand, total, totalPages, completedPages: {n:{count,at}}, }
    bucketGaps: [],   // { bucketKey, expected, covered, note }
    failedPages: {},  // bucketKey -> { page: { attempts, lastError, at } }
    stats: { pagesFetched: 0, recordsAppended: 0, duplicateLines: 0 },
  };
}

async function saveCheckpoint(force = false) {
  if (!checkpoint) return;
  const now = Date.now();
  if (!force && now - lastCheckpointSave < 5000 && !stopping) return;
  checkpoint.updatedAt = new Date().toISOString();
  checkpoint.stats.apiRequests = httpStats.requests;
  await atomicWriteJson(dataPath('crawl-progress.json'), checkpoint);
  lastCheckpointSave = now;
}

/* ============================ SEARCH URL BUILDER ========================== */

function searchUrl({ page = 1, perPage = CONFIG.perPage, categoryId = null, form = null, brand = null, getFilters = false } = {}) {
  const p = new URLSearchParams({
    _type: 'web',
    _page: String(page),
    _perPage: String(perPage),
    _is_base: '1',
  });
  if (categoryId != null) p.set('_product_category_id', String(categoryId));
  if (form) p.set('_form', String(form));
  if (brand != null) p.set('_brand_id', String(brand));
  if (getFilters) p.set('_get_filters', '1');
  return `${API_SEARCH_URL}?${p.toString()}`;
}

function bucketKeyOf({ catId, form = null, brand = null }) {
  let k = `cat:${catId}`;
  if (form) k += `|form:${form}`;
  if (brand != null) k += `|brand:${brand}`;
  return k;
}

function totalPagesFor(total) {
  return Math.max(1, Math.ceil(Number(total || 0) / CONFIG.perPage));
}

/* ============================== DISCOVERY ================================= */

function parseCategoryUrlsFromXml(xml) {
  const re = /https:\/\/www\.arogga\.com\/category\/([a-z0-9_-]+)\/(\d+)\/([a-z0-9-]+)</g;
  const seen = new Map();
  let m;
  while ((m = re.exec(xml)) !== null) {
    const id = Number(m[2]);
    if (!id || seen.has(id)) continue;
    seen.set(id, { id, type: m[1], slug: m[3], name: titleCase(m[3]) });
  }
  return seen;
}

async function harvestSitemapCategories() {
  const all = new Map();
  const idxText = await fetchWithRetry(SITEMAP_INDEX, { accept: 'application/xml,text/xml', tries: 2, label: 'sitemap-index' });
  const sitemapFiles = [...idxText.matchAll(/<loc>(https:\/\/www\.arogga\.com\/sitemap\/[^<]+)<\/loc>/g)].map((mm) => mm[1]);
  // Product sitemaps also carry category URLs; lab/doctor sitemaps do not matter.
  const wanted = sitemapFiles.filter((u) => /\/sitemap\/\d+\.xml$/.test(u));
  log(`sitemap index: ${sitemapFiles.length} sitemaps (${wanted.length} product sitemaps)`);
  for (const u of wanted) {
    if (stopping) break;
    try {
      const xml = await fetchWithRetry(u, { accept: 'application/xml,text/xml', tries: 2, label: 'sitemap' });
      for (const [id, cat] of parseCategoryUrlsFromXml(xml)) if (!all.has(id)) all.set(id, cat);
    } catch (e) {
      warn(`sitemap ${u} failed: ${e.message}`);
    }
  }
  return [...all.values()];
}

async function runDiscoveryPhase() {
  log('── Discovery phase ───────────────────────────────────────────────');
  if (checkpoint.phases.discovery && checkpoint.siteCategories.length) {
    log(`discovery cached in checkpoint (${checkpoint.siteCategories.length} categories)`);
    return { globalTotal: checkpoint.globalTotal, types: checkpoint.types, siteCategories: checkpoint.siteCategories };
  }
  // Global probe: total + taxonomy + first rows (rows are reused as records).
  const g = await fetchJson(searchUrl({ page: 1, getFilters: true }), { label: 'global-probe' });
  if (!g || g.status !== 'success' || !Array.isArray(g.data)) {
    throw new Error('Global probe failed validation');
  }
  checkpoint.globalTotal = Number(g.total) || 0;
  checkpoint.types = (g.filters && g.filters.p_type)
    ? Object.entries(g.filters.p_type).map(([key, count]) => ({ key, count: Number(count) })) : [];
  handleBucketRecords('global', 1, g.data);
  log(`catalogue total : ${checkpoint.globalTotal} products (API "total" field)`);
  log(`product types   : ${checkpoint.types.map((t) => `${t.key}:${t.count}`).join(', ')}`);

  const siteCategories = await harvestSitemapCategories();
  checkpoint.siteCategories = siteCategories;
  checkpoint.phases.discovery = true;
  await saveCheckpoint(true);
  log(`categories      : ${siteCategories.length} discovered from public sitemaps`);
  return { globalTotal: checkpoint.globalTotal, types: checkpoint.types, siteCategories, globalPage1Handled: true };
}

/* ====================== RECORD HANDLING (JSONL) =========================== */

const JSONL_FILE = dataPath('products.jsonl');

function handleBucketRecords(bucketKey, pageNo, records) {
  if (!Array.isArray(records)) throw new Error('Page payload .data is not an array');
  const seenInPage = new Set();
  const lines = [];
  const nowIso = new Date().toISOString();
  for (const raw of records) {
    const id = raw && (raw.p_id ?? raw.id);
    if (id == null) {
      checkpoint.stats.duplicateLines++;
      continue; // structurally broken record; counted, never silently dropped
    }
    if (seenInPage.has(id)) { checkpoint.stats.duplicateLines++; continue; }
    seenInPage.add(id);
    lines.push(JSON.stringify({ _meta: { runId: checkpoint.runId, bucket: bucketKey, page: pageNo, at: nowIso }, record: raw }));
    const catId = raw.p_product_category_id ?? raw.p_cat_id;
    // In single-category mode the global probe rows belong to other trees —
    // they must not mark unrelated categories as leaves of this subtree.
    if (catId != null && !(CONFIG.category && bucketKey === 'global')) checkpoint.observedLeaves[catId] = true;
  }
  if (lines.length) {
    fs.appendFileSync(JSONL_FILE, lines.join('\n') + '\n', 'utf8');
    checkpoint.stats.recordsAppended += lines.length;
  }
  return seenInPage.size;
}

/* ====================== PHASE 2 — CATEGORY SWEEP ========================== */

async function sweepCategory(catId) {
  if (checkpoint.sweep[catId]) return;
  // perPage=1: tiny request, but _get_filters still returns the full facet
  // set, and the single row's p_product_category_id reveals whether this
  // category is itself a leaf (its own products carry its id).
  const j = await fetchJson(searchUrl({ page: 1, perPage: 1, categoryId: catId, getFilters: true }), { label: `sweep-${catId}` });
  if (!j || j.status !== 'success' || !Array.isArray(j.data)) {
    throw new Error(`category ${catId} sweep failed validation (status=${j && j.status})`);
  }
  const total = Number(j.total) || 0;
  const brands = (Array.isArray(j.filters && j.filters._brand_id) ? j.filters._brand_id : [])
    .map((b) => ({ id: b.id, name: b.name, total: Number(b.total) || 0 }));
  // Register a direct crawl bucket ONLY when the category fits inside one
  // API query window. Oversized categories are handled in the plan phase:
  // leaves get subdivided by form/brand, pure parents are skipped entirely
  // (their children's buckets cover their products).
  if (total <= SAFE_MAX_ROWS) {
    const bucket = bucketKeyOf({ catId });
    if (!checkpoint.buckets[bucket]) {
      checkpoint.buckets[bucket] = { kind: 'cat', catId, total, totalPages: totalPagesFor(total), completedPages: {} };
    }
  }
  // The single sweep row is stored under a pseudo-bucket so consolidation can
  // dedupe it without marking the real bucket's page 1 as complete.
  handleBucketRecords(`sweep:${catId}`, 1, j.data);
  checkpoint.sweep[catId] = {
    total,
    // Facets are only needed for oversized leaves (bucket subdivision);
    // storing them for every category would bloat the checkpoint file.
    forms: total > SAFE_MAX_ROWS ? (j.filters && j.filters._form) || {} : undefined,
    brands: total > SAFE_MAX_ROWS ? brands : undefined,
    at: nowIso(),
  };
  checkpoint.stats.pagesFetched++;
}

function nowIso() { return new Date().toISOString(); }

async function runSweepPhase(categories) {
  log('── Sweep phase (page 1 of every category) ────────────────────────');
  const sweptBefore = Object.keys(checkpoint.sweep).length;
  let pending;
  if (CONFIG.category) {
    // Single-category mode: sweep the root, then keep sweeping every newly
    // observed leaf until the subtree is fully explored.
    pending = [CONFIG.category];
    for (let round = 0; round < 8 && !stopping; round++) {
      const todo = pending.filter((id) => !checkpoint.sweep[id]);
      if (!todo.length) break;
      log(`sweep round ${round + 1}: ${todo.length} categories`);
      await sweepList(todo);
      const newly = Object.keys(checkpoint.observedLeaves).map(Number)
        .filter((id) => !checkpoint.sweep[id] && !todo.includes(id) && !checkpoint.failedPages[`sweep:${id}`]);
      pending = todo.concat(newly);
    }
  } else {
    pending = categories.filter((c) => !checkpoint.sweep[c.id]).map((c) => c.id);
    await sweepList(pending);
  }
  if (stopping) return { interrupted: true };
  // Retry sweep failures once.
  const failedSweeps = Object.keys(checkpoint.failedPages).filter((k) => k.startsWith('sweep:'));
  for (const k of failedSweeps) {
    if (stopping) break;
    const catId = Number(k.slice(6));
    delete checkpoint.failedPages[k];
    try { await sweepCategory(catId); log(`sweep category ${catId} recovered ✓`); }
    catch (e) { checkpoint.failedPages[k] = { attempts: 1, lastError: String(e.message || e), at: nowIso() }; }
  }
  checkpoint.phases.sweep = true;
  // If this pass actually swept anything new, the bucket plan must be rebuilt
  // so freshly observed leaves become crawlable buckets.
  const sweptAny = Object.keys(checkpoint.sweep).length > sweptBefore;
  if (sweptAny) checkpoint.phases.plan = false;
  await saveCheckpoint(true);
  log(`sweep complete: ${Object.keys(checkpoint.sweep).length} categories, ${Object.keys(checkpoint.observedLeaves).length} distinct product-category ids observed`);
  return { interrupted: false };
}

async function sweepList(catIds) {
  const pending = [...catIds];
  let done = 0;
  const worker = async () => {
    while (!stopping) {
      const catId = pending.shift();
      if (catId == null) return;
      try {
        const before = !!checkpoint.sweep[catId];
        await sweepCategory(catId);
        if (!before) { checkpoint.stats.newlySwept = (checkpoint.stats.newlySwept || 0) + 1; }
      } catch (e) {
        if (stopping) return;
        errLog(`sweep category ${catId} FAILED: ${e.message}`);
        checkpoint.failedPages[`sweep:${catId}`] = { attempts: (checkpoint.failedPages[`sweep:${catId}`] || { attempts: 0 }).attempts + 1, lastError: String(e.message || e), at: nowIso() };
      }
      done++;
      if (done % 50 === 0) {
        log(`sweep progress: ${done}/${pending.length + done} categories, ${httpStats.requests} API requests`);
        await saveCheckpoint(true);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONFIG.concurrency, Math.max(1, pending.length)) }, worker));
}

/* ====================== PHASE 3 — BUCKET PLANNING ========================= */

function planBuckets() {
  log('── Bucket planning ───────────────────────────────────────────────');
  if (checkpoint.phases.plan) {
    log(`plan cached (${Object.keys(checkpoint.buckets).length} buckets)`);
    return;
  }
  const leaves = Object.keys(checkpoint.observedLeaves).map(Number).filter((id) => checkpoint.sweep[id]);
  const unsweptLeaves = Object.keys(checkpoint.observedLeaves).map(Number).filter((id) => !checkpoint.sweep[id]);
  log(`${leaves.length} leaf categories (from product payloads); ${unsweptLeaves.length} observed ids were never swept (not in sitemaps — recorded as gaps)`);
  for (const id of unsweptLeaves) {
    checkpoint.bucketGaps.push({ bucketKey: `cat:${id}`, expected: null, covered: 0, note: 'leaf category observed in product payloads but absent from public sitemaps — not crawlable directly' });
  }

  let buckets = 0, pages = 0, rowsExpected = 0;
  const ensureBucket = (def) => {
    const key = bucketKeyOf(def);
    if (!checkpoint.buckets[key]) {
      checkpoint.buckets[key] = { kind: def.brand != null ? 'cat+form+brand' : def.form ? 'cat+form' : 'cat', catId: def.catId, form: def.form || null, brand: def.brand ?? null, total: def.total, totalPages: totalPagesFor(def.total), completedPages: {} };
      buckets++; pages += totalPagesFor(def.total); rowsExpected += Number(def.total) || 0;
    }
    return checkpoint.buckets[key];
  };

  for (const catId of leaves) {
    const s = checkpoint.sweep[catId];
    const total = s.total;
    if (total <= 0) continue;
    if (total <= SAFE_MAX_ROWS) {
      ensureBucket({ catId, total });
      continue;
    }
    // Oversized leaf → subdivide by dosage form (facet from the sweep).
    // Remove any direct bucket for this category that the sweep registered.
    delete checkpoint.buckets[bucketKeyOf({ catId })];
    const forms = Object.entries(s.forms || {}).sort((a, b) => b[1] - a[1]);
    if (!forms.length) {
      checkpoint.bucketGaps.push({ bucketKey: bucketKeyOf({ catId }), expected: total, covered: 0, note: 'no _form facet returned for oversized leaf' });
      continue;
    }
    let covered = 0;
    const pendingFormBuckets = [];
    for (const [form, fTotal] of forms) {
      if (fTotal <= 0) continue;
      if (fTotal <= SAFE_MAX_ROWS) {
        pendingFormBuckets.push({ catId, form, total: fTotal });
        covered += fTotal;
      } else {
        // (category × form) still too big → brand subdivision happens in the
        // crawl phase (needs a facet fetch first).
        checkpoint.buckets[bucketKeyOf({ catId, form })] = {
          kind: 'cat+form', catId, form, total: fTotal, totalPages: totalPagesFor(fTotal),
          completedPages: {}, needsBrandExpansion: true,
        };
        covered += fTotal; // provisional; corrected after expansion
        buckets++; pages += 0;
      }
    }
    for (const def of pendingFormBuckets) ensureBucket(def);
    if (covered < total) {
      checkpoint.bucketGaps.push({ bucketKey: bucketKeyOf({ catId }), expected: total, covered, note: 'facet sums fall short of category total' });
    }
  }

  checkpoint.phases.plan = true;
  saveCheckpoint(true);
  const est = Object.values(checkpoint.buckets).filter((b) => !b.needsBrandExpansion).reduce((s, b) => s + (b.totalPages - Object.keys(b.completedPages).length), 0);
  log(`plan: ${Object.keys(checkpoint.buckets).length} buckets, ${est} pages to fetch, ${rowsExpected} rows expected in leaf buckets, ${checkpoint.bucketGaps.length} coverage gap(s)`);
}

/* ======================= PHASE 4 — BUCKET CRAWL =========================== */

async function crawlBucketPage(bucket, page) {
  const url = searchUrl({ page, categoryId: bucket.catId, form: bucket.form, brand: bucket.brand });
  const j = await fetchJson(url, { label: `${bucketKeyOf(bucket)}#${page}` });
  if (!j || j.status !== 'success' || !Array.isArray(j.data)) {
    throw new Error(`payload failed validation (status=${j && j.status})`);
  }
  const key = bucketKeyOf(bucket);
  const n = handleBucketRecords(key, page, j.data);
  bucket.completedPages[page] = { count: n, at: nowIso() };
  checkpoint.stats.pagesFetched++;
  await saveCheckpoint();
}

// A (category × form) bucket too big on its own: fetch its first page with
// facets, split by brand, and replace itself with brand sub-buckets.
async function expandByBrand(bucket) {
  const key = bucketKeyOf(bucket);
  const j = await fetchJson(searchUrl({ page: 1, categoryId: bucket.catId, form: bucket.form, getFilters: true }), { label: `expand-${key}` });
  if (!j || j.status !== 'success' || !Array.isArray(j.data)) {
    throw new Error(`brand expansion failed for ${key} (status=${j && j.status})`);
  }
  const brands = (Array.isArray(j.filters && j.filters._brand_id) ? j.filters._brand_id : [])
    .map((b) => ({ id: b.id, total: Number(b.total) || 0 })).filter((b) => b.total > 0);
  const facetSum = brands.reduce((s, b) => s + b.total, 0);
  if (facetSum < bucket.total * 0.97) {
    checkpoint.bucketGaps.push({ bucketKey: key, expected: bucket.total, covered: facetSum, note: 'brand facet truncated — shortfall recorded' });
  }
  const n = handleBucketRecords(key, 1, j.data);
  delete checkpoint.buckets[key]; // rows are kept in jsonl; dedupe handles overlap
  let created = 0;
  for (const b of brands) {
    if (b.total > SAFE_MAX_ROWS) {
      checkpoint.bucketGaps.push({ bucketKey: `${key}|brand:${b.id}`, expected: b.total, covered: 0, note: 'brand+category+form still exceeds the API window' });
      continue;
    }
    const def = { catId: bucket.catId, form: bucket.form, brand: b.id, total: b.total };
    const bk = ensureBucketRecord(def);
    created++;
  }
  void n;
  checkpoint.stats.pagesFetched++;
  return created;
}

function ensureBucketRecord(def) {
  const key = bucketKeyOf(def);
  if (!checkpoint.buckets[key]) {
    checkpoint.buckets[key] = {
      kind: def.brand != null ? 'cat+form+brand' : def.form ? 'cat+form' : 'cat',
      catId: def.catId, form: def.form || null, brand: def.brand ?? null,
      total: def.total, totalPages: totalPagesFor(def.total), completedPages: {},
    };
  }
  return checkpoint.buckets[key];
}

async function runBucketCrawl() {
  log('── Crawl phase (bucketed) ────────────────────────────────────────');
  // Expand any pending cat+form buckets (brand subdivision).
  const expandable = Object.entries(checkpoint.buckets).filter(([, b]) => b.needsBrandExpansion);
  for (const [key, bucket] of expandable) {
    if (stopping) return { interrupted: true };
    try {
      const created = await expandByBrand(bucket);
      log(`expanded ${key} → ${created} brand bucket(s)`);
    } catch (e) {
      if (stopping) return { interrupted: true };
      errLog(`expansion of ${key} FAILED: ${e.message}`);
      checkpoint.failedPages[key] = { attempts: 1, lastError: String(e.message || e), at: nowIso() };
      delete checkpoint.buckets[key];
    }
    await saveCheckpoint(true);
  }

  // Queue: every bucket page not yet completed. Hard cap: the API serves at
  // most ~SAFE_MAX_ROWS rows per query, so never request past that window
  // even if a stored total drifted between sweep and crawl.
  const maxPagesByWindow = Math.ceil(SAFE_MAX_ROWS / CONFIG.perPage);
  const queue = [];
  for (const [key, bucket] of Object.entries(checkpoint.buckets)) {
    if (bucket.needsBrandExpansion) continue;
    const cappedPages = Math.min(
      CONFIG.maxPages ? Math.min(bucket.totalPages, CONFIG.maxPages) : bucket.totalPages,
      maxPagesByWindow
    );
    for (let p = 1; p <= cappedPages; p++) {
      if (!bucket.completedPages[p]) queue.push({ bucket, key, page: p });
    }
  }
  log(`${queue.length} pages queued across ${Object.keys(checkpoint.buckets).length} buckets`);
  let done = 0;

  const failTask = (task, e) => {
    const fk = task.key;
    checkpoint.failedPages[fk] = checkpoint.failedPages[fk] || {};
    const prev = checkpoint.failedPages[fk][task.page] || { attempts: 0 };
    checkpoint.failedPages[fk][task.page] = { attempts: prev.attempts + 1, lastError: String(e.message || e), at: nowIso() };
    errLog(`${fk}#${task.page} FAILED (attempt ${prev.attempts + 1}): ${e.message}`);
  };

  const worker = async () => {
    while (!stopping) {
      const task = queue.shift();
      if (task == null) return;
      try {
        await crawlBucketPage(task.bucket, task.page);
      } catch (e) {
        if (stopping) return;
        failTask(task, e);
      }
      done++;
      if (done % 25 === 0) {
        const maxPagesByWindow = Math.ceil(SAFE_MAX_ROWS / CONFIG.perPage);
        const completed = Object.entries(checkpoint.buckets).reduce((s, [, b]) => s + Object.keys(b.completedPages).length, 0);
        const planned = Object.entries(checkpoint.buckets).reduce((s, [, b]) => s + Math.min(b.totalPages, maxPagesByWindow), 0);
        log(`progress: ${completed}/${planned} bucket pages complete, ${httpStats.requests} API requests, ${httpStats.retries} retries`);
        await saveCheckpoint(true);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONFIG.concurrency, Math.max(1, queue.length)) }, worker));
  if (stopping) { await saveCheckpoint(true); return { interrupted: true }; }

  // Final sweep over failed pages.
  const stillFailed = [];
  for (const [key, pages] of Object.entries(checkpoint.failedPages)) {
    if (key.startsWith('sweep:')) continue;
    const bucket = checkpoint.buckets[key];
    if (!bucket) continue;
    for (const p of Object.keys(pages)) if (!bucket.completedPages[p]) stillFailed.push({ bucket, key, page: Number(p) });
  }
  if (stillFailed.length) {
    log(`final sweep: retrying ${stillFailed.length} failed page(s)`);
    for (const task of stillFailed) {
      if (stopping) break;
      try { await crawlBucketPage(task.bucket, task.page); log(`${task.key}#${task.page} recovered ✓`); }
      catch (e) { failTask(task, e); }
    }
    await saveCheckpoint(true);
  }
  checkpoint.phases.crawl = true;
  await saveCheckpoint(true);
  return { interrupted: false };
}

function collectFailures() {
  const out = [];
  for (const [key, pages] of Object.entries(checkpoint.failedPages)) {
    if (key.startsWith('sweep:')) { out.push({ bucketKey: key, page: 0, ...pages }); continue; }
    for (const [p, f] of Object.entries(pages)) out.push({ bucketKey: key, page: Number(p), ...f });
  }
  return out;
}

/* ================= PHASE 5 — SITEMAP RECONCILIATION ======================= */
/* Final completeness check: every product URL in the public sitemaps must be
   in the dataset. Products whose categories the API rejects (or whose facet
   sums fell short) are fetched individually from their public product pages
   (JSON-LD + embedded price fields) and stored with their provenance. */

function harvestProductUrls(xml) {
  const out = [];
  const re = /https:\/\/www\.arogga\.com\/product\/(\d+)\/([a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.push({ id: Number(m[1]), slug: m[2] });
  return out;
}

async function fetchSitemapProductUrls() {
  const map = new Map();
  const idxText = await fetchWithRetry(SITEMAP_INDEX, { accept: 'application/xml,text/xml', tries: 2, label: 'sitemap-index' });
  const files = [...idxText.matchAll(/<loc>(https:\/\/www\.arogga\.com\/sitemap\/[^<]+)<\/loc>/g)].map((mm) => mm[1])
    .filter((u) => /\/sitemap\/\d+\.xml$/.test(u));
  for (const u of files) {
    if (stopping) break;
    try {
      const xml = await fetchWithRetry(u, { accept: 'application/xml,text/xml', tries: 2, label: 'sitemap' });
      for (const p of harvestProductUrls(xml)) if (!map.has(p.id)) map.set(p.id, p.slug);
    } catch (e) {
      warn(`sitemap ${u} failed during reconciliation: ${e.message}`);
    }
  }
  return map;
}

async function scanCollectedIds() {
  const ids = new Set();
  const rl = readline.createInterface({ input: fs.createReadStream(JSONL_FILE, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const i = line.indexOf('"p_id":');
    if (i === -1) continue;
    const m = /^(\d+)/.exec(line.slice(i + 7));
    if (m) ids.add(Number(m[1]));
    else {
      try { const j = JSON.parse(line); if (j.record && j.record.p_id != null) ids.add(Number(j.record.p_id)); } catch { /* counted in consolidation */ }
    }
  }
  rl.close();
  return ids;
}

function escapeJsonLd(htmlSrc) {
  const m = htmlSrc.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  const blocks = [];
  for (const b of m) {
    try { blocks.push(JSON.parse(b.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, ''))); } catch { /* skip */ }
  }
  return blocks;
}

function parseDetailBreadcrumbCategory(htmlSrc) {
  for (const block of escapeJsonLd(htmlSrc)) {
    if (block['@type'] !== 'BreadcrumbList') continue;
    const items = (block.itemListElement || []).map((x) => x.item || {});
    for (let i = items.length - 1; i >= 0; i--) {
      const s = typeof items[i] === 'string' ? items[i] : JSON.stringify(items[i]);
      const mm = /\/category\/([a-z0-9_-]+)\/(\d+)\//.exec(s);
      if (mm) return { id: Number(mm[2]), type: mm[1] };
    }
  }
  return null;
}

function parseDetailJsonLdProduct(htmlSrc) {
  for (const block of escapeJsonLd(htmlSrc)) {
    if (block['@type'] !== 'Product') continue;
    return block;
  }
  return null;
}

async function reconcileOne(id, slug, url) {
  const htmlSrc = await fetchWithRetry(url, { accept: 'text/html,application/xhtml+xml', tries: 2, label: `reconcile-${id}` });
  const ld = parseDetailJsonLdProduct(htmlSrc);
  const cat = parseDetailBreadcrumbCategory(htmlSrc);
  const prices = parseDetailPrices(htmlSrc, id);
  if (!ld && prices.regularBase == null && prices.regularSales == null) {
    throw new Error('no recognizable product data on detail page');
  }
  const offer = ld && ld.offers ? Number(ld.offers.price) : null;
  const raw = {
    p_id: id,
    id,
    p_name: (ld && ld.name) || null,
    p_name_bn: null,
    p_alternative_names: [],
    p_type: cat ? cat.type : null,
    p_generic_id: null,
    p_rx_req: 0,
    p_attribute: '',
    p_form: null,
    p_strength: null,
    p_manufacturer_id: null,
    p_company_id: null,
    p_brand_id: null,
    p_variant_count: 1,
    p_active_status: 'active',
    p_cat_id: cat ? cat.id : null,
    p_product_category_id: cat ? cat.id : null,
    p_allow_sales: 1,
    p_stock_status: 0,
    p_product_tags: [],
    p_generic_name: null,
    p_brand: (ld && ld.brand && ld.brand.name) || null,
    p_brand_name: (ld && ld.brand && ld.brand.name) || null,
    p_manufacturer: (ld && ld.brand && ld.brand.name) || null,
    pu: [],
    pv: [{
      pv_id: id, id, pv_p_id: id, pv_is_base: 1,
      pv_mrp: prices.regularBase,
      pv_b2c_discounted_price: prices.offerBase,
      pv_b2c_mrp: prices.regularSales,
      pv_b2c_price: prices.offerSales,
      pv_b2c_discount_percent: prices.discountPercent,
      pv_b2c_min_qty: null,
      pv_b2c_max_qty: null,
      pv_allow_purchase: 1,
      pv_allow_sales: 1,
      pv_stock_status: 1,
      pu_base_unit_label: prices.baseUnit || null,
      pu_base_unit_multiplier: prices.salesUnitMultiplier || null,
      pu_b2c_sales_unit_label: prices.salesUnit || null,
      pu_b2c_base_unit_multiplier: prices.salesUnitMultiplier || null,
    }],
    haveImage: ld && ld.image ? 1 : 0,
    attachedFiles_p_images: ld && ld.image ? [{ src: ld.image, title: (ld.name || '').slice(0, 80) }] : [],
    _reconciled: { source: 'product-detail-page', url, offerPrice: offer },
  };
  handleBucketRecords('detail-reconcile', 0, [raw]);
}

async function runReconcilePhase() {
  log('── Reconciliation phase (sitemap product ids vs collected) ───────');
  const sitemapProducts = await fetchSitemapProductUrls();
  log(`sitemap product ids: ${sitemapProducts.size}`);
  const collected = await scanCollectedIds();
  log(`collected product ids: ${collected.size}`);
  const missing = [];
  for (const [id, slug] of sitemapProducts) if (!collected.has(id)) missing.push({ id, slug });
  checkpoint.reconcile = {
    sitemapProducts: sitemapProducts.size,
    collected: collected.size,
    missing: missing.length,
    fetched: 0,
    failed: 0,
    at: nowIso(),
  };
  if (!missing.length) {
    log('reconciliation: nothing missing — catalogue fully covered');
    await saveCheckpoint(true);
    return { missing: 0 };
  }
  log(`reconciliation: ${missing.length} product(s) not reachable via category buckets — fetching their public product pages`);
  let done = 0;
  const queue = missing.slice();
  const worker = async () => {
    while (!stopping) {
      const item = queue.shift();
      if (item == null) return;
      const url = `${SITE_ORIGIN}/product/${item.id}/${item.slug}`;
      try {
        await reconcileOne(item.id, item.slug, url);
        checkpoint.reconcile.fetched++;
      } catch (e) {
        if (stopping) return;
        checkpoint.reconcile.failed++;
        checkpoint.failedPages[`reconcile:${item.id}`] = { attempts: 1, lastError: String(e.message || e), at: nowIso() };
      }
      done++;
      if (done % 100 === 0) {
        log(`reconcile progress: ${done}/${missing.length}, ${checkpoint.reconcile.fetched} fetched, ${checkpoint.reconcile.failed} failed`);
        await saveCheckpoint(true);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONFIG.concurrency, Math.max(1, queue.length)) }, worker));
  await saveCheckpoint(true);
  log(`reconciliation done: ${checkpoint.reconcile.fetched} recovered, ${checkpoint.reconcile.failed} failed (kept in failed-records)`);
  return { missing: missing.length };
}

function crawlStats() {
  const maxPagesByWindow = Math.ceil(SAFE_MAX_ROWS / CONFIG.perPage);
  const bucketList = Object.values(checkpoint.buckets);
  const perBucket = (b) => Math.min(
    CONFIG.maxPages ? Math.min(b.totalPages, CONFIG.maxPages) : b.totalPages,
    maxPagesByWindow
  );
  const plannedPages = bucketList.reduce((s, b) => s + perBucket(b), 0);
  const completedPages = bucketList.reduce((s, b) => s + Object.keys(b.completedPages).length, 0);
  const rowsExpected = bucketList.reduce((s, b) => s + (Number(b.total) || 0), 0);
  return { plannedPages, completedPages, rowsExpected, bucketCount: bucketList.length };
}

/* ======================== RECORD NORMALIZATION ============================ */

function checkImageUrl(u) {
  if (!u || typeof u !== 'string') return false;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeRecord(raw, meta) {
  const pvArr = Array.isArray(raw.pv) ? raw.pv : [];
  const puArr = Array.isArray(raw.pu) ? raw.pu : [];
  const base = pvArr.find((v) => v && (v.pv_is_base === 1 || v.pv_is_base === true)) || pvArr[0] || null;
  const id = raw.p_id ?? raw.id ?? (base ? base.pv_p_id : null);

  const imagesRaw = Array.isArray(raw.attachedFiles_p_images) ? raw.attachedFiles_p_images : [];
  const firstImg = imagesRaw.find((i) => i && i.src) || null;
  const poster = raw.POSTER || null;

  // Base unit / sales unit, from the base variant (falls back to unit table)
  const baseUnitRow = puArr.find((u) => u && (u.pu_is_base === 1 || u.pu_is_base === true)) || null;
  const baseUnitLabel = (base && base.pu_base_unit_label) || (baseUnitRow && baseUnitRow.pu_label) || null;
  const baseUnitMultiplier = (base && base.pu_base_unit_multiplier) ?? (baseUnitRow ? baseUnitRow.pu_multiplier : null);
  const salesUnitLabel = (base && base.pu_b2c_sales_unit_label) || null;
  const salesUnitMultiplier = (base && base.pu_b2c_base_unit_multiplier) ?? null;
  const salesUnitId = (base && base.pu_b2c_sales_unit_id) ?? null;

  // Strip / box quantities derived from the unit multipliers (10 tablets per
  // strip, 500 tablets per box in the Napa example).
  const unitByLabel = (re) => {
    const u = puArr.find((x) => x && typeof x.pu_label === 'string' && re.test(x.pu_label));
    return u ? u.pu_multiplier : null;
  };

  return {
    productId: id,
    name: raw.p_name ?? null,
    nameBn: raw.p_name_bn || null,
    alternativeNames: Array.isArray(raw.p_alternative_names) ? raw.p_alternative_names : [],
    productType: raw.p_type ?? null,
    genericId: raw.p_generic_id ?? null,
    genericName: (raw.p_generic_name || '').trim() || null,
    brandId: raw.p_brand_id ?? null,
    brandName: raw.p_brand || raw.p_brand_name || null,
    manufacturerId: raw.p_manufacturer_id ?? raw.p_company_id ?? null,
    manufacturerName: raw.p_manufacturer || raw.p_brand || raw.p_brand_name || null,
    strength: raw.p_strength || null,
    strengthBn: raw.p_strength_bn || null,
    dosageForm: raw.p_form || null,
    categoryId: raw.p_product_category_id ?? raw.p_cat_id ?? null,
    productStatus: raw.p_active_status ?? null,
    prescriptionRequired: raw.p_rx_req === 1 || raw.p_rx_req === true,
    allowSales: raw.p_allow_sales === 1 || raw.p_allow_sales === true,
    stockStatus: raw.p_stock_status ?? null,
    isFlashSale: raw.p_is_flash_sale === 1 || raw.p_is_flash_sale === true,
    variantCountDeclared: raw.p_variant_count ?? null,
    packaging: {
      purchaseUnits: puArr.map((u) => ({
        purchaseUnitId: u.pu_id ?? u.id ?? null,
        productId: u.pu_p_id ?? null,
        label: u.pu_label ?? null,
        multiplier: u.pu_multiplier ?? null,
        isBase: !!(u.pu_is_base === 1 || u.pu_is_base === true),
        isB2cSalesUnit: !!(u.pu_is_b2c_sales_unit === 1 || u.pu_is_b2c_sales_unit === true),
        isB2bSalesUnit: !!(u.pu_is_b2b_sales_unit === 1 || u.pu_is_b2b_sales_unit === true),
        isDefaultPurchaseUnit: !!(u.pu_is_default_purchase_unit === 1 || u.pu_is_default_purchase_unit === true),
        b2cSalesEnabled: !!(u.pu_is_b2c_sales_enabled === 1 || u.pu_is_b2c_sales_enabled === true),
        b2bSalesEnabled: !!(u.pu_is_b2b_sales_enabled === 1 || u.pu_is_b2b_sales_enabled === true),
        purchaseEnabled: !!(u.pu_is_purchase_enabled === 1 || u.pu_is_purchase_enabled === true),
      })),
      baseUnit: baseUnitLabel,
      baseUnitMultiplier,
      salesUnit: salesUnitLabel,
      salesUnitId,
      salesUnitMultiplier,
      stripQuantity: unitByLabel(/strip/i),
      boxQuantity: unitByLabel(/box/i),
    },
    prices: {
      // B2C prices only — B2B fields are preserved separately in `variants`
      // and are never used for customer-facing values.
      regularBase: base && base.pv_mrp != null ? Number(base.pv_mrp) : null,          // pv_mrp
      offerBase: base && base.pv_b2c_discounted_price != null ? Number(base.pv_b2c_discounted_price) : null, // pv_b2c_discounted_price
      regularSales: base && base.pv_b2c_mrp != null ? Number(base.pv_b2c_mrp) : null, // pv_b2c_mrp
      offerSales: base && base.pv_b2c_price != null ? Number(base.pv_b2c_price) : null, // pv_b2c_price
      discountPercent: base && base.pv_b2c_discount_percent != null ? Number(base.pv_b2c_discount_percent) : null,
      minQty: base && base.pv_b2c_min_qty != null ? Number(base.pv_b2c_min_qty) : null,
      maxQty: base && base.pv_b2c_max_qty != null ? Number(base.pv_b2c_max_qty) : null,
      baseUnit: baseUnitLabel,
      baseUnitMultiplier,
      salesUnit: salesUnitLabel,
      salesUnitMultiplier,
      source: 'api',
    },
    variants: pvArr.map((v) => ({
      variantId: v.pv_id ?? null,
      isBase: !!(v.pv_is_base === 1 || v.pv_is_base === true),
      sku: v.pv_sku || null,
      attribute: v.pv_attribute ?? null,
      stockStatus: v.pv_stock_status ?? null,
      allowPurchase: !!(v.pv_allow_purchase === 1 || v.pv_allow_purchase === true),
      allowSales: !!(v.pv_allow_sales === 1 || v.pv_allow_sales === true),
      b2c: {
        regularBase: v.pv_mrp ?? null,
        offerBase: v.pv_b2c_discounted_price ?? null,
        regularSales: v.pv_b2c_mrp ?? null,
        offerSales: v.pv_b2c_price ?? null,
        discountPercent: v.pv_b2c_discount_percent ?? null,
        minQty: v.pv_b2c_min_qty ?? null,
        maxQty: v.pv_b2c_max_qty ?? null,
        baseUnitLabel: v.pu_base_unit_label ?? null,
        salesUnitLabel: v.pu_b2c_sales_unit_label ?? null,
        baseUnitMultiplier: v.pu_base_unit_multiplier ?? null,
        salesUnitMultiplier: v.pu_b2c_base_unit_multiplier ?? null,
        salesUnitId: v.pu_b2c_sales_unit_id ?? null,
      },
      b2b: {
        regularBase: v.pv_b2b_mrp ?? null,
        offerBase: v.pv_b2b_discounted_price ?? null,
        regularSales: v.pv_b2b_price ?? null,
        discountPercent: v.pv_b2b_discount_percent ?? null,
        salesUnitLabel: v.pu_b2b_sales_unit_label ?? null,
        salesUnitMultiplier: v.pu_b2b_base_unit_multiplier ?? null,
      },
      ratings: { average: v.pv_average_rating ?? null, total: v.pv_total_rating ?? null },
    })),
    image: {
      available: !!(firstImg || poster),
      url: firstImg ? firstImg.src : null,
      title: firstImg ? firstImg.title || null : null,
      posterUrl: poster,
      urlValid: checkImageUrl((firstImg && firstImg.src) || poster),
    },
    productUrl: id != null ? `${SITE_ORIGIN}/product/${id}/${slugify(raw.p_name || '')}` : null,
    createdAt: raw.p_created_at || null,
    trendingScore: typeof raw.p_trending_score === 'number' ? raw.p_trending_score : null,
    orderedCount: typeof raw.productCountOrdered === 'number' ? raw.productCountOrdered : null,
    viewedCount: typeof raw.productCountViewed === 'number' ? raw.productCountViewed : null,
    _meta: meta || null,
  };
}

/* ========================== VALIDATION ENGINE ============================= */

function validateProduct(rec) {
  const issues = [];
  const conflicts = [];
  const p = rec.prices;
  const present = [p.regularBase, p.offerBase, p.regularSales, p.offerSales].filter((v) => v != null).length;

  if (rec.productId == null) issues.push('productId missing');
  if (!rec.name) issues.push('name missing');
  if (!rec.genericName) issues.push('generic_name missing');
  if (!rec.manufacturerName) issues.push('manufacturer missing');
  if (p.regularBase == null && p.offerBase == null) issues.push('base-unit prices missing (pv_mrp / pv_b2c_discounted_price)');
  if (p.regularSales == null && p.offerSales == null) issues.push('sales-unit prices missing (pv_b2c_mrp / pv_b2c_price)');
  if (!p.salesUnit) issues.push('sales unit label missing');
  if (!rec.image.available) issues.push('image missing');
  else if (!rec.image.urlValid) issues.push('image URL invalid');

  // Price sanity — detect swapped / impossible values, never fix them silently.
  for (const [label, v] of [['regularBase', p.regularBase], ['offerBase', p.offerBase], ['regularSales', p.regularSales], ['offerSales', p.offerSales]]) {
    if (v != null && !(Number(v) >= 0)) issues.push(`${label} is negative/invalid (${v})`);
  }
  if (p.regularBase != null && p.offerBase != null && Number(p.offerBase) > Number(p.regularBase)) {
    conflicts.push({ field: 'base-unit', regular: p.regularBase, offer: p.offerBase, note: 'offer price exceeds regular price — possible field swap; both values preserved' });
  }
  if (p.regularSales != null && p.offerSales != null && Number(p.offerSales) > Number(p.regularSales)) {
    conflicts.push({ field: 'sales-unit', regular: p.regularSales, offer: p.offerSales, note: 'offer price exceeds regular price — possible field swap; both values preserved' });
  }
  // Cross-check: sales price should roughly equal base price × sales multiplier
  if (p.regularBase != null && p.regularSales != null && p.salesUnitMultiplier > 0) {
    const expected = Number(p.regularBase) * Number(p.salesUnitMultiplier);
    if (expected > 0 && Math.abs(expected - Number(p.regularSales)) / expected > 0.2) {
      issues.push(`info: regular sales price (${p.regularSales}) differs >20% from base×multiplier (${round2(expected)}) — preserved as listed`);
    }
  }

  let status;
  if (rec.productId == null || !rec.name) status = 'FAILED';
  else if (conflicts.length || present === 0 || issues.some((i) => i.includes('negative/invalid'))) status = 'NEEDS_RECHECK';
  else if (issues.length) status = 'PARTIALLY_VERIFIED';
  else status = 'VERIFIED';

  rec.validation = { status, issues, conflicts, checkedAt: new Date().toISOString() };
  return rec.validation;
}

/* ===================== DETAIL-PAGE (SECONDARY) VERIFY ===================== */

function extractDetailWindow(html, productId) {
  const anchors = [`pv_p_id\\":${productId}`, `"pv_p_id":${productId}`, `p_id\\":${productId}`, `"p_id":${productId}`];
  for (const a of anchors) {
    const idx = html.indexOf(a);
    if (idx > -1) return html.slice(Math.max(0, idx - 500), idx + 6000);
  }
  return html;
}

function parseDetailPrices(html, productId) {
  const win = extractDetailWindow(html, productId);
  const num = (re) => { const m = win.match(re); return m ? Number(m[1]) : null; };
  const str = (re) => { const m = win.match(re); return m ? m[1] : null; };
  return {
    regularBase: num(/pv_mrp\\":\s*(-?[\d.]+)/),
    offerBase: num(/pv_b2c_discounted_price\\":\s*(-?[\d.]+)/),
    regularSales: num(/pv_b2c_mrp\\":\s*(-?[\d.]+)/),
    offerSales: num(/pv_b2c_price\\":\s*(-?[\d.]+)/),
    discountPercent: num(/pv_b2c_discount_percent\\":\s*(-?[\d.]+)/),
    salesUnit: str(/pu_b2c_sales_unit_label\\":\\"([^"\\]+)\\"/),
    baseUnit: str(/pu_base_unit_label\\":\\"([^"\\]+)\\"/),
    salesUnitMultiplier: num(/pu_b2c_base_unit_multiplier\\":\s*(-?[\d.]+)/),
  };
}

async function verifyFromDetailPage(rec) {
  const url = rec.productUrl;
  const html = await fetchWithRetry(url, { accept: 'text/html,application/xhtml+xml', tries: 2, label: `detail-${rec.productId}` });
  const found = parseDetailPrices(html, rec.productId);
  const foundAny = Object.values(found).some((v) => v != null);
  if (!foundAny) throw new Error('no recognizable price fields on detail page');
  return { url, at: new Date().toISOString(), values: found };
}

function applyDetailVerification(rec, detail) {
  rec._detailVerification = detail;
  const dv = detail.values;
  const p = rec.prices;
  const filled = [];
  for (const field of ['regularBase', 'offerBase', 'regularSales', 'offerSales', 'discountPercent', 'salesUnit', 'salesUnitMultiplier']) {
    const apiVal = p[field];
    const dvVal = dv[field];
    if (dvVal == null) continue;
    if (apiVal == null) {
      p[field] = dvVal;
      p.source = 'api+detail';
      filled.push(field);
    } else if (typeof apiVal === 'number' && typeof dvVal === 'number') {
      if (!numEq(apiVal, dvVal)) {
        rec.validation.conflicts.push({ field, apiValue: apiVal, detailValue: dvVal, note: 'API and product detail page disagree; both values preserved (API value kept as listed)' });
      }
    } else if (String(apiVal) !== String(dvVal)) {
      rec.validation.conflicts.push({ field, apiValue: apiVal, detailValue: dvVal, note: 'API and product detail page disagree; both values preserved (API value kept as listed)' });
    }
  }
  // Re-validate with the merged values.
  const before = rec.validation.status;
  validateProduct(rec);
  rec.validation.issues.push(`detail-page verification: ${filled.length ? 'filled ' + filled.join(', ') + ' from detail page; ' : ''}${before} → ${rec.validation.status}`);
  rec.validation.issues = rec.validation.issues.filter((v, i, a) => a.indexOf(v) === i);
  return rec.validation.status;
}

/* ============================ CONSOLIDATION =============================== */

async function loadPrevPrices() {
  const file = dataPath('prices.json');
  try {
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const map = new Map();
      for (const it of j.items || []) map.set(it.productId, it);
      log(`previous prices loaded: ${map.size} products (${j.generatedAt || 'unknown date'})`);
      return map;
    }
  } catch (e) {
    warn(`could not load previous prices.json: ${e.message}`);
  }
  return new Map();
}

async function loadPrevHistory() {
  const file = dataPath('price-history.json');
  try {
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(j)) return j;
      if (Array.isArray(j.entries)) return j.entries;
    }
  } catch (e) {
    warn(`could not load previous price-history.json: ${e.message}`);
  }
  return [];
}

function buildPriceRow(rec) {
  const p = rec.prices;
  return {
    productId: rec.productId,
    name: rec.name,
    regular: {
      base: p.regularBase, sales: p.regularSales,
      baseUnit: p.baseUnit, salesUnit: p.salesUnit, salesUnitMultiplier: p.salesUnitMultiplier,
    },
    offer: {
      base: p.offerBase, sales: p.offerSales,
      discountPercent: p.discountPercent, minQty: p.minQty, maxQty: p.maxQty,
    },
    source: p.source,
    verifiedAt: rec.validation.checkedAt,
    validationStatus: rec.validation.status,
  };
}

function priceChanged(prev, now) {
  if (!prev) return false;
  const cmp = (a, b) => (a == null && b == null) || (a != null && b != null && numEq(a, b));
  return !(
    cmp(prev.regular && prev.regular.base, now.regular.base) &&
    cmp(prev.regular && prev.regular.sales, now.regular.sales) &&
    cmp(prev.offer && prev.offer.base, now.offer.base) &&
    cmp(prev.offer && prev.offer.sales, now.offer.sales)
  );
}

function buildHistoryEntry(rec, prev, now) {
  const changes = [];
  const fields = [
    ['regular.base', prev.regular && prev.regular.base, now.regular.base],
    ['regular.sales', prev.regular && prev.regular.sales, now.regular.sales],
    ['offer.base', prev.offer && prev.offer.base, now.offer.base],
    ['offer.sales', prev.offer && prev.offer.sales, now.offer.sales],
  ];
  for (const [field, oldV, newV] of fields) {
    const same = (oldV == null && newV == null) || (oldV != null && newV != null && numEq(oldV, newV));
    if (!same) changes.push({ field, old: oldV, new: newV });
  }
  if (!changes.length) return null;
  return {
    productId: rec.productId,
    name: rec.name,
    runId: checkpoint.runId,
    at: now.verifiedAt,
    changes,
  };
}

async function consolidate({ total, totalPages, types, siteCategories }) {
  log('── Consolidation & validation phase ──────────────────────────────');
  const prevPrices = await loadPrevPrices();
  const prevHistory = await loadPrevHistory();

  const products = new Map();          // productId -> normalized record
  const dupRaw = new Map();            // productId -> { occurrences, pages:Set }
  const fuzzy = new Map();             // fuzzy key -> [{id, name}]
  const companies = new Map();         // company key -> {id, name, productCount}
  const generics = new Map();          // generic key -> {id, name, productCount}
  const catCounts = new Map();         // categoryId -> count
  const typeCounts = new Map();        // p_type -> count
  const formCounts = new Map();        // dosage form -> count
  const webRows = [];                  // compact frontend rows
  let corruptLines = 0;
  let rawLines = 0;

  const dictIndex = (map, id, name) => {
    const key = id != null ? `id:${id}` : `n:${String(name || '').toLowerCase()}`;
    if (!map.has(key)) map.set(key, { items: [], index: map.size });
    const e = map.get(key);
    if (!e.items.length) e.items.push({ id: id != null ? id : null, name: name != null ? name : null });
    return e.index;
  };
  const companyDict = new Map();
  const genericDict = new Map();
  const formDict = new Map();
  const typeDict = new Map();

  // ---- pass 1: stream products.jsonl --------------------------------------
  if (!fs.existsSync(JSONL_FILE)) throw new Error('data/products.jsonl not found — nothing to consolidate');
  const rl = readline.createInterface({ input: fs.createReadStream(JSONL_FILE, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    rawLines++;
    let parsed;
    try { parsed = JSON.parse(line); } catch { corruptLines++; continue; }
    const rec = normalizeRecord(parsed.record, parsed._meta);
    if (rec.productId == null) { corruptLines++; continue; }
    validateProduct(rec);
    if (products.has(rec.productId)) {
      // exact duplicate product ID (page overlap or re-fetched page) — keep
      // the first, record the extra occurrence in the validation report.
      const d = dupRaw.get(rec.productId) || { occurrences: 1, pages: new Set() };
      d.occurrences++;
      d.pages.add(parsed._meta && parsed._meta.page);
      dupRaw.set(rec.productId, d);
      continue;
    }
    products.set(rec.productId, rec);

    // aggregates
    const cKey = rec.manufacturerId != null ? `id:${rec.manufacturerId}` : `n:${String(rec.manufacturerName || '').toLowerCase()}`;
    const cEnt = companies.get(cKey) || { id: rec.manufacturerId, name: rec.manufacturerName || '(unknown)', productCount: 0 };
    if (!cEnt.name && rec.manufacturerName) cEnt.name = rec.manufacturerName;
    cEnt.productCount++;
    companies.set(cKey, cEnt);
    rec._webCompIdx = dictIndex(companyDict, rec.manufacturerId, rec.manufacturerName || '(unknown)');

    const gKey = rec.genericId != null ? `id:${rec.genericId}` : `n:${String(rec.genericName || '').toLowerCase()}`;
    const gEnt = generics.get(gKey) || { id: rec.genericId, name: rec.genericName || '(unknown)', productCount: 0 };
    if (!gEnt.name && rec.genericName) gEnt.name = rec.genericName;
    gEnt.productCount++;
    generics.set(gKey, gEnt);
    rec._webGenIdx = dictIndex(genericDict, rec.genericId, rec.genericName || '(unknown)');

    rec._webFormIdx = dictIndex(formDict, null, rec.dosageForm || '(unknown)');
    rec._webTypeIdx = dictIndex(typeDict, null, rec.productType || '(unknown)');

    if (rec.categoryId != null) catCounts.set(rec.categoryId, (catCounts.get(rec.categoryId) || 0) + 1);
    if (rec.productType) typeCounts.set(rec.productType, (typeCounts.get(rec.productType) || 0) + 1);
    if (rec.dosageForm) formCounts.set(rec.dosageForm, (formCounts.get(rec.dosageForm) || 0) + 1);

    // fuzzy duplicate candidates — never merged, only reported
    const fkey = [rec.name, rec.strength, rec.genericName, rec.manufacturerName, rec.dosageForm, rec.prices.salesUnit + 'x' + rec.prices.salesUnitMultiplier]
      .map((s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
    if (rec.name) {
      const arr = fuzzy.get(fkey) || [];
      arr.push({ id: rec.productId, name: rec.name });
      fuzzy.set(fkey, arr);
    }
  }
  rl.close();

  // ---- pass 2: secondary (detail-page) verification for flagged records ----
  let verifiedFromDetail = 0;
  const detailFailures = [];
  if (CONFIG.verify) {
    const candidates = [...products.values()]
      .filter((r) => r.validation.status === 'NEEDS_RECHECK')
      .sort((a, b) => a.productId - b.productId)
      .slice(0, CONFIG.maxVerify);
    if (candidates.length) {
      log(`secondary verification: re-checking up to ${candidates.length} flagged product(s) on ${SITE_ORIGIN} (cap: --max-verify)`);
      for (const rec of candidates) {
        if (stopping) break;
        try {
          const detail = await verifyFromDetailPage(rec);
          applyDetailVerification(rec, detail);
          verifiedFromDetail++;
        } catch (e) {
          detailFailures.push({ productId: rec.productId, name: rec.name, error: String(e.message || e) });
          rec.validation.issues.push(`detail-page verification failed: ${e.message}`);
        }
        await saveCheckpoint();
      }
      log(`secondary verification: ${verifiedFromDetail} record(s) re-checked, ${detailFailures.length} verification failure(s)`);
    }
  }

  // ---- price rows, history, counters --------------------------------------
  const priceRows = new Map();
  const historyEntries = [];
  let newProducts = 0, updatedProducts = 0, unchangedProducts = 0;
  let missingPrices = 0, missingImages = 0;
  const statusCounts = { VERIFIED: 0, PARTIALLY_VERIFIED: 0, NEEDS_RECHECK: 0, FAILED: 0 };
  const needsRecheckList = [];
  const failedList = [];
  let conflictCount = 0;

  for (const rec of products.values()) {
    priceRows.set(rec.productId, buildPriceRow(rec));
    const prev = prevPrices.get(rec.productId);
    if (!prev) newProducts++;
    else if (priceChanged(prev, priceRows.get(rec.productId))) updatedProducts++;
    else unchangedProducts++;

    const row = buildPriceRow(rec);
    const entry = prev ? buildHistoryEntry(rec, prev, row) : null;
    if (entry) historyEntries.push(entry);

    const st = rec.validation.status;
    statusCounts[st] = (statusCounts[st] || 0) + 1;
    const allPricesMissing = [rec.prices.regularBase, rec.prices.offerBase, rec.prices.regularSales, rec.prices.offerSales].every((v) => v == null);
    if (allPricesMissing) missingPrices++;
    if (!rec.image.available || !rec.image.urlValid) missingImages++;
    conflictCount += rec.validation.conflicts.length;
    if (st === 'NEEDS_RECHECK') needsRecheckList.push({ productId: rec.productId, name: rec.name, issues: rec.validation.issues, conflicts: rec.validation.conflicts });
    if (st === 'FAILED') failedList.push({ productId: rec.productId, name: rec.name, issues: rec.validation.issues });
  }

  let droppedProducts = 0;
  for (const prevId of prevPrices.keys()) if (!products.has(prevId)) droppedProducts++;

  // fuzzy duplicate groups (distinct product IDs sharing the same fingerprint)
  const duplicateCandidates = [];
  for (const [key, arr] of fuzzy) {
    if (arr.length > 1) {
      const ids = [...new Set(arr.map((x) => x.id))];
      if (ids.length > 1) duplicateCandidates.push({ fingerprint: key, productIds: ids, products: arr.slice(0, 10) });
    }
  }

  log(`records: ${products.size} unique product IDs from ${rawLines} raw lines (${corruptLines} corrupt, ${[...dupRaw.values()].reduce((s, d) => s + d.occurrences - 1, 0)} duplicate lines)`);

  return {
    products, priceRows, prevPrices, historyEntries, prevHistory,
    companies, generics, catCounts, typeCounts, formCounts,
    webRows, companyDict, genericDict, formDict, typeDict,
    dupRaw, duplicateCandidates, corruptLines, rawLines,
    counts: { newProducts, updatedProducts, unchangedProducts, missingPrices, missingImages, statusCounts, needsRecheckList, failedList, conflictCount, droppedProducts, verifiedFromDetail, detailFailures },
    types, siteCategories,
    needsRecheckList, failedList,
  };
}

/* ============================ OUTPUT WRITERS ============================== */

async function writeProductsJson(products) {
  const file = dataPath('products.json');
  const tmp = file + '.tmp';
  const ws = fs.createWriteStream(tmp, 'utf8');
  ws.write(`{"generatedAt":${JSON.stringify(new Date().toISOString())},"runId":${JSON.stringify(checkpoint.runId)},"count":${products.size},"products":[`);
  let first = true;
  for (const rec of products.values()) {
    ws.write((first ? '' : ',') + JSON.stringify(rec));
    first = false;
    if (ws.writableLength > 4 * 1024 * 1024) await new Promise((r) => ws.once('drain', r));
  }
  ws.write(']}');
  await new Promise((r) => ws.end(r));
  fs.renameSync(tmp, file);
}

const CSV_COLUMNS = [
  'product_id', 'name', 'name_bn', 'product_type', 'generic_id', 'generic_name',
  'company_id', 'company_name', 'manufacturer_id', 'manufacturer_name',
  'category_id', 'dosage_form', 'strength', 'prescription_required',
  'active_status', 'stock_status', 'allow_sales',
  'base_unit', 'base_unit_multiplier', 'sales_unit', 'sales_unit_multiplier',
  'regular_price_base_unit', 'offer_price_base_unit',
  'regular_price_sales_unit', 'offer_price_sales_unit',
  'discount_percent', 'min_qty', 'max_qty', 'price_source',
  'primary_variant_id', 'variant_count', 'strip_quantity', 'box_quantity',
  'image_available', 'image_url', 'image_title',
  'validation_status', 'last_verified_at', 'product_url',
];

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function writeProductsCsv(products) {
  const file = dataPath('products.csv');
  const tmp = file + '.tmp';
  const ws = fs.createWriteStream(tmp, 'utf8');
  ws.write(CSV_COLUMNS.join(',') + '\n');
  let buf = '';
  for (const rec of products.values()) {
    const p = rec.prices;
    const baseVar = rec.variants.find((v) => v.isBase) || rec.variants[0];
    const row = [
      rec.productId, rec.name, rec.nameBn, rec.productType, rec.genericId, rec.genericName,
      rec.manufacturerId, rec.manufacturerName, rec.manufacturerId, rec.manufacturerName,
      rec.categoryId, rec.dosageForm, rec.strength, rec.prescriptionRequired ? 'yes' : 'no',
      rec.productStatus, rec.stockStatus, rec.allowSales ? 'yes' : 'no',
      p.baseUnit, p.baseUnitMultiplier, p.salesUnit, p.salesUnitMultiplier,
      p.regularBase, p.offerBase, p.regularSales, p.offerSales,
      p.discountPercent, p.minQty, p.maxQty, p.source,
      baseVar ? baseVar.variantId : null, rec.variants.length, rec.packaging.stripQuantity, rec.packaging.boxQuantity,
      rec.image.available ? 'yes' : 'no', rec.image.url, rec.image.title,
      rec.validation.status, rec.validation.checkedAt, rec.productUrl,
    ].map(csvEscape).join(',');
    buf += row + '\n';
    if (buf.length > 4 * 1024 * 1024) { ws.write(buf); buf = ''; await new Promise((r) => ws.once('drain', r)); }
  }
  ws.write(buf);
  await new Promise((r) => ws.end(r));
  fs.renameSync(tmp, file);
}

function imageKeyFromUrl(u) {
  if (!u || typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    if (/cdn\d*\.arogga\.com$/.test(url.hostname) && /^\/[A-Za-z0-9+/=_-]+$/.test(url.pathname)) {
      const json = Buffer.from(url.pathname.slice(1), 'base64').toString('utf8');
      const o = JSON.parse(json);
      if (o && o.key) return o.key; // client rebuilds the CDN URL from this key
    }
  } catch { /* fall through */ }
  return u; // not decodable — keep the full URL
}

const STATUS_CODE = { VERIFIED: 0, PARTIALLY_VERIFIED: 1, NEEDS_RECHECK: 2, FAILED: 3 };

const itemsOf = (dictMap) => [...dictMap.values()].map((e) => e.items[0] || { id: null, name: null });

function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

/* ============================ FINAL REPORTS =============================== */

async function assembleOutputs(consolidated, discovery, capped, t0) {
  const { products, priceRows, historyEntries, prevHistory, companies, generics, typeCounts, formCounts, catCounts, dupRaw, duplicateCandidates, counts, types, siteCategories } = consolidated;
  log('writing data files (atomic)...');

  await writeProductsJson(products);
  await writeProductsCsv(products);

  const nowIso = new Date().toISOString();
  await atomicWriteJson(dataPath('prices.json'), {
    generatedAt: nowIso, runId: checkpoint.runId, count: priceRows.size,
    note: 'regular = MRP, offer = current B2C discounted price. base/sales are different units — never interchangeable.',
    items: [...priceRows.values()],
  });

  await atomicWriteJson(dataPath('price-history.json'), {
    generatedAt: nowIso, runId: checkpoint.runId, totalEntries: prevHistory.length + historyEntries.length,
    entries: [...prevHistory, ...historyEntries],
  });

  const companiesSorted = [...companies.values()].filter((c) => c.name).sort((a, b) => b.productCount - a.productCount || (a.id || 0) - (b.id || 0));
  await atomicWriteJson(dataPath('companies.json'), { generatedAt: nowIso, count: companiesSorted.length, companies: companiesSorted });

  const genericsSorted = [...generics.values()].filter((g) => g.name).sort((a, b) => b.productCount - a.productCount || (a.id || 0) - (b.id || 0));
  await atomicWriteJson(dataPath('generics.json'), { generatedAt: nowIso, count: genericsSorted.length, generics: genericsSorted });

  const categories = (siteCategories || []).map((c) => ({ id: c.id, name: c.name, type: c.type, slug: c.slug, productCount: catCounts.get(c.id) || 0 }));
  const knownIds = new Set(categories.map((c) => c.id));
  for (const [id, count] of [...catCounts.entries()].sort((a, b) => a.id - b.id)) {
    if (!knownIds.has(id)) categories.push({ id, name: null, type: null, slug: null, productCount: count });
  }
  await atomicWriteJson(dataPath('categories.json'), {
    generatedAt: nowIso,
    source: 'category ids/names harvested from public arogga.com category pages; productCount derived from crawled product data',
    discoveredTypes: (types || []).map((t) => ({ ...t, crawledCount: typeCounts.get(t.key) || 0 })),
    crawledForms: [...formCounts.entries()].sort((a, b) => b[1] - a[1]).map(([form, count]) => ({ form, count })),
    count: categories.length,
    categories,
  });

  const images = [];
  for (const rec of products.values()) {
    images.push({ productId: rec.productId, name: rec.name, available: rec.image.available, url: rec.image.url, title: rec.image.title, posterUrl: rec.image.posterUrl, urlValid: rec.image.urlValid });
  }
  await atomicWriteJson(dataPath('images.json'), { generatedAt: nowIso, count: images.length, images });

  // ---- validation report ---------------------------------------------------
  const conflictsList = [];
  for (const rec of products.values()) {
    for (const c of rec.validation.conflicts) conflictsList.push({ productId: rec.productId, name: rec.name, ...c });
  }
  const validationReport = {
    generatedAt: nowIso, runId: checkpoint.runId,
    summary: {
      totalProducts: products.size,
      ...counts.statusCounts,
      missingPrices: counts.missingPrices,
      missingImages: counts.missingImages,
      priceUnitConflicts: counts.conflictCount,
      duplicateRawRecordLines: [...dupRaw.values()].reduce((s, d) => s + d.occurrences - 1, 0),
      duplicateCandidateGroups: duplicateCandidates.length,
      corruptLines: consolidated.corruptLines,
      detailVerifications: counts.verifiedFromDetail,
    },
    statuses: {
      VERIFIED: 'all core fields + prices + units + image present and sane',
      PARTIALLY_VERIFIED: 'record usable, minor gaps (see issues)',
      NEEDS_RECHECK: 'price anomaly / all prices missing / API-vs-detail conflict',
      FAILED: 'record structurally broken (no id or name)',
    },
    needsRecheck: counts.needsRecheckList,
    failedRecords: counts.failedList,
    conflicts: conflictsList,
    duplicateRawRecords: [...dupRaw.entries()].map(([productId, d]) => ({ productId, occurrences: d.occurrences, pages: [...d.pages] })),
    duplicateCandidates: duplicateCandidates.slice(0, 5000),
    duplicateCandidatesTruncated: duplicateCandidates.length > 5000,
  };
  await atomicWriteJson(dataPath('validation-report.json'), validationReport);

  // ---- failed records ------------------------------------------------------
  const failures = collectFailures();
  await atomicWriteJson(dataPath('failed-records.json'), {
    generatedAt: nowIso, runId: checkpoint.runId,
    pages: failures,
    coverageGaps: checkpoint.bucketGaps || [],
    records: counts.failedList,
    detailVerificationFailures: counts.detailFailures,
  });

  // ---- crawl report --------------------------------------------------------
  const stats = crawlStats();
  const processedPages = stats.completedPages;
  const failedPagesCount = failures.filter((f) => !f.bucketKey.startsWith('sweep:')).length;
  // In single-category mode the coverage baseline is the planned bucket rows,
  // not the global catalogue total.
  const expectedIds = CONFIG.category ? Math.max(1, stats.rowsExpected) : discovery.total;
  const completionPct = stats.plannedPages ? round2((processedPages / stats.plannedPages) * 100) : 0;
  const idCoveragePct = expectedIds ? round2((products.size / expectedIds) * 100) : 0;
  // Full coverage: every planned page processed AND unique ids within 0.5% of
  // the source total (the reconciliation pass closes sitemap-level gaps).
  const fullCoverage = failedPagesCount === 0 && products.size >= Math.floor(expectedIds * 0.995);
  const reportStats = {
    completion: { processedPages, capped: stats.plannedPages, completionPct, idCoveragePct, fullCoverage },
  };

  const dataFiles = {};
  for (const f of ['products.json', 'products.jsonl', 'products.csv', 'prices.json', 'price-history.json', 'companies.json', 'generics.json', 'categories.json', 'images.json', 'crawl-progress.json', 'failed-records.json', 'validation-report.json']) {
    const p = dataPath(f);
    dataFiles[f] = fs.existsSync(p) ? { bytes: fs.statSync(p).size, human: fmtBytes(fs.statSync(p).size) } : { bytes: 0, human: '0 B' };
  }

  const crawlReport = {
    generatedAt: nowIso, runId: checkpoint.runId, version: VERSION,
    mode: checkpoint.mode, startedAt: checkpoint.startedAt, finishedAt: nowIso,
    durationMs: Date.now() - t0, durationHuman: `${Math.round((Date.now() - t0) / 1000)}s`,
    config: {
      perPage: CONFIG.perPage, concurrency: CONFIG.concurrency, rateMs: CONFIG.rateMs,
      timeoutMs: CONFIG.timeoutMs, retries: CONFIG.retries, category: CONFIG.category,
      maxPages: CONFIG.maxPages || null, secondaryVerification: CONFIG.verify,
      maxVerificationsPerRun: CONFIG.maxVerify,
    },
    totalPagesDiscovered: capped,
    totalPagesProcessed: processedPages,
    totalPagesFailed: failedPagesCount,
    totalBuckets: stats.bucketCount,
    totalRowsExpectedInBuckets: stats.rowsExpected,
    coverageGaps: checkpoint.bucketGaps || [],
    reconciliation: checkpoint.reconcile || null,
    totalProductsDiscovered: discovery.total,
    uniqueProductsCollected: products.size,
    rawRecordLines: consolidated.rawLines,
    newProducts: counts.newProducts,
    updatedProducts: counts.updatedProducts,
    unchangedProducts: counts.unchangedProducts,
    productsDroppedSinceLastRun: counts.droppedProducts,
    duplicateCandidateGroups: duplicateCandidates.length,
    duplicateRawRecordLines: validationReport.summary.duplicateRawRecordLines,
    failedProducts: counts.statusCounts.FAILED || 0,
    verifiedProducts: counts.statusCounts.VERIFIED || 0,
    partiallyVerifiedProducts: counts.statusCounts.PARTIALLY_VERIFIED || 0,
    needsRecheckProducts: counts.statusCounts.NEEDS_RECHECK || 0,
    productsMissingPrices: counts.missingPrices,
    productsMissingImages: counts.missingImages,
    priceHistoryEntriesAppended: historyEntries.length,
    priceHistoryTotalEntries: prevHistory.length + historyEntries.length,
    apiRequests: httpStats.requests,
    apiRetries: httpStats.retries,
    apiRateLimited: httpStats.rateLimited,
    completionPercent: completionPct,
    idCoveragePercent: idCoveragePct,
    fullCoverageAchieved: fullCoverage,
    coverageNote: fullCoverage
      ? 'All discoverable pages were processed and validated; unique product IDs matched the API-reported total within tolerance.'
      : 'NOT full coverage — see totalPagesFailed / completionPercent. The system never claims full coverage unless every discovered page was processed and verified.',
    dataFiles,
  };
  await atomicWriteJson(dataPath('crawl-report.json'), crawlReport);

  // ---- static platform bundles (front-end dataset, file API, SEO) ----------
  await writeStaticPlatformBundles(consolidated, discovery, capped, crawlReport, categories);

  return { crawlReport, reportStats };
}

/* ============================ CONSOLE SUMMARY ============================= */

function printSummary(cr, t0) {
  const line = (k, v) => console.log(`  ${k.padEnd(34)} ${v}`);
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║            BANGLADESH MEDICINE PRICE DATABASE — CRAWL REPORT     ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  line('Total pages discovered', cr.totalPagesDiscovered);
  line('Crawl buckets', cr.totalBuckets);
  line('Total pages processed', `${cr.totalPagesProcessed} (${cr.completionPercent}% completion)`);
  line('Total pages failed', cr.totalPagesFailed);
  line('Coverage gaps', (cr.coverageGaps || []).length);
  line('Reconciliation (sitemap)', cr.reconciliation ? `${cr.reconciliation.fetched} recovered of ${cr.reconciliation.missing} missing` : 'n/a');
  line('Products discovered (API total)', cr.totalProductsDiscovered);
  line('Unique products collected', `${cr.uniqueProductsCollected} (ID coverage ${cr.idCoveragePercent}%)`);
  line('New products', cr.newProducts);
  line('Updated products (price changed)', cr.updatedProducts);
  line('Unchanged products', cr.unchangedProducts);
  line('Duplicate candidate groups', cr.duplicateCandidateGroups);
  line('Duplicate raw record lines', cr.duplicateRawRecordLines);
  line('Failed products', cr.failedProducts);
  line('Verified products', cr.verifiedProducts);
  line('Partially verified products', cr.partiallyVerifiedProducts);
  line('Needs-recheck products', cr.needsRecheckProducts);
  line('Products missing prices', cr.productsMissingPrices);
  line('Products missing images', cr.productsMissingImages);
  line('Price-history entries appended', cr.priceHistoryEntriesAppended);
  line('API requests / retries', `${cr.apiRequests} / ${cr.apiRetries}`);
  line('Full coverage achieved', cr.fullCoverageAchieved ? 'YES — all pages processed & verified' : 'NO — ' + cr.coverageNote);
  line('Total execution time', cr.durationHuman);
  console.log('\nData files: ' + Object.keys(cr.dataFiles).map((f) => `${f} (${cr.dataFiles[f].human})`).join(', '));
  console.log('Web app: web/index.html + web/assets/js/db/* bundles — open web/index.html or serve web/ statically.\n');
}

/* ================================= MAIN =================================== */

async function main() {
  T0 = Date.now();
  const t0 = T0;
  console.log(`Bangladesh Medicine Price Database — scraper v${VERSION} (Node ${process.version})`);
  console.log(`config: perPage=${CONFIG.perPage} concurrency=${CONFIG.concurrency} rateMs=${CONFIG.rateMs} timeout=${CONFIG.timeoutMs}ms retries=${CONFIG.retries} category=${CONFIG.category || 'all'} fresh=${CONFIG.fresh}`);
  await ensureDirs();

  if (ARGV['rebuild-web']) { await rebuildWebOnly(); }

  const existing = loadCheckpoint();
  const resumable = !CONFIG.fresh && existing && existing.incomplete;
  if (resumable && existing.perPage !== CONFIG.perPage) {
    warn('checkpoint was created with a different --per-page; starting a fresh run instead of resuming');
  }
  const canResume = resumable && existing.perPage === CONFIG.perPage;

  let discovery;
  if (canResume) {
    checkpoint = existing;
    discovery = { total: checkpoint.globalTotal, types: checkpoint.types || [], siteCategories: checkpoint.siteCategories || [] };
    log(`resuming interrupted run ${checkpoint.runId}`);
  } else {
    checkpoint = newCheckpoint();
    discovery = await runDiscoveryPhase();
    discovery = { total: checkpoint.globalTotal, types: checkpoint.types, siteCategories: checkpoint.siteCategories };
    await saveCheckpoint(true);
  }

  // Graceful interruption: SIGINT / SIGTERM — finish the current request,
  // persist the checkpoint, and exit without corrupting any data file.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      if (stopping) { console.error('\nForced exit.'); process.exit(130); }
      stopping = true;
      log(`\n${sig} received — saving checkpoint and shutting down gracefully (re-run node scrape.js to resume)...`);
    });
  }

  // Phase 2: sweep page 1 of every category (resumable per category).
  const sweepRes = await runSweepPhase(discovery.siteCategories);
  if (sweepRes.interrupted) {
    await atomicWriteJson(dataPath('failed-records.json'), {
      generatedAt: nowIso(), runId: checkpoint.runId,
      pages: collectFailures(), records: [], note: 'run interrupted before bucket planning',
    });
    log('interrupted during sweep. Nothing was overwritten; re-run node scrape.js to resume.');
    process.exit(130);
  }

  // Phase 3: plan crawl buckets (idempotent, cached in checkpoint).
  planBuckets();
  await saveCheckpoint(true);

  // Phase 4: crawl every bucket page (resumable per page).
  const crawlRes = await runBucketCrawl();
  if (crawlRes.interrupted) {
    await atomicWriteJson(dataPath('failed-records.json'), {
      generatedAt: nowIso(), runId: checkpoint.runId,
      pages: collectFailures(), records: [], note: 'run interrupted before consolidation',
    });
    const stats = crawlStats();
    log(`interrupted: ${stats.completedPages}/${stats.plannedPages} bucket pages complete. Nothing was overwritten; re-run node scrape.js to resume.`);
    process.exit(130);
  }

  const capped = crawlStats().plannedPages;
  // Phase 5: reconcile against the public product sitemaps — fetch any product
  // that the category buckets could not reach, from its own public page.
  try {
    await runReconcilePhase();
  } catch (e) {
    warn(`reconciliation failed entirely: ${e.message}`);
  }

  const consolidated = await consolidate({ total: discovery.total, totalPages: capped, types: discovery.types, siteCategories: discovery.siteCategories });
  const { crawlReport } = await assembleOutputs(consolidated, discovery, capped, t0);

  checkpoint.incomplete = crawlReport.totalPagesFailed > 0 || !crawlReport.fullCoverageAchieved;
  checkpoint.stats.finalProducts = crawlReport.uniqueProductsCollected;
  await saveCheckpoint(true);

  // Phase-9 integration hook (optional, env-gated, non-blocking): report the
  // completed run to a Medora ingestion endpoint. A failed POST never fails
  // the crawl. Record-level ingestion uses POST /api/v1/ingest/records.
  if (process.env.MEDORA_INGEST_URL && process.env.MEDORA_INGEST_TOKEN) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${process.env.MEDORA_INGEST_URL.replace(/\/+$/, '')}/api/v1/ingest/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MEDORA_INGEST_TOKEN}` },
        body: JSON.stringify({
          runId: crawlReport.runId,
          mode: crawlReport.mode,
          status: crawlReport.fullCoverageAchieved ? 'completed' : 'partial',
          startedAt: crawlReport.startedAt,
          finishedAt: crawlReport.finishedAt,
          durationMs: crawlReport.durationMs,
          apiRequests: crawlReport.apiRequests,
          pagesDiscovered: crawlReport.totalPagesDiscovered,
          pagesProcessed: crawlReport.totalPagesProcessed,
          productsCollected: crawlReport.uniqueProductsCollected,
          coveragePct: crawlReport.idCoveragePercent,
          fullCoverage: crawlReport.fullCoverageAchieved,
          stats: crawlReport,
          coverageGaps: crawlReport.coverageGaps || [],
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      log(res.ok ? 'run summary posted to Medora ingestion endpoint' : `ingest endpoint returned HTTP ${res.status} (non-fatal)`);
    } catch (e) {
      warn(`Medora ingest hook failed (non-fatal): ${e.message}`);
    }
  }

  printSummary(crawlReport, t0);
  if (!crawlReport.fullCoverageAchieved) {
    warn('run finished WITHOUT full coverage — re-run `node scrape.js` to retry failed pages.');
    process.exitCode = 2;
  }
  // Signal watchers (SIGINT/SIGTERM handlers) keep the Node event loop alive;
  // exit explicitly once everything is flushed to disk.
  process.exit(process.exitCode || 0);
}

main().catch((e) => {
  errLog('fatal:', e && e.stack ? e.stack : e);
  process.exit(1);
});

/* ============= STATIC PLATFORM BUNDLE GENERATOR (web/, api/, SEO) ========== */

const PLATFORM_SCHEMA = 3;
const CHUNK_SIZE = 1000;
const PRERENDER_LIMIT = 200;
const PRERENDER_DIRECTORY_LIMIT = 1000;   // company pages (all, capped)
const PRERENDER_CATEGORY_LIMIT = 150;     // category pages (top by products)
const API_PAGE_SIZE = 100;
const API_PAGE_CAP = 30;                  // static file API pagination cap

const PLATFORM_ROW_SCHEMA = ['id', 'name', 'nameBn', 'genericIdx', 'companyIdx', 'formIdx', 'typeIdx', 'categoryId', 'strength', 'rxRequired', 'imageKeyOrUrl', 'regularBase', 'offerBase', 'regularSales', 'offerSales', 'discountPercent', 'baseUnit', 'salesUnit', 'salesUnitMultiplier', 'verifiedDay', 'statusCode', 'createdDay', 'orderedCount'];

function slugLatin(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function tokenizeForIndex(text) {
  return String(text || '').toLowerCase()
    .split(/[^a-z0-9\u0980-\u09FF]+/)
    .filter((t) => t.length >= 2 && t.length <= 40);
}

function buildPlatformRow(rec) {
  const p = rec.prices;
  const day = (rec.validation.checkedAt || '').slice(0, 10).replace(/-/g, '');
  return [
    rec.productId, rec.name, rec.nameBn || null,
    rec._webGenIdx ?? null, rec._webCompIdx ?? null, rec._webFormIdx ?? null, rec._webTypeIdx ?? null,
    rec.categoryId, rec.strength || null, rec.prescriptionRequired ? 1 : 0,
    imageKeyFromUrl(rec.image.url || rec.image.posterUrl),
    p.regularBase, p.offerBase, p.regularSales, p.offerSales, p.discountPercent,
    p.baseUnit || null, p.salesUnit || null, p.salesUnitMultiplier ?? null,
    Number(day) || null, STATUS_CODE[rec.validation.status] ?? 1,
    (rec.createdAt || '').slice(0, 10).replace(/-/g, '') || null,
    rec.orderedCount ?? 0,
  ];
}

function buildSlugs(products, sortedIds) {
  const slugById = new Map();
  const used = new Set();
  for (const id of sortedIds) {
    const rec = products.get(id);
    const candidates = [
      slugLatin([rec.name, rec.dosageForm].filter(Boolean).join(' ')),
      slugLatin([rec.name, rec.strength, rec.dosageForm].filter(Boolean).join(' ')),
      slugLatin(rec.name || ''),
    ].filter(Boolean);
    let slug = null;
    for (const c of candidates) { if (!used.has(c)) { slug = c; break; } }
    if (!slug) {
      const base = candidates[0] || 'medicine';
      for (let i = 2; i < 1000; i++) { if (!used.has(`${base}-${i}`)) { slug = `${base}-${i}`; break; } }
    }
    if (!slug) slug = `medicine-${id}`;
    used.add(slug);
    slugById.set(id, slug);
  }
  return slugById;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function writeJs(file, varExpr, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, `/* AUTO-GENERATED by scrape.js — Bangladesh Medicine Price Database.\n   Regenerate with: node scrape.js --rebuild-web */\n${varExpr}=${JSON.stringify(value)};\n`);
  fs.renameSync(tmp, file);
}

function renderSeoPage({ title, description, canonicalPath, jsonLd, bodyHtml, backLink }) {
  const base = CONFIG.siteBase.replace(/\/$/, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${base}${canonicalPath}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${base}${canonicalPath}">
<meta name="robots" content="index,follow">
<style>
:root{--bg:#fff;--fg:#17211C;--muted:#718078;--primary:#16A36A;--surface:#F8FAF9;--border:#E5ECE7;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0B0F0D;--fg:#E9F1EC;--muted:#9AA99F;--surface:#111916;--border:#25332C;--card:#111916;--primary:#36D995}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Bengali",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:720px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:1.75rem;line-height:1.25;margin:.2em 0 .4em;letter-spacing:-.02em}
table{width:100%;border-collapse:collapse;margin:16px 0;background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;font-variant-numeric:tabular-nums}
td,th{padding:10px 14px;border-bottom:1px solid var(--border);text-align:left;font-size:.95rem}
tr:last-child td{border-bottom:0}.k{color:var(--muted);width:44%}
.price{font-weight:700;color:var(--primary)}
a{color:var(--primary);text-decoration:none}a:hover{text-decoration:underline}
.badge{display:inline-block;background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:2px 10px;font-size:.8rem;color:var(--muted);margin-right:6px}
.foot{margin-top:28px;padding-top:16px;border-top:1px solid var(--border);color:var(--muted);font-size:.85rem}
</style>
</head>
<body>
<main>
${backLink ? `<p><a href="${backLink.href}">← ${escapeHtml(backLink.label)}</a></p>` : ''}
${bodyHtml}
<div class="foot">Data source: <a href="https://www.arogga.com" rel="nofollow">Arogga</a> public catalogue. Price catalogue only — not medical advice, not a prescription service. <a href="${backLink ? backLink.href.replace(/\/m\/.*/, '/') : '/'}">Open interactive catalogue</a>.</div>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</main>
</body>
</html>
`;
}

function productJsonLd(rec, slug) {
  const base = CONFIG.siteBase.replace(/\/$/, '');
  const offer = rec.prices.offerBase != null && rec.prices.regularBase != null && rec.prices.offerBase < rec.prices.regularBase;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: rec.name,
    category: rec.dosageForm || undefined,
    brand: rec.manufacturerName ? { '@type': 'Brand', name: rec.manufacturerName } : undefined,
    url: `${base}/m/${slug}`,
  };
  if (rec.image.url) ld.image = rec.image.url;
  const price = offer ? rec.prices.offerBase : rec.prices.regularBase;
  if (price != null) {
    ld.offers = {
      '@type': 'Offer',
      price: Number(price),
      priceCurrency: 'BDT',
      url: `${base}/m/${slug}`,
    };
    if (offer && rec.prices.regularBase) ld.offers.priceSpecification = undefined; // never invent discount schema values
  }
  return ld;
}

async function writeStaticPlatformBundles(consolidated, discovery, capped, crawlReport, categories) {
  const tb = Date.now();
  log('── Static platform bundles (web app dataset, file API, SEO) ──────');
  const { products, priceRows, historyEntries, prevHistory, companies, generics, formCounts, typeCounts, counts, types, companyDict, genericDict, formDict, typeDict } = consolidated;
  const nowIso = new Date().toISOString();
  const sortedIds = [...products.keys()].sort((a, b) => a - b);
  const DB_DIR = path.join(WEB_JS_DIR, 'db');
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  fs.mkdirSync(DB_DIR, { recursive: true });

  /* ---- deterministic unique slugs (never change when prices change) ---- */
  const slugById = buildSlugs(products, sortedIds);

  /* ---- search index: token postings + facet specials ---- */
  const postings = new Map();
  const special = new Map();
  const addPost = (tok, id) => { let s = postings.get(tok); if (!s) { s = new Set(); postings.set(tok, s); } s.add(id); };
  const addSpec = (key, id) => { let s = special.get(key); if (!s) { s = new Set(); special.set(key, s); } s.add(id); };
  let offerCount = 0, rxCount = 0, verifiedCount = 0;
  for (const id of sortedIds) {
    const rec = products.get(id);
    for (const tk of tokenizeForIndex(rec.name)) addPost(tk, id);
    for (const tk of tokenizeForIndex(rec.genericName)) addPost(tk, id);
    for (const tk of tokenizeForIndex(rec.manufacturerName)) addPost(tk, id);
    for (const tk of tokenizeForIndex(rec.strength)) { addPost(tk, id); const m = /^(\d+)/.exec(tk); if (m) addPost(m[1], id); }
    for (const tk of tokenizeForIndex(rec.dosageForm)) addPost(tk, id);
    for (const tk of tokenizeForIndex(rec.nameBn)) addPost(tk, id);
    addSpec(`@co:${rec.manufacturerId != null ? rec.manufacturerId : 'x'}`, id);
    if (rec.genericId != null) addSpec(`@gen:${rec.genericId}`, id);
    if (rec.categoryId != null) addSpec(`@cat:${rec.categoryId}`, id);
    if (rec.dosageForm) addSpec(`@form:${slugLatin(rec.dosageForm)}`, id);
    if (rec.productType) addSpec(`@type:${rec.productType}`, id);
    if (rec.prescriptionRequired) { addSpec('@rx', id); rxCount++; }
    const hasOffer = (rec.prices.offerBase != null && rec.prices.regularBase != null && rec.prices.offerBase < rec.prices.regularBase)
      || (rec.prices.offerSales != null && rec.prices.regularSales != null && rec.prices.offerSales < rec.prices.regularSales);
    if (hasOffer) { addSpec('@offer', id); offerCount++; }
    if (rec.validation.status === 'VERIFIED') verifiedCount++;
  }

  /* ---- product chunks (lazy-loaded rows) ---- */
  const chunks = [];
  for (let i = 0; i * CHUNK_SIZE < sortedIds.length; i++) {
    const slice = sortedIds.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const rows = slice.map((id) => buildPlatformRow(products.get(id)));
    const file = `chunk-${String(i).padStart(3, '0')}.js`;
    const f = path.join(DB_DIR, file);
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, `window.MDB_CHUNKS[${i}]=${JSON.stringify(rows)};\n`);
    fs.renameSync(tmp, f);
    chunks.push({ file, i, from: slice[0], to: slice[slice.length - 1], count: slice.length });
  }

  /* ---- meta / dicts / index / slugs / history ---- */
  const vDay = (rec) => Number((rec.validation.checkedAt || '').slice(0, 10).replace(/-/g, '')) || 0;
  const popular = [...products.values()].sort((a, b) => (b.orderedCount || 0) - (a.orderedCount || 0)).slice(0, 40).map((r) => r.productId);
  const recentUpdated = sortedIds.map((id) => products.get(id)).sort((a, b) => vDay(b) - vDay(a) || b.productId - a.productId).slice(0, 300).map((r) => r.productId);
  const recentAdded = [...products.values()].filter((r) => r.createdAt).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 300).map((r) => r.productId);

  const meta = {
    schema: PLATFORM_SCHEMA,
    generatedAt: nowIso,
    runId: checkpoint.runId,
    totalProducts: products.size,
    offerCount, rxCount, verifiedCount,
    companiesCount: companies.size,
    genericsCount: generics.size,
    categoriesCount: categories.length,
    formsCount: formCounts.size,
    chunkSize: CHUNK_SIZE,
    chunks,
    tokens: [...postings.keys()].sort(),
    popular, recentUpdated, recentAdded,
    productSchema: PLATFORM_ROW_SCHEMA,
    currency: 'BDT (৳)',
    source: 'Arogga public catalogue — https://www.arogga.com',
    apiEndpoint: API_SEARCH_URL,
    siteBase: CONFIG.siteBase,
    redirects: {}, // reserved: old-slug → canonical slug map
    completion: {
      processedPages: crawlReport.totalPagesProcessed,
      capped,
      completionPct: crawlReport.completionPercent,
      idCoveragePct: crawlReport.idCoveragePercent,
      fullCoverage: crawlReport.fullCoverageAchieved,
    },
  };
  writeJs(path.join(DB_DIR, 'meta.js'), 'window.MDB_META', meta);

  const companiesSorted = [...companies.values()].filter((c) => c.name).sort((a, b) => b.productCount - a.productCount || (a.id || 0) - (b.id || 0));
  const genericsSorted = [...generics.values()].filter((g) => g.name).sort((a, b) => b.productCount - a.productCount || (a.id || 0) - (b.id || 0));
  // Dictionaries for the web app MUST be in index (insertion) order — product
  // rows reference entries by index. Counts are zipped positionally: the dict
  // and the aggregate map are filled in the same per-record order.
  const zipDict = (dictMap, srcMap) => {
    const items = [...dictMap.values()].map((e) => e.items[0] || { id: null, name: null });
    const src = [...srcMap.values()];
    return items.map((it, i) => ({ id: it.id, name: it.name, productCount: (src[i] && src[i].productCount) || 0 }));
  };
  writeJs(path.join(DB_DIR, 'dicts.js'), 'window.MDB_DICTS', {
    companies: zipDict(companyDict, companies),
    generics: zipDict(genericDict, generics),
    forms: [...formDict.values()].map((e) => ({ name: e.items[0].name, productCount: formCounts.get(e.items[0].name) || 0 })),
    types: [...typeDict.values()].map((e) => ({ name: e.items[0].name, productCount: typeCounts.get(e.items[0].name) || 0 })),
    categories,
  });

  // Postings serialized manually (avoids one giant JSON.stringify).
  {
    const f = path.join(DB_DIR, 'index.js');
    const tmp = f + '.tmp';
    const ws = fs.createWriteStream(tmp, 'utf8');
    ws.write('/* AUTO-GENERATED by scrape.js — search postings index */\nwindow.MDB_INDEX={p:{');
    let first = true;
    let buf = '';
    for (const tok of tokensSorted(postings)) {
      buf += (first ? '' : ',') + JSON.stringify(tok) + ':' + JSON.stringify([...postings.get(tok)].sort((a, b) => a - b));
      first = false;
      if (buf.length > 2 * 1024 * 1024) { ws.write(buf); buf = ''; await new Promise((r) => ws.once('drain', r)); }
    }
    ws.write(buf + '},s:{');
    first = true; buf = '';
    for (const key of [...special.keys()].sort()) {
      buf += (first ? '' : ',') + JSON.stringify(key) + ':' + JSON.stringify([...special.get(key)].sort((a, b) => a - b));
      first = false;
      if (buf.length > 2 * 1024 * 1024) { ws.write(buf); buf = ''; await new Promise((r) => ws.once('drain', r)); }
    }
    ws.write(buf + '}};\n');
    await new Promise((r) => ws.end(r));
    fs.renameSync(tmp, f);
  }

  writeJs(path.join(DB_DIR, 'slugs.js'), 'window.MDB_SLUGS', { ids: sortedIds, slugs: sortedIds.map((id) => slugById.get(id)) });

  // Price history points (products with ≥2 recordings only; carry-forward).
  const hist = new Map();
  const ensurePts = (id) => { if (!hist.has(id)) hist.set(id, []); return hist.get(id); };
  for (const e of [...prevHistory, ...historyEntries]) {
    const pts = ensurePts(e.productId);
    const last = pts[pts.length - 1] || { rb: null, ob: null, rs: null, os: null };
    const pick = (field, cur) => { const c = (e.changes || []).find((ch) => ch.field === field); return c ? c.new : cur; };
    pts.push({ at: e.at, rb: pick('regular.base', last.rb), ob: pick('offer.base', last.ob), rs: pick('regular.sales', last.rs), os: pick('offer.sales', last.os) });
  }
  for (const [id, row] of priceRows) {
    const pts = ensurePts(id);
    const cur = { at: row.verifiedAt, rb: row.regular.base, ob: row.offer.base, rs: row.regular.sales, os: row.offer.sales };
    const last = pts[pts.length - 1];
    if (!last || last.at !== cur.at || last.rb !== cur.rb || last.ob !== cur.ob || last.rs !== cur.rs || last.os !== cur.os) pts.push(cur);
  }
  const histOut = {};
  for (const [id, pts] of hist) if (pts.length >= 2) histOut[id] = pts;
  writeJs(path.join(DB_DIR, 'history.js'), 'window.MDB_HISTORY', { entries: histOut, totalHistoryEntries: prevHistory.length + historyEntries.length });

  /* ---- reports bundle (admin / data dashboard) ---- */
  writeJs(path.join(WEB_JS_DIR, 'reports.js'), 'window.MDB_REPORTS', {
    generatedAt: nowIso,
    crawl: crawlReport,
    validation: {
      summary: {
        totalProducts: products.size,
        ...counts.statusCounts,
        missingPrices: counts.missingPrices,
        missingImages: counts.missingImages,
        priceUnitConflicts: counts.conflictCount,
        duplicateCandidateGroups: consolidated.duplicateCandidates.length,
        corruptLines: consolidated.corruptLines,
        detailVerifications: counts.verifiedFromDetail,
      },
      needsRecheckSample: counts.needsRecheckList.slice(0, 100),
      failedSample: counts.failedList.slice(0, 100),
      detailVerificationFailures: counts.detailFailures.slice(0, 50),
    },
    failedPages: collectFailures(),
  });

  /* ---- static read-only JSON API (web/api/v1) ---- */
  const API_DIR = path.join(WEB_DIR, 'api', 'v1');
  fs.rmSync(API_DIR, { recursive: true, force: true });
  fs.mkdirSync(API_DIR, { recursive: true });
  const apiNote = { datasetVersion: checkpoint.runId, generatedAt: nowIso, license: 'Catalogue data © respective manufacturers, collected from Arogga public API for personal/local price reference.' };
  const jw = (f, obj) => atomicWriteJson(path.join(API_DIR, f), obj);
  await jw('health.json', { status: 'ok', ...apiNote, dataset: { products: products.size, companies: companiesSorted.length, generics: genericsSorted.length, categories: categories.length, lastCrawl: checkpoint.startedAt, completion: meta.completion } });
  const metaNoTokens = { ...meta, tokens: undefined };
  await jw('meta.json', { ...apiNote, meta: metaNoTokens });
  await jw('companies.json', { ...apiNote, count: companiesSorted.length, items: companiesSorted });
  await jw('categories.json', { ...apiNote, count: categories.length, items: categories });

  const offerIds = [...(special.get('@offer') || [])].sort((a, b) => {
    const ra = priceRows.get(a), rb = priceRows.get(b);
    const da = ra && ra.offer.discountPercent != null ? ra.offer.discountPercent : 0;
    const db = rb && rb.offer.discountPercent != null ? rb.offer.discountPercent : 0;
    return db - da || a - b;
  });
  const pages = (ids, dir, name) => {
    const totalPages = Math.min(API_PAGE_CAP, Math.max(1, Math.ceil(ids.length / API_PAGE_SIZE)));
    for (let p = 1; p <= totalPages; p++) {
      const slice = ids.slice((p - 1) * API_PAGE_SIZE, p * API_PAGE_SIZE);
      const items = slice.map((id) => ({ ...rowToApiItem(products.get(id), slugById.get(id)), }));
      atomicWriteJson(path.join(API_DIR, dir, `page-${String(p).padStart(4, '0')}.json`), { ...apiNote, page: p, perPage: API_PAGE_SIZE, totalItems: ids.length, totalPagesGenerated: totalPages, truncated: ids.length > totalPages * API_PAGE_SIZE, items });
    }
    return totalPages;
  };
  fs.mkdirSync(path.join(API_DIR, 'offers'), { recursive: true });
  fs.mkdirSync(path.join(API_DIR, 'medicines'), { recursive: true });
  // Raw crawl/validation reports are part of the transparency story — bundle
  // them next to the API so the dashboard works from web/ alone.
  for (const f of ['crawl-report.json', 'validation-report.json', 'failed-records.json']) {
    const src = dataPath(f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(API_DIR, f));
  }
  const offerPages = pages(offerIds, 'offers', 'page');
  const medPages = pages(sortedIds, 'medicines', 'page');
  await jw('offers.json', { ...apiNote, totalOffers: offerIds.length, pagesGenerated: offerPages, perPage: API_PAGE_SIZE, truncated: offerIds.length > offerPages * API_PAGE_SIZE, _links: { pageTemplate: '/api/v1/offers/page-{page}.json' } });
  await jw('medicines.json', { ...apiNote, totalMedicines: sortedIds.length, pagesGenerated: medPages, perPage: API_PAGE_SIZE, truncated: sortedIds.length > medPages * API_PAGE_SIZE, _links: { pageTemplate: '/api/v1/medicines/page-{page}.json', medicine: '/api/v1/medicines/{id}.json' } });
  await writeOpenApiSpec(API_DIR, { products: products.size, companies: companiesSorted.length, generics: genericsSorted.length, categories: categories.length, offers: offerIds.length, offerPages, medPages });

  /* ---- sitemaps + robots ---- */
  const base = CONFIG.siteBase.replace(/\/$/, '');
  const SM_DIR = WEB_DIR;
  const urlsToXml = (urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`;
  const staticPaths = ['/', '/search', '/companies', '/categories', '/offers', '/api-docs', '/about'];
  fs.writeFileSync(path.join(SM_DIR, 'sitemap-static.xml'), urlsToXml(staticPaths.map((p) => base + p)));
  fs.writeFileSync(path.join(SM_DIR, 'sitemap-companies.xml'), urlsToXml(companiesSorted.filter((c) => c.id != null).slice(0, 2000).map((c) => `${base}/companies/${c.id}`)));
  const catUrls = categories.filter((c) => c.productCount > 0).slice(0, 500).map((c) => `${base}/categories/${c.id}`);
  fs.writeFileSync(path.join(SM_DIR, 'sitemap-categories.xml'), urlsToXml(catUrls));
  const PER_SITEMAP = 40000;
  const productSitemaps = [];
  for (let i = 0; i * PER_SITEMAP < sortedIds.length; i++) {
    const slice = sortedIds.slice(i * PER_SITEMAP, (i + 1) * PER_SITEMAP);
    const fname = `sitemap-products-${i + 1}.xml`;
    fs.writeFileSync(path.join(SM_DIR, fname), urlsToXml(slice.map((id) => `${base}/m/${slugById.get(id)}`)));
    productSitemaps.push(fname);
  }
  fs.writeFileSync(path.join(SM_DIR, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['sitemap-static.xml', 'sitemap-companies.xml', 'sitemap-categories.xml', ...productSitemaps].map((f) => `  <sitemap><loc>${base}/${f}</loc></sitemap>`).join('\n')}\n</sitemapindex>\n`);
  fs.writeFileSync(path.join(SM_DIR, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);

  /* ---- prerendered SEO pages: top medicines, companies, categories ---- */
  const M_DIR = path.join(WEB_DIR, 'm');
  fs.rmSync(M_DIR, { recursive: true, force: true });
  fs.mkdirSync(M_DIR, { recursive: true });
  const seeded = (r) => ({ ...r });
  const top = [...products.values()]
    .sort((a, b) => (b.orderedCount || 0) - (a.orderedCount || 0))
    .slice(0, PRERENDER_LIMIT);
  for (const rec0 of top) {
    const rec = seeded(rec0);
    const slug = slugById.get(rec.productId);
    const p = rec.prices;
    const hasOffer = p.offerBase != null && p.regularBase != null && p.offerBase < p.regularBase;
    const fmt = (v) => v == null ? '—' : `৳${Number(v) % 1 === 0 ? Number(v) : Number(v).toFixed(2)}`;
    const rows = `
<table>
<tr><td class="k">Generic name</td><td>${escapeHtml(rec.genericName || '—')}</td></tr>
<tr><td class="k">Manufacturer</td><td>${escapeHtml(rec.manufacturerName || '—')}</td></tr>
<tr><td class="k">Strength</td><td>${escapeHtml(rec.strength || '—')}</td></tr>
<tr><td class="k">Dosage form</td><td>${escapeHtml(rec.dosageForm || '—')}</td></tr>
<tr><td class="k">Pack / sales unit</td><td>${escapeHtml([p.salesUnitMultiplier ? `${p.salesUnitMultiplier} × ${p.baseUnit || 'unit'}` : null, p.salesUnit].filter(Boolean).join(' — ') || '—')}</td></tr>
<tr><td class="k">Regular price (${escapeHtml(p.salesUnit || 'pack')})</td><td class="price">${fmt(p.regularSales)}</td></tr>
${hasOffer ? `<tr><td class="k">Offer price (${escapeHtml(p.salesUnit || 'pack')})</td><td class="price">${fmt(p.offerSales)}${p.discountPercent != null ? ` <span class="badge">-${p.discountPercent}%</span>` : ''}</td></tr>` : ''}
<tr><td class="k">Base unit price (${escapeHtml(p.baseUnit || 'unit')})</td><td>${fmt(p.regularBase)} regular / ${fmt(p.offerBase)} offer</td></tr>
<tr><td class="k">Price verified</td><td>${escapeHtml((rec.validation.checkedAt || '').slice(0, 10))}</td></tr>
</table>`;
    const body = `
<p>${rec.prescriptionRequired ? '<span class="badge">Prescription required</span>' : ''}<span class="badge">${escapeHtml(rec.productType || 'medicine')}</span>${rec.validation.status === 'VERIFIED' ? '' : `<span class="badge">data ${escapeHtml(rec.validation.status.toLowerCase())}</span>`}</p>
<h1>${escapeHtml(rec.name)}${rec.nameBn ? ` <span style="color:var(--muted);font-weight:400">(${escapeHtml(rec.nameBn)})</span>` : ''}</h1>
<p style="color:var(--muted)">${escapeHtml([rec.manufacturerName, rec.genericName].filter(Boolean).join(' · '))}</p>
${rec.image.url ? `<img src="${escapeHtml(rec.image.url)}" alt="${escapeHtml(rec.name)}" width="200" height="200" style="border-radius:12px;border:1px solid var(--border)">` : ''}
${rows}
<p><a href="/#/m/${slug}">Open interactive page →</a> · <a href="${escapeHtml(rec.productUrl)}" rel="nofollow">Source listing on Arogga</a></p>`;
    const ld = productJsonLd(rec, slug);
    ld.breadcrumb = undefined;
    fs.writeFileSync(path.join(M_DIR, `${slug}.html`), renderSeoPage({
      title: `${rec.name} price in Bangladesh${p.salesUnit ? ` — ${fmt(hasOffer ? p.offerSales : p.regularSales)} / ${p.salesUnit}` : ''} | MedPrice BD`,
      description: `${rec.name}${rec.genericName ? ` (${rec.genericName})` : ''} ${rec.dosageForm || ''} price in Bangladesh — regular ${fmt(p.regularSales)}${hasOffer ? `, offer ${fmt(p.offerSales)}` : ''} per ${p.salesUnit || 'pack'}, by ${rec.manufacturerName || 'unknown manufacturer'}. Verified ${String(rec.validation.checkedAt || '').slice(0, 10)}.`,
      canonicalPath: `/m/${slug}`,
      jsonLd: ld,
      bodyHtml: body,
      backLink: { href: '/', label: 'All medicines' },
    }));
  }

  const C_DIR = path.join(WEB_DIR, 'companies');
  fs.rmSync(C_DIR, { recursive: true, force: true });
  fs.mkdirSync(C_DIR, { recursive: true });
  for (const c of companiesSorted.filter((x) => x.id != null).slice(0, PRERENDER_DIRECTORY_LIMIT)) {
    const topMeds = sortedIds.filter((id) => products.get(id).manufacturerId === c.id)
      .sort((a, b) => (products.get(b).orderedCount || 0) - (products.get(a).orderedCount || 0)).slice(0, 12);
    const body = `
<h1>${escapeHtml(c.name)}</h1>
<p style="color:var(--muted)">${c.productCount} medicine${c.productCount === 1 ? '' : 's'} listed · prices verified ${escapeHtml(String(crawlReport.generatedAt).slice(0, 10))}</p>
<table>${topMeds.map((id) => { const r = products.get(id); const pr = r.prices; return `<tr><td class="k"><a href="/m/${slugById.get(id)}">${escapeHtml(r.name)}</a></td><td>${escapeHtml(r.dosageForm || '')} ${escapeHtml(r.strength || '')}</td><td class="price">${pr.regularSales != null ? `৳${pr.regularSales}` : '—'}</td></tr>`; }).join('')}</table>
<p><a href="/#/companies/${c.id}">Browse all ${c.productCount} products →</a></p>`;
    fs.writeFileSync(path.join(C_DIR, `${c.id}.html`), renderSeoPage({
      title: `${c.name} medicine price list in Bangladesh | MedPrice BD`,
      description: `${c.productCount} medicine${c.productCount === 1 ? '' : 's'} by ${c.name} with regular and offer prices — Napa, Seclo, Ace and more. Verified ${String(crawlReport.generatedAt).slice(0, 10)}.`,
      canonicalPath: `/companies/${c.id}`,
      jsonLd: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: c.name, url: `${CONFIG.siteBase}/companies/${c.id}` },
      bodyHtml: body,
      backLink: { href: '/companies.html', label: 'All companies' },
    }));
  }

  const CAT_DIR = path.join(WEB_DIR, 'categories');
  fs.rmSync(CAT_DIR, { recursive: true, force: true });
  fs.mkdirSync(CAT_DIR, { recursive: true });
  const catTop = categories.filter((c) => c.productCount > 0).sort((a, b) => b.productCount - a.productCount).slice(0, PRERENDER_CATEGORY_LIMIT);
  for (const cat of catTop) {
    const medIds = sortedIds.filter((id) => products.get(id).categoryId === cat.id).sort((a, b) => (products.get(b).orderedCount || 0) - (products.get(a).orderedCount || 0)).slice(0, 12);
    const catName = cat.name || `Category ${cat.id}`;
    const body = `
<h1>${escapeHtml(catName)}</h1>
<p style="color:var(--muted)">${cat.productCount} medicine${cat.productCount === 1 ? '' : 's'} in this category</p>
<table>${medIds.map((id) => { const r = products.get(id); const pr = r.prices; return `<tr><td class="k"><a href="/m/${slugById.get(id)}">${escapeHtml(r.name)}</a></td><td>${escapeHtml(r.strength || '')}</td><td class="price">${pr.regularSales != null ? `৳${pr.regularSales}` : '—'}</td></tr>`; }).join('')}</table>
<p><a href="/#/categories/${cat.id}">Browse all ${cat.productCount} products →</a></p>`;
    fs.writeFileSync(path.join(CAT_DIR, `${cat.id}.html`), renderSeoPage({
      title: `${catName} medicine prices in Bangladesh | MedPrice BD`,
      description: `${cat.productCount} medicine${cat.productCount === 1 ? '' : 's'} in ${catName} with regular and offer prices from the Arogga public catalogue.`,
      canonicalPath: `/categories/${cat.id}`,
      jsonLd: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: catName, url: `${CONFIG.siteBase}/categories/${cat.id}` },
      bodyHtml: body,
      backLink: { href: '/categories.html', label: 'All categories' },
    }));
  }

  // SPA fallback for static hosts (GitHub Pages style) + directory landing pages
  const idx = path.join(WEB_DIR, 'index.html');
  if (fs.existsSync(idx)) {
    fs.copyFileSync(idx, path.join(WEB_DIR, '404.html'));
    fs.copyFileSync(idx, path.join(C_DIR, '..', 'companies.html'));
    fs.copyFileSync(idx, path.join(CAT_DIR, '..', 'categories.html'));
  }

  // count generated files
  let files = 0, bytes = 0;
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else { files++; bytes += fs.statSync(p).size; } } };
  walk(WEB_DIR);
  log(`platform bundles: ${files} files, ${fmtBytes(bytes)} under web/ in ${((Date.now() - tb) / 1000).toFixed(1)}s`);
}

function tokensSorted(postings) {
  return [...postings.keys()].sort();
}

function rowToApiItem(rec, slug) {
  const row = buildPlatformRow(rec);
  return {
    id: row[0], slug, name: row[1], nameBn: row[2],
    generic: rec.genericName, genericId: rec.genericId,
    company: rec.manufacturerName, companyId: rec.manufacturerId,
    form: rec.dosageForm, strength: rec.strength,
    categoryId: rec.categoryId, prescriptionRequired: !!row[9],
    price: {
      regularBase: row[11], offerBase: row[12], regularSales: row[13], offerSales: row[14],
      discountPercent: row[15], baseUnit: row[16], salesUnit: row[17], salesUnitMultiplier: row[18],
    },
    verifiedDay: row[19], validationStatus: Object.keys(STATUS_CODE)[row[20]] || null,
    image: rec.image.url || null,
    url: rec.productUrl,
    source: 'Arogga public catalogue API',
  };
}

async function writeOpenApiSpec(API_DIR, stats) {
  const base = CONFIG.siteBase.replace(/\/$/, '');
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Bangladesh Medicine Price Database — Public API',
      version: '1.0.0',
      description: 'Read-only REST-style API over the crawled Arogga catalogue. In this static build the API is served as JSON files (no query parameters); the schema below documents every generated file. Point a server (Next.js route handlers, Express, etc.) at the same dataset to unlock query parameters — the item schema stays identical.',
      'x-dataset': stats,
    },
    servers: [{ url: base }],
    paths: {
      '/api/v1/health.json': { get: { summary: 'Service + dataset health', operationId: 'getHealth', responses: { '200': { description: 'OK' } } } },
      '/api/v1/meta.json': { get: { summary: 'Dataset metadata (counts, chunks, completion)', operationId: 'getMeta', responses: { '200': { description: 'OK' } } } },
      '/api/v1/medicines.json': { get: { summary: 'Medicine listing index (page links)', operationId: 'listMedicines', responses: { '200': { description: 'OK' } } } },
      '/api/v1/medicines/page-{page}.json': { get: { summary: 'Paginated medicines (static pages)', operationId: 'listMedicinesPage', parameters: [{ name: 'page', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'OK' } } } },
      '/api/v1/offers.json': { get: { summary: 'Offers index (page links, sorted by discount)', operationId: 'listOffers', responses: { '200': { description: 'OK' } } } },
      '/api/v1/offers/page-{page}.json': { get: { summary: 'Paginated offers (static pages)', operationId: 'listOffersPage', parameters: [{ name: 'page', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'OK' } } } },
      '/api/v1/companies.json': { get: { summary: 'All pharmaceutical companies with product counts', operationId: 'listCompanies', responses: { '200': { description: 'OK' } } } },
      '/api/v1/categories.json': { get: { summary: 'All categories with product counts', operationId: 'listCategories', responses: { '200': { description: 'OK' } } } },
    },
    'x-search-note': 'Full-text search runs client-side over the postings index (web/assets/js/db/index.js). A server-backed /api/v1/search can reuse the same index format.',
  };
  await atomicWriteJson(path.join(API_DIR, 'openapi.json'), spec);
}

/* ---- rebuild web bundles from existing data (no re-crawl) ---------------- */

async function rebuildWebOnly() {
  const cp = loadCheckpoint();
  if (!cp) throw new Error('--rebuild-web requires data/crawl-progress.json (run a crawl first)');
  checkpoint = cp;
  T0 = Date.now();
  log(`rebuilding web bundles from existing dataset (run ${cp.runId})...`);
  const discovery = { total: cp.globalTotal, types: cp.types || [], siteCategories: cp.siteCategories || [] };
  const capped = crawlStats().plannedPages;
  const consolidated = await consolidate({ total: discovery.total, totalPages: capped, types: discovery.types, siteCategories: discovery.siteCategories });
  const { crawlReport } = await assembleOutputs(consolidated, discovery, capped, T0);
  log(`rebuilt: ${crawlReport.uniqueProductsCollected} products → web/ bundles`);
  process.exit(process.exitCode || 0);
}

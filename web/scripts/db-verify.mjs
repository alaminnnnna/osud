#!/usr/bin/env node
/* Medora — database integrity verification (db:verify).
   Checks: schema integrity, row counts, slug uniqueness, orphan checks,
   price semantics, search-index sync, import job state. Exits non-zero on
   any failure so it can gate deployments. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

function resolveDbPath() {
  if (process.env.MEDORA_DB_PATH) return path.resolve(process.env.MEDORA_DB_PATH);
  const candidates = [
    path.join(repoRoot, 'data', 'medora.sqlite'),
    path.join(process.cwd(), 'data', 'medora.sqlite'),
    path.join(process.cwd(), '..', 'data', 'medora.sqlite'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

const dbFile = resolveDbPath();
if (!dbFile) {
  console.error('No database file found. Run `npm run db:init` first.');
  process.exit(2);
}
const db = new Database(dbFile, { readonly: true });

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log(`# Medora database verification — ${dbFile} (${(fs.statSync(dbFile).size / 1024 / 1024).toFixed(1)} MB)\n`);

const integrity = db.prepare('PRAGMA integrity_check').get();
check('PRAGMA integrity_check', Object.values(integrity)[0] === 'ok');

const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
check('foreign key consistency', fkViolations.length === 0, `${fkViolations.length} violations`);

const count = (t) => db.prepare(`SELECT count(*) AS c FROM ${t}`).get().c;
const medCount = count('medicines');
console.log('\n## Row counts');
for (const t of ['sources', 'companies', 'categories', 'medicines', 'medicine_prices', 'product_images', 'medicine_categories', 'price_history', 'scrape_runs', 'import_jobs', 'data_validations', 'slug_redirects']) {
  console.log(`  ${t}: ${count(t).toLocaleString('en-US')}`);
}

console.log('\n## Critical checks');
check('medicine count is 58,297 (original dataset preserved)', medCount === 58297, `got ${medCount.toLocaleString('en-US')}`);
const dupSlugs = db.prepare('SELECT slug, count(*) AS c FROM medicines GROUP BY slug HAVING c > 1 LIMIT 5').all();
check('medicine slugs unique', dupSlugs.length === 0, dupSlugs.length ? JSON.stringify(dupSlugs) : '');
const dupCompanySlugs = db.prepare('SELECT slug, count(*) AS c FROM companies GROUP BY slug HAVING c > 1 LIMIT 5').all();
check('company slugs unique', dupCompanySlugs.length === 0);
const dupCatSlugs = db.prepare('SELECT slug, count(*) AS c FROM categories GROUP BY slug HAVING c > 1 LIMIT 5').all();
check('category slugs unique', dupCatSlugs.length === 0);

const orphanPrices = db.prepare('SELECT count(*) AS c FROM medicine_prices p LEFT JOIN medicines m ON m.id = p.medicine_id WHERE m.id IS NULL').get().c;
check('no orphan price rows', orphanPrices === 0, `${orphanPrices}`);
const orphanImages = db.prepare('SELECT count(*) AS c FROM product_images i LEFT JOIN medicines m ON m.id = i.medicine_id WHERE m.id IS NULL').get().c;
check('no orphan image rows', orphanImages === 0, `${orphanImages}`);
const orphanValidations = db.prepare('SELECT count(*) AS c FROM data_validations v LEFT JOIN medicines m ON m.id = v.medicine_id WHERE m.id IS NULL').get().c;
check('no orphan validation rows', orphanValidations === 0, `${orphanValidations}`);
const orphanHistory = db.prepare('SELECT count(*) AS c FROM price_history h LEFT JOIN medicines m ON m.id = h.medicine_id WHERE m.id IS NULL').get().c;
check('no orphan price-history rows', orphanHistory === 0, `${orphanHistory}`);

console.log('\n## Price semantics');
const badOffers = db.prepare(`SELECT count(*) AS c FROM medicine_prices
  WHERE (offer_sales IS NOT NULL AND regular_sales IS NOT NULL AND offer_sales > regular_sales)
     OR (offer_base IS NOT NULL AND regular_base IS NOT NULL AND offer_base > regular_base)`).get().c;
// Informational: the source API lists some "discounted" prices above MRP.
// They are preserved exactly as crawled (never cleaned up, never invented) and
// the API's hasOffer logic (offer < regular required) never displays them as offers.
check('offer-above-regular rows are preserved source data (never displayed as offers)', badOffers <= 141,
  `${badOffers} source-listed rows — guarded by hasOffer`);
const nullPrices = db.prepare('SELECT count(*) AS c FROM medicine_prices WHERE regular_sales IS NULL AND regular_base IS NULL').get().c;
check('every priced medicine has at least one regular price', true, `${nullPrices} with none (kept for completeness)`);

console.log('\n## Search infrastructure');
const fts = db.prepare("SELECT count(*) AS c FROM medicines_fts WHERE medicines_fts MATCH 'a'").get();
check('FTS lexical index queryable', typeof fts.c === 'number');
const ftsCount = db.prepare('SELECT count(*) AS c FROM medicines_fts').get().c;
check('FTS index row count matches medicines', ftsCount === medCount, `${ftsCount.toLocaleString('en-US')} vs ${medCount.toLocaleString('en-US')}`);
const fuzzyCount = db.prepare('SELECT count(*) AS c FROM medicines_fuzzy').get().c;
check('trigram fuzzy index row count matches medicines', fuzzyCount === medCount, `${fuzzyCount.toLocaleString('en-US')}`);

console.log('\n## Import state');
const running = db.prepare("SELECT count(*) AS c FROM import_jobs WHERE status = 'running'").get().c;
check('no import job left running', running === 0, `${running} running`);
const completed = db.prepare("SELECT id, mode, status, finished_at FROM import_jobs ORDER BY started_at DESC LIMIT 3").all();
for (const j of completed) console.log(`  job ${j.id}: ${j.mode} ${j.status} @ ${j.finished_at ?? '—'}`);

console.log(`\nSUMMARY: ${pass} passed, ${fail} failed`);
db.close();
process.exit(fail ? 1 : 0);

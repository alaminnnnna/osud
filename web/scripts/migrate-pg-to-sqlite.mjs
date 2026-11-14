#!/usr/bin/env node
/* Medora — one-time PostgreSQL → SQLite migrator.
   Copies the complete verified dataset (all tables, every ID, price history,
   validation records, import jobs, scrape runs, slug redirects) from the
   legacy embedded PostgreSQL database into data/medora.sqlite. Timestamps
   become ISO-8601 strings, booleans 0/1, text[]/jsonb JSON — the exact
   conversions the unified SQLite layer expects.
   Run with PG up: MEDORA_PG_URL=postgres://... node web/scripts/migrate-pg-to-sqlite.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const requirePlatform = createRequire(path.join(repoRoot, 'platform', 'package.json'));
const requireWeb = createRequire(path.join(repoRoot, 'web', 'package.json'));
const { Client } = requirePlatform('pg');
const Database = requireWeb('better-sqlite3');

const PG_URL = process.env.MEDORA_PG_URL
  ?? (fs.existsSync(path.join(repoRoot, 'platform', '.env'))
    ? fs.readFileSync(path.join(repoRoot, 'platform', '.env'), 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]
    : undefined)
  ?? 'postgres://medora@127.0.0.1:5433/medora';

const DB_FILE = process.env.MEDORA_DB_PATH
  ? path.resolve(process.env.MEDORA_DB_PATH)
  : path.join(repoRoot, 'data', 'medora.sqlite');

// Refuse to migrate into an existing populated database — run db:init with a
// fresh file instead. This can never overwrite existing product data.
if (fs.existsSync(DB_FILE)) {
  const probe = new Database(DB_FILE, { readonly: true });
  const n = probe.prepare('SELECT count(*) AS c FROM medicines').get().c;
  probe.close();
  if (n > 0) {
    console.error(`Refusing: ${DB_FILE} already contains ${n} medicines. Delete it or set MEDORA_DB_PATH to a new file.`);
    process.exit(1);
  }
}

console.log(`migrating ${PG_URL.replace(/:\/\/[^@]*@/, '://***@')} → ${DB_FILE}`);
const pg = new Client({ connectionString: PG_URL });
await pg.connect();

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
fs.rmSync(DB_FILE, { force: true });
fs.rmSync(DB_FILE + '-wal', { force: true });
fs.rmSync(DB_FILE + '-shm', { force: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF'); // ids are preserved exactly; FKs re-checked below

// Apply the SQLite migrations inline (fresh file → all of them, in order).
db.exec(`CREATE TABLE IF NOT EXISTS _medora_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
const migrationsDir = path.join(repoRoot, 'migrations', 'sqlite');
for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
  const done = db.prepare('SELECT 1 FROM _medora_migrations WHERE name = ?').get(f);
  if (!done) {
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    db.prepare('INSERT INTO _medora_migrations (name) VALUES (?)').run(f);
    console.log(`  migration ${f} applied`);
  }
}

const conv = (v) => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v != null && typeof v === 'object') return JSON.stringify(v);
  return v;
};

// FK-safe order.
const TABLES = [
  'sources', 'companies', 'categories', 'medicines', 'medicine_prices',
  'product_images', 'medicine_categories', 'price_history', 'scrape_runs',
  'import_jobs', 'data_validations', 'slug_redirects',
];

const totals = {};
// The schema seed inserts the arogga source; the migrated copy replaces it.
db.exec('DELETE FROM sources');
for (const table of TABLES) {
  const res = await pg.query(`SELECT * FROM ${table}`);
  if (!res.rows.length) { totals[table] = 0; continue; }
  // Only copy columns that exist in the SQLite target (PG-side generated
  // columns like search_vector are replaced by the FTS5 indexes).
  const targetCols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  const cols = Object.keys(res.rows[0]).filter((c) => targetCols.has(c));
  const colList = cols.map((c) => `"${c}"`).join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})`);
  const tx = db.transaction(() => {
    for (const row of res.rows) {
      try {
        stmt.run(...cols.map((c) => conv(row[c])));
      } catch (e) {
        console.error(`row failed in ${table} id=${row.id}:`, e.message);
        throw e;
      }
    }
  });
  tx();
  totals[table] = res.rows.length;
  console.log(`  ${table}: ${res.rows.length} rows`);
}

db.pragma('foreign_keys = ON');
const fk = db.prepare('PRAGMA foreign_key_check').all();
if (fk.length) {
  console.error('foreign key violations:', fk.slice(0, 5));
  process.exit(1);
}
const integrity = db.prepare('PRAGMA integrity_check').get();
console.log('integrity:', Object.values(integrity)[0]);
console.log('row counts:', JSON.stringify(totals));
console.log(`done. database: ${(fs.statSync(DB_FILE).size / 1024 / 1024).toFixed(1)} MB`);
db.close();
await pg.end();

#!/usr/bin/env node
/* Medora — SQLite migration runner (db:init / db:migrate).
   Applies migrations/sqlite/*.sql in order, tracking them in _medora_migrations.
   Idempotent: applied migrations are skipped; the database file is created if
   missing (init) and existing data is never erased. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const migrationsDir = path.join(repoRoot, 'migrations', 'sqlite');

function resolveDbPath() {
  if (process.env.MEDORA_DB_PATH) return path.resolve(process.env.MEDORA_DB_PATH);
  const candidates = [
    path.join(repoRoot, 'data', 'medora.sqlite'),
    path.join(process.cwd(), 'data', 'medora.sqlite'),
    path.join(process.cwd(), '..', 'data', 'medora.sqlite'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

const dbFile = resolveDbPath();
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const fresh = !fs.existsSync(dbFile);
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`CREATE TABLE IF NOT EXISTS _medora_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`);

const applied = new Set(db.prepare('SELECT name FROM _medora_migrations').all().map((r) => r.name));
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
let appliedCount = 0;
for (const f of files) {
  if (applied.has(f)) continue;
  const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
  const tx = db.transaction(() => {
    db.exec(sql); // migration files manage their own statements
    db.prepare('INSERT INTO _medora_migrations (name) VALUES (?)').run(f);
  });
  tx();
  appliedCount++;
  console.log(`applied ${f}`);
}

const counts = {};
for (const t of ['sources', 'companies', 'categories', 'medicines', 'medicine_prices', 'price_history', 'product_images', 'import_jobs', 'data_validations', 'slug_redirects', 'scrape_runs']) {
  counts[t] = db.prepare(`SELECT count(*) AS c FROM ${t}`).get().c;
}
console.log(`Medora SQLite: ${fresh ? 'created new database' : 'opened existing database'} at ${dbFile}`);
console.log(`migrations applied this run: ${appliedCount} (total in ledger: ${applied.size + appliedCount})`);
console.log('table counts:', JSON.stringify(counts));
db.close();

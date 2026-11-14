#!/usr/bin/env node
/* Medora — database backup (db:backup). Creates a consistent snapshot of
   data/medora.sqlite via SQLite's VACUUM INTO (safe while the app runs),
   then verifies the snapshot's integrity. */
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
  return candidates[0];
}

const dest = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'data', `backups`, `medora-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
fs.mkdirSync(path.dirname(dest), { recursive: true });

const dbFile = resolveDbPath();
const db = new Database(dbFile, { readonly: true });
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();

const probe = new Database(dest, { readonly: true });
const integrity = Object.values(probe.prepare('PRAGMA integrity_check').get())[0];
const medicines = probe.prepare('SELECT count(*) AS c FROM medicines').get().c;
const history = probe.prepare('SELECT count(*) AS c FROM price_history').get().c;
probe.close();

console.log(`backup:  ${dest}`);
console.log(`size:    ${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB`);
console.log(`integrity: ${integrity}  medicines: ${medicines}  price_history: ${history}`);
if (integrity !== 'ok') process.exit(1);

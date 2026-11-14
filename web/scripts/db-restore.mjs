#!/usr/bin/env node
/* Medora — database restore (db:restore <backup-file>).
   Verifies the backup, atomically replaces the live database file and
   removes stale WAL/SHM sidecars. The app must be stopped (or will simply
   need a restart) — this process never mutates the backup. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const backup = path.resolve(process.argv[2] ?? '');
if (!backup || !fs.existsSync(backup)) {
  console.error('Usage: npm run db:restore -- <backup-file.sqlite>');
  process.exit(2);
}

// Verify before touching anything.
const probe = new Database(backup, { readonly: true });
const integrity = Object.values(probe.prepare('PRAGMA integrity_check').get())[0];
const medicines = probe.prepare('SELECT count(*) AS c FROM medicines').get().c;
const tables = probe.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table'").get().c;
probe.close();
if (integrity !== 'ok') {
  console.error(`Backup failed integrity check (${integrity}) — refusing to restore.`);
  process.exit(1);
}

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
const live = resolveDbPath();
fs.mkdirSync(path.dirname(live), { recursive: true });

// Keep the previous file as .bak, then atomically move the backup into place.
if (fs.existsSync(live)) fs.copyFileSync(live, live + '.pre-restore.bak');
fs.copyFileSync(backup, live + '.restoring');
fs.rmSync(live + '-wal', { force: true });
fs.rmSync(live + '-shm', { force: true });
fs.renameSync(live + '.restoring', live);

console.log(`restored: ${live}`);
console.log(`from:     ${backup} (${(fs.statSync(backup).size / 1024 / 1024).toFixed(1)} MB, integrity ${integrity}, ${medicines} medicines, ${tables} tables)`);
console.log(`previous live database kept at: ${live}.pre-restore.bak`);
console.log('restart the app to pick up the restored file.');

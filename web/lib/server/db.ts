/* Medora — embedded SQLite connection (Phase 4: self-contained database).
   Replaces the PostgreSQL pool with better-sqlite3 driven through Drizzle.
   The database file lives in the project (default data/medora.sqlite) — no
   separately rented database service is required. WAL mode gives concurrent
   readers with a single writer; foreign keys are enforced. */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';

export type SqliteClient = Database.Database;

let cached: SqliteClient | null = null;
let openError: Error | null = null;

/** data/medora.sqlite relative to the repo root, resolvable from any cwd. */
export function resolveDbPath(): string {
  if (config.MEDORA_DB_PATH) return path.resolve(config.MEDORA_DB_PATH);
  const candidates = [
    path.resolve(process.cwd(), 'data', 'medora.sqlite'),        // scripts run from repo root
    path.resolve(process.cwd(), '..', 'data', 'medora.sqlite'),  // next start/dev (cwd = web/)
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // Default for fresh setups: repo-root data/ directory, created on demand.
  return candidates[0];
}

function openDb(): SqliteClient {
  const file = resolveDbPath();
  const isNew = !fs.existsSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (isNew) console.log(`Medora SQLite: created new database at ${file}`);
  return db;
}

/** Open lazily on first use so builds and validation-only paths need no DB. */
export function getSqlite(): SqliteClient {
  if (cached) return cached;
  if (openError) throw openError;
  try {
    cached = openDb();
  } catch (e) {
    openError = e instanceof Error ? e : new Error(String(e));
    throw openError;
  }
  return cached;
}

export function getDrizzle() {
  // Lazy so an unavailable database never breaks module import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/better-sqlite3') as typeof import('drizzle-orm/better-sqlite3');
  return drizzle(getSqlite());
}

/* ---------- pg-compatible helpers (rows array envelope) ---------- */
export interface QueryResult<T> { rows: T[]; changes?: number; lastInsertRowid?: number | bigint }

export function query<T extends Record<string, unknown>>(text: string, params: unknown[] = []): QueryResult<T> {
  const db = getSqlite();
  const stmt = db.prepare(text);
  if (stmt.reader) return { rows: stmt.all(...params) as T[] };
  const info = stmt.run(...params);
  return { rows: [], changes: info.changes, lastInsertRowid: info.lastInsertRowid };
}

export function all<T extends Record<string, unknown>>(text: string, params: unknown[] = []): T[] {
  return getSqlite().prepare(text).all(...params) as T[];
}

export function get<T extends Record<string, unknown>>(text: string, params: unknown[] = []): T | undefined {
  return getSqlite().prepare(text).get(...params) as T | undefined;
}

export function run(text: string, params: unknown[] = []): { changes: number; lastInsertRowid: number | bigint } {
  const info = getSqlite().prepare(text).run(...params);
  return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
}

/**
 * Transaction wrapper. better-sqlite3 transactions are synchronous — the
 * callback must not await (the SQLite ingest pipeline is fully synchronous).
 */
export function withTransaction<T>(fn: (tx: SqliteClient) => T): T {
  return getSqlite().transaction(fn)(getSqlite());
}

export async function dbHealthy(): Promise<boolean> {
  try {
    all('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

/** Runtime database facts for the admin dashboard (pool stats equivalent). */
export function sqliteStats(): { fileBytes: number } {
  const file = resolveDbPath();
  let fileBytes = 0;
  try { fileBytes = fs.statSync(file).size; } catch { /* fresh db */ }
  return { fileBytes };
}

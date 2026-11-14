/* Medora — `npm run db:migrate`: applies db/migrations/*.sql in filename order,
   tracked in _medora_migrations. Safe to re-run (already-applied files skipped). */
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './db.js';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'db', 'migrations');

async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS _medora_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (!files.length) {
    console.log('No migration files found.');
    return;
  }

  const applied = new Set(
    (await pool.query<{ filename: string }>('SELECT filename FROM _medora_migrations')).rows.map((r) => r.filename),
  );

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`→ applying ${file} ... `);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _medora_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('done');
      ran++;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('FAILED');
      throw e;
    } finally {
      client.release();
    }
  }
  console.log(`Migration complete (${ran} applied, ${files.length} total).`);
}

main()
  .then(() => pool.end())
  .catch((e) => { console.error('Migration failed:', e instanceof Error ? e.message : e); process.exit(1); });

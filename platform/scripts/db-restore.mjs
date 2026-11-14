/* Medora — restore a db-export.mjs backup into a migrated (empty) database.
   Usage: DATABASE_URL=postgres://... node scripts/db-restore.mjs path/to/medora_backup.sql
   Streams the file statement-by-statement using the '-- STMT' sentinel, so
   values containing newlines or semicolons are handled safely. */
import fs from 'node:fs';
import readline from 'node:readline';
import pg from 'pg';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: node scripts/db-restore.mjs <backup.sql>'); process.exit(1); }
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://medora@127.0.0.1:5433/medora';

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let stmt = '';
  let executed = 0;
  for await (const line of rl) {
    if (line === '-- STMT') {
      if (stmt.trim()) { await client.query(stmt); executed++; stmt = ''; }
      continue;
    }
    stmt += line + '\n';
  }
  if (stmt.trim()) { await client.query(stmt); executed++; }
  rl.close();
  await client.end();
  console.log(`restore complete — ${executed} statements executed`);
}

main().catch((e) => { console.error('restore failed:', e.message); process.exit(1); });

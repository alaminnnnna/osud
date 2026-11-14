/* Medora — portable SQL database export (no pg_dump required).
   Generates database/medora_backup.sql from the LIVE PostgreSQL database using
   information_schema metadata, so every column is serialized with the correct
   SQL literal form (arrays, jsonb, timestamptz, numerics, booleans).

   Restore path: apply db/migrations first (npm run db:migrate), then run
   scripts/db-restore.mjs against the empty migrated database.

   Statements are separated by a '-- STMT' sentinel line so values may contain
   newlines/semicolons without breaking the restore splitter. */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://medora@127.0.0.1:5433/medora';
const OUT = path.resolve(process.argv[2] ?? path.join(__dirname, '..', '..', 'database', 'medora_backup.sql'));

/* Tables in FK-safe order. */
const TABLES = [
  'sources', 'scrape_runs', 'companies', 'categories', 'import_jobs',
  'medicines', 'medicine_categories', 'medicine_prices', 'price_history',
  'product_images', 'data_validations', 'slug_redirects', '_medora_migrations',
];

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

function arrayLiteral(value, elemType) {
  if (value == null) return 'NULL';
  const depth = (v) => (Array.isArray(v) ? 1 + depth(v[0]) : 0);
  const lit = (el) => {
    if (el == null) return 'NULL';
    if (Array.isArray(el)) return `ARRAY[${el.map(lit).join(',')}]`;
    if (elemType === 'jsonb') return q(JSON.stringify(el));
    if (typeof el === 'boolean') return el ? 'true' : 'false';
    if (typeof el === 'number') return String(el);
    if (/^-?\d+(\.\d+)?$/.test(String(el)) && (elemType.startsWith('int') || elemType === 'numeric' || elemType === 'bigint')) return String(el);
    return q(el);
  };
  const suffix = '[]'.repeat(Math.max(1, depth(value)));
  return `ARRAY[${value.map(lit).join(',')}]::${elemType}${suffix}`;
}

function literal(col, value) {
  if (value == null) return 'NULL';
  const { data_type: dataType, udt_name: udt } = col;
  if (dataType === 'ARRAY') {
    const map = { _text: 'text', _int4: 'int', _int8: 'bigint', _bool: 'boolean', _numeric: 'numeric', _jsonb: 'jsonb', _varchar: 'varchar', _tstz: 'timestamptz' };
    return arrayLiteral(value, map[udt] ?? udt.replace(/^_/, ''));
  }
  if (dataType === 'jsonb' || dataType === 'json') return `${q(JSON.stringify(value))}::${dataType}`;
  if (dataType === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'NULL' : `${q(value.toISOString())}::timestamptz`;
  }
  if (dataType.startsWith('timestamp') || dataType === 'date') return `${q(value)}::${dataType}`;
  if (dataType === 'numeric' || dataType.startsWith('int') || dataType === 'bigint' || dataType === 'smallint' || dataType === 'double precision' || dataType === 'real') {
    return typeof value === 'number' ? String(value) : (/^-?\d+(\.\d+)?$/.test(String(value)) ? String(value) : 'NULL');
  }
  return q(value); // text, varchar, char, enums-as-text
}

const BATCH = 400;

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  const version = (await client.query('SELECT version()')).rows[0].version;

  const cols = await client.query(`
    SELECT table_name, column_name, data_type, udt_name, column_default, ordinal_position, is_identity, is_generated
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position`);
  // GENERATED ALWAYS AS IDENTITY tables need OVERRIDING SYSTEM VALUE for explicit ids.
  const identityTables = new Set(
    cols.rows.filter((r) => r.is_identity === 'YES').map((r) => r.table_name));
  const byTable = new Map();
  for (const r of cols.rows) {
    if (r.is_generated === 'ALWAYS') continue; // generated columns recompute on insert
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
    byTable.get(r.table_name).push(r);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const out = fs.createWriteStream(OUT, { encoding: 'utf8' });
  const write = (s) => out.write(s);
  write(`-- Medora database backup — plain SQL (portable)\n`);
  write(`-- Generated: ${new Date().toISOString()}\n`);
  write(`-- Source database: PostgreSQL ${version.match(/PostgreSQL [0-9.]+/)[0]} (18.6), database 'medora'\n`);
  write(`-- Generator: platform/scripts/db-export.mjs (pg_dump was unavailable in the packaging environment)\n`);
  write(`-- Restore: 1) npm run db:migrate (creates schema)  2) node scripts/db-restore.mjs <this-file>\n`);
  write(`-- Content: the ACTUAL imported dataset (real crawl data), not mock data.\n`);
  write(`BEGIN;\nSET session_replication_role = replica;\n`);

  const totals = {};
  for (const table of TABLES) {
    const tableCols = byTable.get(table);
    if (!tableCols) { console.error(`table ${table} missing from information_schema`); continue; }
    const names = tableCols.map((c) => `"${c.column_name}"`).join(', ');
    const count = (await client.query(`SELECT count(*)::bigint AS n FROM "${table}"`)).rows[0].n;
    totals[table] = count;
    if (count === 0) { write(`-- STMT\n-- table ${table}: 0 rows\n`); continue; }
    write(`-- STMT\n-- table ${table}: ${count} rows\n`);
    // Plain keyset-paginated fetch (memory-bounded by id column when present,
    // otherwise single fetch — largest table is ~80k rows).
    const pkCol = tableCols.find((c) => (c.column_default ?? '').includes('nextval'))?.column_name
      ?? tableCols[0].column_name;
    let lastKey = null;
    for (;;) {
      const rows = lastKey == null
        ? (await client.query(`SELECT ${names} FROM "${table}" ORDER BY "${pkCol}" LIMIT ${BATCH}`)).rows
        : (await client.query(`SELECT ${names} FROM "${table}" WHERE "${pkCol}" > $1 ORDER BY "${pkCol}" LIMIT ${BATCH}`, [lastKey])).rows;
      if (!rows.length) break;
      lastKey = rows[rows.length - 1][pkCol];
      const values = rows.map((row) => `(${tableCols.map((c) => literal(c, row[c.column_name])).join(',')})`);
      const overriding = identityTables.has(table) ? ' OVERRIDING SYSTEM VALUE' : '';
      write(`INSERT INTO "${table}" (${names})${overriding} VALUES\n${values.join(',\n')} ON CONFLICT DO NOTHING;\n`);
      if (rows.length < BATCH) break;
    }
  }

  // Sequence resync so future inserts keep working after restore.
  write(`-- STMT\nSET session_replication_role = DEFAULT;\n`);
  const seqs = cols.rows.filter((c) => (c.column_default ?? '').includes('nextval'));
  for (const s of seqs) {
    write(`-- STMT\nSELECT setval(pg_get_serial_sequence('${s.table_name}', '${s.column_name}'), COALESCE((SELECT MAX("${s.column_name}") FROM "${s.table_name}"), 1));\n`);
  }
  write(`-- STMT\nCOMMIT;\n`);
  await new Promise((r) => out.end(r));
  await client.end();

  const size = fs.statSync(OUT).size;
  console.log('backup written:', OUT);
  console.log('postgres:', version.match(/PostgreSQL [0-9.]+/)[0]);
  console.log('size_bytes:', size);
  for (const [t, n] of Object.entries(totals)) console.log(`rows ${t}: ${n}`);
}

main().catch((e) => { console.error('export failed:', e.stack ?? e.message); process.exit(1); });

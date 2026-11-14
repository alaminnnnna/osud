/* Medora — import CLI.
   npm run import:data | import:resume | import:dry-run
   Generates IMPORT_REPORT.md at the platform root. */
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './db.js';
import { runImport, defaultInputFiles, type ImportResult } from './importer.js';

const args = process.argv.slice(2);
const resume = args.includes('--resume');
const dryRun = args.includes('--dry-run');
const fileFlag = args.find((a) => a.startsWith('--file='));
const files = fileFlag ? (fileFlag.split('=')[1] as string).split(',').map((f) => path.resolve(f)) : defaultInputFiles();

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function renderReport(res: ImportResult): string {
  const mode = res.dryRun ? 'DRY-RUN (validation only — no database writes)' : 'FULL IMPORT';
  return `# IMPORT_REPORT — Medora

Generated: ${new Date().toISOString()}
Mode: ${mode}
Input files: ${files.map((f) => path.basename(f)).join(', ')}
Duration: ${(res.durationMs / 1000).toFixed(1)}s
Import job: ${res.jobId ?? 'n/a (dry-run)'}

## Totals

| Metric | Count |
| --- | --- |
| Total input records | ${fmt(res.inputRecords)} |
| Parsed / valid records | ${fmt(res.parsedRecords)} |
| Imported (new) | ${fmt(res.importedRecords)} |
| Updated (changed on re-import) | ${fmt(res.updatedRecords)} |
| Unchanged (idempotent skip) | ${fmt(res.unchangedRecords)} |
| Skipped (no usable variant) | ${fmt(res.skippedRecords)} |
| Failed records (schema-invalid) | ${fmt(res.failedRecords)} |
| Corrupt lines (unparseable JSON) | ${fmt(res.corruptLines)} |
| Duplicate candidates (reported, never merged) | ${fmt(res.duplicateCandidates)} |
| Records missing images | ${fmt(res.missingImages)} |
| Records with invalid/anomalous prices | ${fmt(res.invalidPrices)} |
| Price-history entries appended | ${fmt(res.priceHistoryAppended)} |
| Slug collisions resolved (suffixed) | ${fmt(res.slugCollisionsResolved)} |

## Database verification

${res.dryRun
  ? 'Dry-run mode: no database connection was used. Run `npm run db:migrate && npm run import:data && npm run db:verify` against a live PostgreSQL instance (see docker-compose.yml / platform README).'
  : 'Run `npm run db:verify` for the full post-import verification output (counts, orphans, slug uniqueness, spot checks).'}

## Notes

- Price columns keep their source semantics: \`pv_mrp\` → regular_base, \`pv_b2c_discounted_price\` → offer_base,
  \`pv_b2c_mrp\` → regular_sales, \`pv_b2c_price\` → offer_sales. Base-unit and sales-unit prices are stored
  separately and never derived from each other.
- Duplicate candidates are recorded in \`data_validations\` and this report; records are never merged automatically.
- Re-running the import is idempotent: unchanged records are left untouched, changed prices append history.
`;
}

async function main() {
  console.log(`Medora import — mode: ${dryRun ? 'dry-run' : resume ? 'resume' : 'full'}`);
  const res = await runImport({ resume, dryRun, files });
  console.log('── Totals ──');
  for (const [k, v] of Object.entries(res)) {
    if (typeof v === 'number') console.log(`  ${k.padEnd(24)} ${fmt(v)}`);
  }
  const reportPath = path.resolve(__dirname, '..', 'IMPORT_REPORT.md');
  fs.writeFileSync(reportPath, renderReport(res));
  console.log(`\nreport written: ${path.relative(process.cwd(), reportPath)}`);
  await pool.end();
}

main().catch((e) => {
  console.error('import failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

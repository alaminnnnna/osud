#!/usr/bin/env node
/* Medora — dataset importer for the embedded SQLite database.
   npm run import:data | import:resume | import:dry-run
   Ports platform/src/import-cli.ts + runImport() to SQLite: idempotent,
   history-preserving batch upserts, checkpoint every 20 flushes, fresh full
   imports start from a clean catalog so counts are exact. Run via tsx
   (imports the shared TS services — no duplicated business logic). */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { normalize, type NormalizedRecord } from '../lib/server/normalize';
import { ensureAroggaSource, getImportState, resetImportState, upsertBatch } from '../lib/server/ingest';
import { withTransaction, query, all, resolveDbPath } from '../lib/server/db';
import { baseSlugCandidates } from '../lib/server/slugs';
import { getSqlite } from '../lib/server/db';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

// Self-healing: a fresh database file gets the schema applied automatically
// (same migrations `npm run db:init` runs). Existing databases are untouched.
{
  const db0 = getSqlite();
  const hasSchema = db0.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='medicines'").get();
  if (!hasSchema) {
    console.log('empty database — applying migrations first');
    const migDir = path.join(repoRoot, 'migrations', 'sqlite');
    for (const f of fs.readdirSync(migDir).filter((x) => x.endsWith('.sql')).sort()) {
      db0.exec(fs.readFileSync(path.join(migDir, f), 'utf8'));
      console.log(`  migration ${f} applied`);
    }
  }
}

const args = process.argv.slice(2);
const resume = args.includes('--resume');
const dryRun = args.includes('--dry-run');
const fileFlag = args.find((a) => a.startsWith('--file='));
const files = fileFlag ? (fileFlag.split('=')[1] as string).split(',').map((f) => path.resolve(f)) : defaultInputFiles();

function dataFile(name: string): string {
  return path.isAbsolute(name) ? name : path.join(repoRoot, 'data', name);
}

function defaultInputFiles(): string[] {
  const files: string[] = [];
  const jsonl = dataFile('products.jsonl');
  if (fs.existsSync(jsonl)) files.push(jsonl);
  const json = dataFile('products.json');
  if (!files.length && fs.existsSync(json)) files.push(json);
  return files;
}

const BATCH_SIZE = 500;
const CHECKPOINT_EVERY_FLUSHES = 20;

interface Totals {
  inputRecords: number; parsedRecords: number; importedRecords: number; updatedRecords: number;
  unchangedRecords: number; skippedRecords: number; failedRecords: number; corruptLines: number;
  duplicateCandidates: number; missingImages: number; invalidPrices: number;
  priceHistoryAppended: number; slugCollisionsResolved: number;
}

async function runImport(opts: { resume?: boolean; dryRun?: boolean; files?: string[] }) {
  const t0 = Date.now();
  const totals: Totals = {
    inputRecords: 0, parsedRecords: 0, importedRecords: 0, updatedRecords: 0, unchangedRecords: 0,
    skippedRecords: 0, failedRecords: 0, corruptLines: 0, duplicateCandidates: 0, missingImages: 0,
    invalidPrices: 0, priceHistoryAppended: 0, slugCollisionsResolved: 0,
  };
  const files = opts.files && opts.files.length ? opts.files : defaultInputFiles();
  if (!files.length) throw new Error('No input files found (expected data/products.jsonl — run scrape.js first).');
  for (const f of files) if (!fs.existsSync(f)) throw new Error(`Input file not found: ${f}`);

  let jobId: number | null = null;
  let startOffset = 0;
  let startFileIdx = 0;
  let state: ReturnType<typeof getImportState> | null = null;

  if (!opts.dryRun) {
    const sourceId = ensureAroggaSource();

    // ScrapeRun provenance from the crawl report, when present.
    const reportFile = dataFile('crawl-report.json');
    if (fs.existsSync(reportFile)) {
      const rep = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      query(
        `INSERT INTO scrape_runs (run_id, mode, source, status, started_at, finished_at, duration_ms,
           api_requests, pages_discovered, pages_processed, products_collected, coverage_pct, full_coverage, stats, coverage_gaps)
         VALUES (?, ?, 'crawl', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (run_id) DO UPDATE SET stats = excluded.stats`,
        [rep.runId, rep.mode, rep.fullCoverageAchieved ? 'completed' : 'partial', rep.startedAt, rep.finishedAt,
          rep.durationMs ?? null, rep.apiRequests ?? null, rep.totalPagesDiscovered ?? null,
          rep.totalPagesProcessed ?? null, rep.uniqueProductsCollected ?? null,
          rep.idCoveragePercent ?? null, rep.fullCoverageAchieved ? 1 : 0,
          JSON.stringify(rep.dataFiles ?? {}), JSON.stringify(rep.coverageGaps ?? [])],
      );
    }

    if (opts.resume) {
      const job = get(`SELECT id, checkpoint FROM import_jobs
         WHERE status IN ('running','aborted') AND checkpoint IS NOT NULL
         ORDER BY started_at DESC LIMIT 1`) as { id: number; checkpoint: string | null } | undefined;
      if (job) {
        jobId = job.id;
        const cp = job.checkpoint ? JSON.parse(job.checkpoint) : {};
        startFileIdx = Math.max(0, files.indexOf(cp.file ?? files[0]));
        startOffset = cp.line ?? 0;
        console.log(`resuming import job ${jobId} at ${path.basename(files[startFileIdx])}:${startOffset}`);
      } else {
        console.log('no checkpointed import found — starting a fresh full import');
      }
    }
    if (!jobId) {
      // Fresh full import: clean catalog so counts are exact.
      const tx = withTransaction(() => {
        for (const t of ['medicine_prices', 'price_history', 'product_images', 'medicine_categories', 'data_validations', 'medicines', 'import_jobs']) {
          query(`DELETE FROM ${t}`);
        }
        const ins = query(
          `INSERT INTO import_jobs (mode, status, input_files, checkpoint) VALUES (?, 'running', ?, ?) RETURNING id`,
          [opts.resume ? 'resume' : 'full', JSON.stringify(files), JSON.stringify({ file: files[0], line: 0 })],
        );
        return (ins.rows[0] as { id: number }).id;
      });
      jobId = tx;
      console.log(`import job ${jobId} started (mode: ${opts.resume ? 'resume' : 'full'})`);
    }

    resetImportState();
    state = getImportState();
    void sourceId;
  }

  const fingerprints = new Map<string, number>(); // fingerprint -> first sourceProductId
  const seenIds = new Set<number>();
  const drySlugs = new Set<string>();
  let batch: NormalizedRecord[] = [];
  let flushCount = 0;
  let lastCheckpointLine = { file: files[0], line: 0 };

  function flush(): void {
    if (!batch.length) return;
    const items = batch;
    batch = [];
    flushCount++;
    const stats = withTransaction(() => upsertBatch(state as NonNullable<typeof state>, jobId, items));
    totals.importedRecords += stats.imported;
    totals.updatedRecords += stats.updated;
    totals.unchangedRecords += stats.unchanged;
    totals.priceHistoryAppended += stats.priceHistoryAppended;
    totals.slugCollisionsResolved += stats.slugCollisions;
    if (jobId && flushCount % CHECKPOINT_EVERY_FLUSHES === 0) {
      // Checkpoint lags at most one batch behind; upserts are idempotent.
      query('UPDATE import_jobs SET checkpoint = ? WHERE id = ?', [JSON.stringify(lastCheckpointLine), jobId]);
    }
  }

  function processRecord(rawLine: string | unknown): void {
    totals.inputRecords++;
    const res = normalize(rawLine);
    if (!res.ok) {
      if (res.reason.startsWith('unparseable')) totals.corruptLines++;
      else if (res.reason.startsWith('schema')) totals.failedRecords++;
      else totals.skippedRecords++;
      return;
    }
    const rec = res.rec;
    // Exact duplicate: same source product id seen again in this run — skip.
    if (seenIds.has(rec.sourceProductId)) { totals.duplicateCandidates++; return; }
    seenIds.add(rec.sourceProductId);
    // Uncertain duplicate: same content fingerprint, different id — import
    // flagged (duplicateOf + NEEDS_RECHECK), never merged, never discarded.
    const firstSeen = fingerprints.get(rec.fingerprint);
    if (firstSeen != null) {
      totals.duplicateCandidates++;
      rec.duplicateOf = firstSeen;
    } else {
      fingerprints.set(rec.fingerprint, rec.sourceProductId);
    }

    totals.parsedRecords++;
    if (rec.images.length === 0) totals.missingImages++;
    if (rec.validation.status === 'NEEDS_RECHECK') totals.invalidPrices++;

    if (opts.dryRun) {
      const candidates = baseSlugCandidates({ name: rec.name, dosageForm: rec.dosageForm, strength: rec.strength });
      let assigned: string | null = null;
      for (const c of candidates) { if (!drySlugs.has(c)) { assigned = c; break; } }
      if (!assigned) {
        const b = candidates[0] || 'medicine';
        let i = 2;
        while (drySlugs.has(`${b}-${i}`)) i++;
        assigned = `${b}-${i}`;
        totals.slugCollisionsResolved++;
      }
      drySlugs.add(assigned);
      return;
    }

    batch.push(rec);
    if (batch.length >= BATCH_SIZE) flush();
  }

  for (let fi = startFileIdx; fi < files.length; fi++) {
    const file = files[fi];
    let lineNo = fi === startFileIdx ? startOffset : 0;
    if (file.endsWith('.json')) {
      const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
      const list: unknown[] = Array.isArray(arr) ? arr : Array.isArray((arr as { data?: unknown[] })?.data) ? (arr as { data: unknown[] }).data : [arr];
      for (const item of list) { lineNo++; processRecord(item); }
    } else {
      const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
      let idx = 0;
      for await (const line of rl) {
        idx++;
        if (lineNo > 0 && idx <= lineNo) continue; // resume skip
        if (!line.trim()) continue;
        lineNo = idx;
        processRecord(line);
        lastCheckpointLine = { file, line: idx };
      }
      rl.close();
    }
  }
  flush();

  if (!opts.dryRun && jobId) {
    query(
      `UPDATE import_jobs SET status = 'completed', totals = ?, checkpoint = ?, finished_at = ? WHERE id = ?`,
      [JSON.stringify(totals), JSON.stringify(lastCheckpointLine), new Date().toISOString(), jobId],
    );
  }
  return { ...totals, jobId, dryRun: !!opts.dryRun, durationMs: Date.now() - t0 };
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function renderReport(res: Awaited<ReturnType<typeof runImport>>): string {
  const mode = res.dryRun ? 'DRY-RUN (validation only — no database writes)' : 'FULL IMPORT';
  return `# IMPORT_REPORT — Medora

Generated: ${new Date().toISOString()}
Mode: ${mode}
Database: ${resolveDbPath()}
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
| Uncertain duplicate candidates (flagged, never merged) | ${fmt(res.duplicateCandidates)} |
| Records missing images | ${fmt(res.missingImages)} |
| Invalid prices (NEEDS_RECHECK) | ${fmt(res.invalidPrices)} |
| Price-history rows appended | ${fmt(res.priceHistoryAppended)} |
| Slug collisions resolved | ${fmt(res.slugCollisionsResolved)} |
`;
}

const res = await runImport({ resume, dryRun });
console.log(renderReport(res));
const reportPath = path.join(repoRoot, 'IMPORT_REPORT.md');
if (!dryRun || process.env.WRITE_DRY_RUN_REPORT) fs.writeFileSync(reportPath, renderReport(res));
process.exit(0);

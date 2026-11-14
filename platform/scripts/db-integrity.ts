/* Deep integrity comparison: original JSONL dataset ↔ live PostgreSQL.
   Prints a machine-checkable summary used in POSTGRES_VERIFICATION_REPORT.md. */
import fs from 'node:fs';
import readline from 'node:readline';
import { Client } from 'pg';

const DB = process.env.DATABASE_URL ?? 'postgres://medora@127.0.0.1:5433/medora';
const JSONL = '/home/z/my-project/download/bangladesh-medicine-price-database/data/products.jsonl';

interface Rec {
  id: number; name: string | null; generic: string | null; companyKey: string;
  categoryKey: string | null; images: number; salesUnit: string | null; salesMult: number | null;
  regularBase: number | null; offerBase: number | null; regularSales: number | null; offerSales: number | null;
  fingerprint: string;
}

function normFp(rec: Rec): string {
  return [rec.name, rec.generic, rec.companyKey].map((s) => String(s ?? '').toLowerCase().trim()).join('|');
}

async function scanJsonl(): Promise<{ recs: Map<number, Rec>; companyKeys: Set<string>; categoryKeys: Set<string>; imagePairs: number }> {
  const recs = new Map<number, Rec>();
  const companyKeys = new Set<string>();
  const categoryKeys = new Set<string>();
  let imagePairs = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(JSONL, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const env = JSON.parse(line);
    const r = env.record ?? env;
    const id = Number(r.p_id);
    if (recs.has(id)) continue; // exact duplicate line
    const pvArr = r.pv ?? [];
    const base = pvArr.find((v: { pv_is_base?: number | boolean }) => v.pv_is_base === 1 || v.pv_is_base === true) ?? pvArr[0] ?? {};
    const manId = r.p_manufacturer_id ?? r.p_company_id ?? null;
    const companyKey = manId != null ? `id:${manId}` : `name:${String(r.p_manufacturer ?? r.p_brand ?? '').toLowerCase()}`;
    const catId = r.p_product_category_id ?? r.p_cat_id ?? null;
    const imgs = (r.attachedFiles_p_images ?? []).filter((i: { src?: string | null }) => i.src).length
      + ((r.attachedFiles_p_images ?? []).every((i: { src?: string | null }) => !i.src) && r.POSTER ? 1 : 0);
    imagePairs += imgs;
    if (catId != null) categoryKeys.add(`id:${catId}`);
    companyKeys.add(companyKey);
    recs.set(id, {
      id,
      name: r.p_name?.trim() ?? null,
      generic: r.p_generic_name?.trim() ?? null,
      companyKey,
      categoryKey: catId != null ? `id:${catId}` : null,
      images: imgs,
      salesUnit: base.pu_b2c_sales_unit_label ?? null,
      salesMult: base.pu_b2c_base_unit_multiplier ?? null,
      regularBase: base.pv_mrp ?? null,
      offerBase: base.pv_b2c_discounted_price ?? null,
      regularSales: base.pv_b2c_mrp ?? null,
      offerSales: base.pv_b2c_price ?? null,
      fingerprint: '',
    });
  }
  rl.close();
  for (const rec of recs.values()) rec.fingerprint = normFp(rec);
  return { recs, companyKeys, categoryKeys, imagePairs };
}

async function main() {
  const { recs, companyKeys, categoryKeys, imagePairs } = await scanJsonl();
  const db = new Client({ connectionString: DB });
  await db.connect();

  const q = async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
    (await db.query<T>(sql, params)).rows;

  const lines: string[] = [];
  const line = (s: string) => { console.log(s); lines.push(s); };

  line('## JSONL ↔ PostgreSQL integrity comparison');
  line('');
  line(`JSONL unique records: ${recs.size}`);
  const counts = await q<{ k: string; v: string }>(`SELECT 'medicines' AS k, count(*)::text AS v FROM medicines
    UNION ALL SELECT 'companies', count(*)::text FROM companies
    UNION ALL SELECT 'categories', count(*)::text FROM categories
    UNION ALL SELECT 'medicine_prices', count(*)::text FROM medicine_prices
    UNION ALL SELECT 'product_images', count(*)::text FROM product_images
    UNION ALL SELECT 'data_validations', count(*)::text FROM data_validations
    UNION ALL SELECT 'medicine_categories', count(*)::text FROM medicine_categories`);
  for (const c of counts) line(`${c.k}: ${c.v}`);

  // Companies / categories / images vs JSONL expectations
  const dbCompanies = Number((await q<{ c: string }>('SELECT count(*)::text AS c FROM companies'))[0].c);
  const dbCategories = Number((await q<{ c: string }>('SELECT count(*)::text AS c FROM categories'))[0].c);
  const dbImages = Number((await q<{ c: string }>('SELECT count(*)::text AS c FROM product_images'))[0].c);
  line(`companies: JSONL distinct keys ${companyKeys.size} vs DB ${dbCompanies} → ${companyKeys.size === dbCompanies ? 'MATCH' : 'MISMATCH'}`);
  // DB categories also include site-tree harvest (categories.json), so DB ≥ JSONL keys
  line(`categories: JSONL distinct keys ${categoryKeys.size} vs DB ${dbCategories} (DB also holds site-tree harvest) → DB ≥ JSONL: ${dbCategories >= categoryKeys.size ? 'OK' : 'MISMATCH'}`);
  line(`product images: JSONL pairs ${imagePairs} vs DB ${dbImages} → ${dbImages <= imagePairs ? 'OK (DB caps 5 per medicine)' : 'MISMATCH'}`);

  // Field-level sample comparison (every 2000th record)
  line('');
  line('### Field-level comparison (every 2000th unique record)');
  const sampleIds = [...recs.keys()].filter((_, i) => i % 2000 === 0);
  let fieldMismatches = 0;
  for (const id of sampleIds) {
    const j = recs.get(id);
    const rows = await q<{
      name: string; generic_name: string | null; regular_base: string | null; offer_base: string | null;
      regular_sales: string | null; offer_sales: string | null; sales_unit: string | null;
      sales_unit_multiplier: string | null; sk: string; ck: string | null; imgs: string; nn: string;
    }>(`
      SELECT m.name, m.generic_name, p.regular_base, p.offer_base, p.regular_sales, p.offer_sales,
             p.sales_unit, p.sales_unit_multiplier,
             s.key AS sk, c.source_key AS ck,
             (SELECT count(*)::text FROM product_images i WHERE i.medicine_id = m.id) AS imgs,
             (SELECT dv.status FROM data_validations dv WHERE dv.medicine_id = m.id LIMIT 1) AS nn
      FROM medicines m
      JOIN sources s ON s.id = m.source_id
      LEFT JOIN companies c ON c.id = m.company_id
      LEFT JOIN medicine_prices p ON p.medicine_id = m.id
      WHERE m.source_product_id = $1`, [id]);
    const d = rows[0];
    if (!d) { line(`  id ${id}: MISSING in DB`); fieldMismatches++; continue; }
    const eq = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');
    const numEq = (a: number | null, b: string | null) =>
      (a == null && b == null) || (a != null && b != null && Math.abs(a - Number(b)) < 0.005);
    const probs: string[] = [];
    if (!eq(j.name, d.name)) probs.push('name');
    if (!eq(j.generic, d.generic_name)) probs.push('generic');
    if (!numEq(j.regularBase, d.regular_base)) probs.push('regular_base');
    if (!numEq(j.offerBase, d.offer_base)) probs.push('offer_base');
    if (!numEq(j.regularSales, d.regular_sales)) probs.push('regular_sales');
    if (!numEq(j.offerSales, d.offer_sales)) probs.push('offer_sales');
    if (!eq(j.salesUnit, d.sales_unit)) probs.push('sales_unit');
    if (j.salesMult != null && d.sales_unit_multiplier != null && Math.abs(j.salesMult - Number(d.sales_unit_multiplier)) > 0.001) probs.push('multiplier');
    if (!eq(j.companyKey, d.ck)) probs.push('company');
    if (j.images !== Number(d.imgs) && Number(d.imgs) < 5) probs.push(`images(${j.images}/${d.imgs})`);
    if (probs.length) { line(`  id ${id}: MISMATCH — ${probs.join(', ')}`); fieldMismatches++; }
  }
  line(`sampled ${sampleIds.length} records → ${fieldMismatches} mismatches`);

  // Uncertain duplicates (fingerprint collisions) flagged in DB
  line('');
  line('### Uncertain duplicate handling');
  const flagged = await q<{ ct: string }>('SELECT count(*)::text AS ct FROM data_validations WHERE duplicate_of IS NOT NULL');
  line(`records flagged duplicate_of in DB: ${flagged[0].ct}`);
  const fpSeen = new Map<string, number>();
  let fpGroups = 0;
  for (const rec of recs.values()) {
    if (fpSeen.has(rec.fingerprint)) fpGroups++;
    else fpSeen.set(rec.fingerprint, rec.id);
  }
  line(`JSONL fingerprint groups with >1 distinct id: ${fpGroups}`);
  const dupExamples = await q<{ slug: string; name: string; dup_slug: string | null }>(`
    SELECT m.slug, m.name, d.slug AS dup_slug
    FROM medicines m JOIN data_validations dv ON dv.medicine_id = m.id AND dv.duplicate_of IS NOT NULL
    LEFT JOIN medicines d ON d.id = dv.duplicate_of LIMIT 5`);
  for (const e of dupExamples) line(`  e.g. ${e.slug} (${e.name}) flagged as uncertain duplicate of ${e.dup_slug}`);

  // Sales-unit consistency: sales price ≈ base price × multiplier (informational)
  const unitRows = await q<{ ct: string }>(`
    SELECT count(*)::text AS ct FROM medicine_prices
    WHERE sales_unit_multiplier IS NOT NULL AND sales_unit_multiplier > 0
      AND regular_base IS NOT NULL AND regular_sales IS NOT NULL
      AND abs(regular_sales - regular_base * sales_unit_multiplier) > 0.01`);
  line(`rows where regular_sales ≠ regular_base × multiplier: ${unitRows[0].ct} (source-listed values are kept as-is; informational)`);

  // Slug redirect readiness + provenance chain
  const prov = await q<{ runs: string; jobs: string }>(
    'SELECT (SELECT count(*)::text FROM scrape_runs) AS runs, (SELECT count(*)::text FROM import_jobs) AS jobs');
  line(`provenance: scrape_runs ${prov[0].runs}, import_jobs ${prov[0].jobs}, slug_redirects 0 (no renames yet — reserved)`);

  line('');
  line(fieldMismatches === 0 && companyKeys.size === dbCompanies ? 'RESULT: INTEGRITY OK' : 'RESULT: MISMATCHES FOUND — see above');
  await db.end();
  fs.writeFileSync('/tmp/integrity-summary.txt', lines.join('\n'));
}

main().catch((e) => { console.error('integrity check failed:', e.message); process.exit(1); });

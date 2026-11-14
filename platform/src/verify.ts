/* Medora — `npm run db:verify`: post-import database verification.
   Checks row counts, orphans, slug uniqueness, price sanity and a known
   spot-check (Napa 500 / source id 12474 from the Arogga crawl). */
import { pool, query } from './db.js';

interface Check { label: string; pass: boolean; detail: string }

const checks: Check[] = [];
function check(label: string, pass: boolean, detail: string) {
  checks.push({ label, pass, detail });
}

function n(v: unknown): string {
  return typeof v === 'string' ? v : String(v);
}

async function main() {
  const counts = await query<{
    medicines: string; companies: string; categories: string; prices: string;
    history: string; images: string; validations: string; runs: string; imports: string; redirects: string;
  }>(`
    SELECT
      (SELECT count(*) FROM medicines)            AS medicines,
      (SELECT count(*) FROM companies)            AS companies,
      (SELECT count(*) FROM categories)           AS categories,
      (SELECT count(*) FROM medicine_prices)      AS prices,
      (SELECT count(*) FROM price_history)        AS history,
      (SELECT count(*) FROM product_images)       AS images,
      (SELECT count(*) FROM data_validations)     AS validations,
      (SELECT count(*) FROM scrape_runs)          AS runs,
      (SELECT count(*) FROM import_jobs)          AS imports,
      (SELECT count(*) FROM slug_redirects)       AS redirects
  `);
  const c = counts.rows[0];
  console.log('── Row counts ──');
  for (const [k, v] of Object.entries(c)) console.log(`  ${k.padEnd(12)} ${v}`);
  check('medicines imported', Number(c.medicines) > 0, `${c.medicines} rows`);

  // Orphans (referential sanity beyond FK constraints, e.g. soft references)
  const orphans = await query<{ missing: string }>(`
    SELECT 'price_without_medicine' AS missing FROM medicine_prices p
      LEFT JOIN medicines m ON m.id = p.medicine_id WHERE m.id IS NULL
    UNION ALL
    SELECT 'medicine_without_company' FROM medicines m
      LEFT JOIN companies c ON c.id = m.company_id WHERE m.company_id IS NOT NULL AND c.id IS NULL
    UNION ALL
    SELECT 'image_without_medicine' FROM product_images i
      LEFT JOIN medicines m ON m.id = i.medicine_id WHERE m.id IS NULL
  `);
  check('no orphan rows', orphans.rows.length === 0, `${orphans.rows.length} found`);

  // Slug uniqueness (unique index already guarantees; verify anyway)
  const dupSlugs = await query<{ slug: string; ct: string }>(
    'SELECT slug, count(*) AS ct FROM medicines GROUP BY slug HAVING count(*) > 1 LIMIT 5',
  );
  check('slugs unique', dupSlugs.rows.length === 0, dupSlugs.rows.map((r) => r.slug).join(', ') || 'clean');

  // Price sanity: base-unit and sales-unit columns are stored separately
  const mixed = await query<{ ct: string }>(`
    SELECT count(*) AS ct FROM medicine_prices
    WHERE (regular_base IS NOT NULL AND regular_sales IS NOT NULL AND regular_sales < regular_base AND sales_unit_multiplier = 1)
       OR offer_base IS NULL AND offer_sales IS NOT NULL AND price_source = 'api'
  `);
  check('price units not collapsed', Number(mixed.rows[0].ct) === 0, `${mixed.rows[0].ct} suspicious rows`);

  // Spot check: Napa 500 (source id 12474) — known API values
  const napa = await query<{
    name: string; slug: string; generic_name: string; regular_base: string; offer_base: string;
    regular_sales: string; offer_sales: string; base_unit: string; sales_unit: string;
  }>(`
    SELECT m.name, m.slug, m.generic_name, p.regular_base, p.offer_base, p.regular_sales,
           p.offer_sales, p.base_unit, p.sales_unit
    FROM medicines m JOIN medicine_prices p ON p.medicine_id = m.id
    WHERE m.source_product_id = 12474 LIMIT 1
  `);
  if (napa.rows.length) {
    const row = napa.rows[0];
    check('spot check Napa 500 generic', row.generic_name.trim() === 'Paracetamol', row.generic_name);
    check('spot check Napa 500 prices', n(row.regular_base) === '1.20' && n(row.offer_base) === '1.08' && n(row.regular_sales) === '12.00' && n(row.offer_sales) === '10.80',
      `base ${n(row.regular_base)}/${n(row.offer_base)} · sales ${n(row.regular_sales)}/${n(row.offer_sales)}`);
    check('spot check Napa 500 units', row.base_unit === 'Tablet' && row.sales_unit === 'Strip', `${row.base_unit}/${row.sales_unit}`);
    console.log(`  spot check: ${row.name} (${row.slug}) — base ৳${n(row.regular_base)}/৳${n(row.offer_base)} per ${row.base_unit}, sales ৳${n(row.regular_sales)}/৳${row.offer_sales} per ${row.sales_unit}`);
  } else {
    check('spot check Napa 500 present', false, 'source_product_id 12474 not found');
  }

  const failed = checks.filter((x) => !x.pass);
  console.log('── Verification ──');
  for (const c2 of checks) console.log(`  ${c2.pass ? '✓' : '✗'} ${c2.label} — ${c2.detail}`);
  console.log(failed.length ? `FAILED: ${failed.length} check(s)` : 'ALL CHECKS PASSED');
  if (failed.length) process.exitCode = 1;
}

main()
  .then(() => pool.end())
  .catch((e) => { console.error('verify failed:', e instanceof Error ? e.message : e); process.exit(1); });

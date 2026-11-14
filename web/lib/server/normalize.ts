/* Medora — record normalization + validation, mirroring scrape.js rules exactly.
   Input: one JSONL line ({ _meta, record }) or a JSON object from the ingestion API.
   Output: a NormalizedRecord ready for batched upserts. */
import { z } from 'zod';

export type VerificationStatus = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NEEDS_RECHECK' | 'FAILED';

const RawVariant = z.object({
  pv_id: z.number().nullable().optional(),
  pv_is_base: z.union([z.number(), z.boolean()]).nullable().optional(),
  pv_attribute: z.unknown().optional(),
  pv_stock_status: z.number().nullable().optional(),
  pv_allow_purchase: z.number().nullable().optional(),
  pv_allow_sales: z.number().nullable().optional(),
  pv_mrp: z.number().nullable().optional(),
  pv_b2c_discounted_price: z.number().nullable().optional(),
  pv_b2c_mrp: z.number().nullable().optional(),
  pv_b2c_price: z.number().nullable().optional(),
  pv_b2c_discount_percent: z.number().nullable().optional(),
  pv_b2c_min_qty: z.number().nullable().optional(),
  pv_b2c_max_qty: z.number().nullable().optional(),
  pu_base_unit_label: z.string().nullable().optional(),
  pu_base_unit_multiplier: z.number().nullable().optional(),
  pu_b2c_sales_unit_label: z.string().nullable().optional(),
  pu_b2c_base_unit_multiplier: z.number().nullable().optional(),
});

const RawRecord = z.object({
  p_id: z.number(),
  p_name: z.string().nullable().optional(),
  p_name_bn: z.string().nullable().optional(),
  p_type: z.string().nullable().optional(),
  p_generic_id: z.number().nullable().optional(),
  p_generic_name: z.string().nullable().optional(),
  p_brand_id: z.number().nullable().optional(),
  p_brand: z.string().nullable().optional(),
  p_brand_name: z.string().nullable().optional(),
  p_manufacturer_id: z.number().nullable().optional(),
  p_company_id: z.number().nullable().optional(),
  p_manufacturer: z.string().nullable().optional(),
  p_form: z.string().nullable().optional(),
  p_strength: z.string().nullable().optional(),
  p_cat_id: z.number().nullable().optional(),
  p_product_category_id: z.number().nullable().optional(),
  p_active_status: z.string().nullable().optional(),
  p_rx_req: z.number().nullable().optional(),
  p_allow_sales: z.number().nullable().optional(),
  p_variant_count: z.number().nullable().optional(),
  p_stock_status: z.number().nullable().optional(),
  p_created_at: z.string().nullable().optional(),
  productUrl: z.string().nullable().optional(),
  pv: z.array(RawVariant).nullable().optional(),
  attachedFiles_p_images: z.array(z.object({
    src: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
  })).nullable().optional(),
  POSTER: z.string().nullable().optional(),
  _priceSource: z.enum(['api', 'api_plus_detail', 'detail_page']).optional(),
});

export interface NormalizedRecord {
  sourceProductId: number;
  name: string | null;
  nameBn: string | null;
  genericName: string | null;
  genericSourceId: number | null;
  strength: string | null;
  dosageForm: string | null;
  productType: string | null;
  prescriptionRequired: boolean;
  activeStatus: string | null;
  allowSales: boolean;
  variantCount: number | null;
  minQty: number | null;
  maxQty: number | null;
  companyKey: string;      // 'id:37' or 'name:skin-o'
  companyName: string;
  companySourceId: number | null;
  categoryKey: string | null; // 'id:6574'
  categoryType: string | null;
  prices: {
    baseUnit: string | null;
    baseUnitMultiplier: number | null;
    regularBase: number | null;
    offerBase: number | null;
    salesUnit: string | null;
    salesUnitMultiplier: number | null;
    regularSales: number | null;
    offerSales: number | null;
    discountPercent: number | null;
    priceSource: 'api' | 'api_plus_detail' | 'detail_page';
  };
  images: { url: string; title: string | null }[];
  missingFields: string[];
  validation: { status: VerificationStatus; issues: string[]; conflicts: unknown[] };
  /** Set by the importer when another record with the same fingerprint was
   *  already seen (uncertain duplicate — imported but flagged, never merged). */
  duplicateOf: number | null;
  fingerprint: string; // fuzzy duplicate detection
  priceChangedKey: string;
}

function numEq(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.005;
}

export function normalize(rawLine: unknown): { ok: true; rec: NormalizedRecord } | { ok: false; reason: string } {
  let obj: unknown;
  if (typeof rawLine === 'string') {
    try { obj = JSON.parse(rawLine); } catch { return { ok: false, reason: 'unparseable JSON line' }; }
  } else obj = rawLine;

  let record: unknown;
  if (obj && typeof obj === 'object' && 'record' in (obj as Record<string, unknown>)) {
    record = (obj as Record<string, unknown>).record; // JSONL envelope from scrape.js
  } else record = obj;

  const parsed = RawRecord.safeParse(record);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, reason: `schema: ${first.path.join('.')} ${first.message}` };
  }
  const raw = parsed.data;
  const pvArr = raw.pv ?? [];
  const base = pvArr.find((v) => v.pv_is_base === 1 || v.pv_is_base === true) ?? pvArr[0] ?? null;
  if (base == null) {
    return { ok: false, reason: `no variants (p_id ${raw.p_id})` };
  }

  const issues: string[] = [];
  const conflicts: unknown[] = [];
  const name = raw.p_name?.trim() || null;
  if (!name) issues.push('name missing');
  const genericName = raw.p_generic_name?.trim() || null;
  if (!genericName) issues.push('generic_name missing');

  const companyName = (raw.p_manufacturer ?? raw.p_brand ?? raw.p_brand_name ?? '').trim();
  if (!companyName) issues.push('manufacturer missing');
  const manufacturerId = raw.p_manufacturer_id ?? raw.p_company_id ?? null;
  const companyKey = manufacturerId != null ? `id:${manufacturerId}` : `name:${(companyName || 'unknown').toLowerCase()}`;

  const prices = {
    baseUnit: base.pu_base_unit_label ?? null,
    baseUnitMultiplier: base.pu_base_unit_multiplier ?? null,
    regularBase: base.pv_mrp ?? null,
    offerBase: base.pv_b2c_discounted_price ?? null,
    salesUnit: base.pu_b2c_sales_unit_label ?? null,
    salesUnitMultiplier: base.pu_b2c_base_unit_multiplier ?? null,
    regularSales: base.pv_b2c_mrp ?? null,
    offerSales: base.pv_b2c_price ?? null,
    discountPercent: base.pv_b2c_discount_percent ?? null,
    priceSource: raw._priceSource ?? 'api',
  };
  const present = [prices.regularBase, prices.offerBase, prices.regularSales, prices.offerSales]
    .filter((v) => v != null).length;
  if (prices.regularBase == null && prices.offerBase == null) issues.push('base-unit prices missing (pv_mrp / pv_b2c_discounted_price)');
  if (prices.regularSales == null && prices.offerSales == null) issues.push('sales-unit prices missing (pv_b2c_mrp / pv_b2c_price)');
  if (!prices.salesUnit) issues.push('sales unit label missing');

  for (const [label, v] of Object.entries({
    regularBase: prices.regularBase, offerBase: prices.offerBase,
    regularSales: prices.regularSales, offerSales: prices.offerSales,
  }) as [string, number | null][]) {
    if (v != null && !(v >= 0)) issues.push(`${label} is negative/invalid (${v})`);
  }
  if (prices.regularBase != null && prices.offerBase != null && prices.offerBase > prices.regularBase) {
    conflicts.push({ field: 'base-unit', regular: prices.regularBase, offer: prices.offerBase, note: 'offer price exceeds regular price — possible field swap; both values preserved' });
  }
  if (prices.regularSales != null && prices.offerSales != null && prices.offerSales > prices.regularSales) {
    conflicts.push({ field: 'sales-unit', regular: prices.regularSales, offer: prices.offerSales, note: 'offer price exceeds regular price — possible field swap; both values preserved' });
  }

  const images: { url: string; title: string | null }[] = [];
  for (const img of raw.attachedFiles_p_images ?? []) {
    if (img.src) images.push({ url: img.src, title: img.title ?? null });
  }
  if (!images.length && raw.POSTER) images.push({ url: raw.POSTER, title: null });
  if (!images.length) issues.push('image missing');

  const missingFields = [...issues];

  let status: VerificationStatus;
  const hasStructuralFailure = !name;
  const hasPriceAnomaly = conflicts.length > 0 || present === 0
    || issues.some((i) => i.includes('negative/invalid'));
  if (hasStructuralFailure) status = 'FAILED';
  else if (hasPriceAnomaly) status = 'NEEDS_RECHECK';
  else if (issues.length) status = 'PARTIALLY_VERIFIED';
  else status = 'VERIFIED';

  const fingerprint = [
    name, raw.p_strength, genericName, companyName, raw.p_form,
    (prices.salesUnit ?? '') + 'x' + (prices.salesUnitMultiplier ?? ''),
  ].map((s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');

  const priceChangedKey = JSON.stringify([
    prices.regularBase, prices.offerBase, prices.regularSales, prices.offerSales,
    prices.baseUnit, prices.salesUnit, prices.salesUnitMultiplier, prices.discountPercent,
    base.pv_b2c_min_qty ?? null, base.pv_b2c_max_qty ?? null,
  ]);

  return {
    ok: true,
    rec: {
      sourceProductId: raw.p_id,
      name,
      nameBn: raw.p_name_bn?.trim() || null,
      genericName,
      genericSourceId: raw.p_generic_id ?? null,
      strength: raw.p_strength?.trim() || null,
      dosageForm: raw.p_form?.trim() || null,
      productType: raw.p_type?.trim() || null,
      prescriptionRequired: raw.p_rx_req === 1,
      activeStatus: raw.p_active_status ?? null,
      allowSales: raw.p_allow_sales !== 0,
      variantCount: raw.p_variant_count ?? null,
      minQty: base.pv_b2c_min_qty ?? null,
      maxQty: base.pv_b2c_max_qty ?? null,
      companyKey,
      companyName: companyName || '(unknown)',
      companySourceId: manufacturerId,
      categoryKey: raw.p_product_category_id != null ? `id:${raw.p_product_category_id}`
        : raw.p_cat_id != null ? `id:${raw.p_cat_id}` : null,
      categoryType: raw.p_type?.trim() || null,
      prices,
      images,
      missingFields,
      validation: { status, issues, conflicts },
      duplicateOf: null,
      fingerprint,
      priceChangedKey,
    },
  };
}

export { numEq };

# IMPORT_REPORT — Medora

Generated: 2026-11-14T13:17:14.435Z
Mode: FULL IMPORT
Input files: products.jsonl
Duration: 11.3s
Import job: 1

## Totals

| Metric | Count |
| --- | --- |
| Total input records | 107,396 |
| Parsed / valid records | 58,297 |
| Imported (new) | 58,297 |
| Updated (changed on re-import) | 0 |
| Unchanged (idempotent skip) | 0 |
| Skipped (no usable variant) | 0 |
| Failed records (schema-invalid) | 0 |
| Corrupt lines (unparseable JSON) | 0 |
| Duplicate candidates (reported, never merged) | 49,174 |
| Records missing images | 2,390 |
| Records with invalid/anomalous prices | 142 |
| Price-history entries appended | 0 |
| Slug collisions resolved (suffixed) | 1,777 |

## Database verification

Run `npm run db:verify` for the full post-import verification output (counts, orphans, slug uniqueness, spot checks).

## Notes

- Price columns keep their source semantics: `pv_mrp` → regular_base, `pv_b2c_discounted_price` → offer_base,
  `pv_b2c_mrp` → regular_sales, `pv_b2c_price` → offer_sales. Base-unit and sales-unit prices are stored
  separately and never derived from each other.
- Duplicate candidates are recorded in `data_validations` and this report; records are never merged automatically.
- Re-running the import is idempotent: unchanged records are left untouched, changed prices append history.

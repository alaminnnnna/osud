
> **Phase 4 update (2026-11-14):** This document is preserved as a historical
> record of the phase it describes. Statements about the architecture —
> separate backend/frontend deployments, PostgreSQL as the live database,
> static-site frontend, Express API — are **superseded**: Medora is now one
> unified Next.js application (frontend + `/api/v1` on one origin) over an
> **embedded SQLite database** (`data/medora.sqlite`, no external database
> service). See `PHASE4_COMPLETION_REPORT.md` and `README.md`. The measured
> results below are kept exactly as they were recorded.

# IMPORT_REPORT — Medora

Generated: 2026-11-14T15:24:30.884Z
Mode: FULL IMPORT
Database: /tmp/test-import.sqlite
Input files: products.jsonl
Duration: 20.8s
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
| Uncertain duplicate candidates (flagged, never merged) | 49,174 |
| Records missing images | 2,390 |
| Invalid prices (NEEDS_RECHECK) | 142 |
| Price-history rows appended | 0 |
| Slug collisions resolved | 1,777 |

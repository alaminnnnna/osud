# Prisma notes — how to adopt the Prisma client

## Why the runtime ships with `pg` instead of `@prisma/client`

The preferred stack asks for Prisma, and the **canonical schema is provided** at
`prisma/schema.prisma` — it maps 1:1 to `db/migrations/*.sql`. The runtime data
layer uses `node-postgres` because `@prisma/client` requires binary engine
downloads (`prisma generate` fetches query engines from `binaries.prisma.sh`),
which are unavailable in restricted build environments. `pg` keeps `npm install`
fully reproducible with zero binary dependencies.

## Switching to the Prisma client (mechanical)

```bash
cd platform
npm install @prisma/client
npm install -D prisma
npx prisma generate                      # downloads the engine; generates types

# Option A — adopt the existing tables (they already match schema.prisma):
npx prisma db pull                      # verify introspection matches

# Option B — let Prisma own migrations instead of db/migrations/*.sql:
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0001_init/migration.sql
npx prisma migrate deploy
```

Then replace `src/db.ts` with:

```ts
import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
```

and swap the raw upserts in `src/importer.ts::upsertBatch` for
`prisma.medicine.upsert(...)` calls (or keep the SQL — PrismaClient supports
`$executeRaw` with identical semantics). `src/config.ts` (zod) and the API layer
are unchanged.

## Schema highlights

- `sources` / `scrape_runs` / `import_jobs` — provenance chain for every row.
- `medicines` — stable `(source_id, source_product_id)` unique key, canonical
  unique `slug`, `verification_status` + `missing_fields[]`, `search_vector`
  generated tsvector (see migration 0002).
- `medicine_prices` — one current row per medicine; base-unit and sales-unit
  prices are separate columns sourced from `pv_mrp`, `pv_b2c_discounted_price`,
  `pv_b2c_mrp`, `pv_b2c_price` respectively (column comments preserve the
  original API field names).
- `price_history` — append-only snapshots with `changed_fields` + `recorded_at`.
- `data_validations` — latest validation per medicine incl. `conflicts` and
  `duplicate_of` (fuzzy candidates are recorded, never merged).
- `slug_redirects` — old-slug → new-slug for 301s.

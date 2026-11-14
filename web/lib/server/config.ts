/* Medora — unified app configuration (zod), server-side only.
   Next.js loads .env / .env.local automatically; this module validates and
   defaults the variables the unified application needs.
   Phase 4 (SQLite): the database is a project-local file — MEDORA_DB_PATH —
   no separately rented database service is required. DATABASE_URL is kept as
   an optional legacy variable only so environments that still carry it are
   not rejected by validation. */
import { z } from 'zod';

const schema = z.object({
  // Self-contained SQLite database file (created by `npm run db:init`,
  // populated by the PG migrator or `npm run import:data`).
  MEDORA_DB_PATH: z.string().default(''),
  // Legacy PostgreSQL URL — accepted but unused by the unified app.
  DATABASE_URL: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  ACCESS_CONTROL_ORIGIN: z.string().default('*'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(120),
  CACHE_LIST_SECONDS: z.coerce.number().int().min(0).default(60),
  ADMIN_USERNAME: z.string().default(''),
  ADMIN_PASSWORD: z.string().default(''),
  INGEST_TOKEN: z.string().default(''),
  NEXT_PUBLIC_SITE_URL: z.string().default('http://localhost:3000'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const msgs = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error('Invalid environment configuration:\n' + msgs);
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.ACCESS_CONTROL_ORIGIN === '*'
    ? '*' as const
    : parsed.data.ACCESS_CONTROL_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  adminEnabled: parsed.data.ADMIN_USERNAME !== '' && parsed.data.ADMIN_PASSWORD !== '',
  ingestEnabled: parsed.data.INGEST_TOKEN !== '',
};
export type Config = typeof config;

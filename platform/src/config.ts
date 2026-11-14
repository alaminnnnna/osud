/* Medora — typed environment configuration (zod). Loads .env if present, then
   reads process.env. Fails fast with a readable message on misconfiguration. */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Minimal .env loader (no dependency): KEY=VALUE lines, # comments.
(function loadDotEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const key = m[1] as string;
    let val = m[2] as string;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

const schema = z.object({
  // Default exists so validation-only commands (import:dry-run) work without env;
  // anything that touches the database fails loudly if the URL is unreachable.
  DATABASE_URL: z.string().default('postgres://medora:medora@localhost:5432/medora'),
  DATA_DIR: z.string().default('../data'),
  PORT: z.coerce.number().int().positive().default(4000),
  ACCESS_CONTROL_ORIGIN: z.string().default('*'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(120),
  CACHE_LIST_SECONDS: z.coerce.number().int().min(0).default(60),
  ADMIN_USERNAME: z.string().default(''),
  ADMIN_PASSWORD: z.string().default(''),
  INGEST_TOKEN: z.string().default(''),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const msgs = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error('Invalid environment configuration:\n' + msgs);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.ACCESS_CONTROL_ORIGIN === '*'
    ? '*'
    : parsed.data.ACCESS_CONTROL_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  adminEnabled: parsed.data.ADMIN_USERNAME !== '' && parsed.data.ADMIN_PASSWORD !== '',
  ingestEnabled: parsed.data.INGEST_TOKEN !== '',
};
export type Config = typeof config;

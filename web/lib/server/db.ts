/* Medora — PostgreSQL pool + small query helpers (unified app, server-only).
   Same semantics as the platform pool: point DATABASE_URL at a POOLED
   connection string (PgBouncer transaction mode) on serverless platforms and
   keep DB_POOL_MAX small. */
import pg from 'pg';
import { config } from './config';

export type PoolClient = pg.PoolClient;

const globalForPg = globalThis as unknown as { __medoraPool?: pg.Pool };

// Reuse one pool across hot reloads / serverless invocations.
export const pool: pg.Pool = globalForPg.__medoraPool ?? new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
if (!globalForPg.__medoraPool) globalForPg.__medoraPool = pool;

export function query<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function dbHealthy(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

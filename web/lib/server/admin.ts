/* Medora — admin metrics aggregation (unified app, server-only).
   Ported from the /api/v1/admin/metrics route of the superseded Express
   server; same payload shape for the admin dashboard. */
import { pool, query } from './db';
import { getStats } from './queries';

export async function adminMetrics() {
  const [stats, imports, recentChanges, failures] = await Promise.all([
    getStats(),
    pool.query(`SELECT id, mode, status, started_at AS "startedAt", finished_at AS "finishedAt", totals
                FROM import_jobs ORDER BY started_at DESC LIMIT 10`),
    pool.query(`SELECT ph.medicine_id AS "medicineId", m.name, m.slug,
                       ph.regular_sales AS "regularSales", ph.offer_sales AS "offerSales",
                       ph.changed_fields AS "changedFields", ph.recorded_at AS "recordedAt"
                FROM price_history ph JOIN medicines m ON m.id = ph.medicine_id
                ORDER BY ph.recorded_at DESC LIMIT 20`),
    pool.query(`SELECT status, count(*) AS ct FROM data_validations GROUP BY status`),
  ]);
  return {
    stats,
    imports: imports.rows,
    recentPriceChanges: recentChanges.rows,
    validationBreakdown: failures.rows,
    database: { poolTotal: pool.totalCount, poolIdle: pool.idleCount, poolWaiting: pool.waitingCount },
  };
}

export { query };

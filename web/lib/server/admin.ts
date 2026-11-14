/* Medora — admin metrics aggregation (unified app, server-only).
   Same payload shape the admin dashboard renders. SQLite runtime stats
   replace the PostgreSQL pool counters. */
import { all, get, sqliteStats } from './db';
import { getStats } from './queries';

export async function adminMetrics() {
  const [stats, imports, recentChanges, failures] = await Promise.all([
    getStats(),
    Promise.resolve(all(`SELECT id, mode, status, started_at AS "startedAt", finished_at AS "finishedAt", totals
                FROM import_jobs ORDER BY started_at DESC LIMIT 10`)),
    Promise.resolve(all(`SELECT ph.medicine_id AS "medicineId", m.name, m.slug,
                       CAST(ph.regular_sales AS TEXT) AS "regularSales", CAST(ph.offer_sales AS TEXT) AS "offerSales",
                       ph.changed_fields AS "changedFields", ph.recorded_at AS "recordedAt"
                FROM price_history ph JOIN medicines m ON m.id = ph.medicine_id
                ORDER BY ph.recorded_at DESC LIMIT 20`)),
    Promise.resolve(all(`SELECT status, count(*) AS ct FROM data_validations GROUP BY status`)),
  ]);
  const dbFile = sqliteStats();
  return {
    stats,
    imports: imports.map((i) => ({ ...i, totals: i.totals ? JSON.parse(String(i.totals)) : null })),
    recentPriceChanges: recentChanges.map((r) => ({
      ...r,
      changedFields: r.changedFields ? JSON.parse(String(r.changedFields)) : [],
    })),
    validationBreakdown: failures,
    database: {
      engine: 'sqlite' as const,
      fileBytes: dbFile.fileBytes,
      poolTotal: 1, // single embedded connection
      poolIdle: 1,
      poolWaiting: 0,
    },
  };
}

export { get };

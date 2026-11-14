/* Medora — /admin: protected dashboard. middleware.ts enforces Basic auth
   before this page; metrics come from the backend with server-held creds. */
import type { Metadata } from 'next';
import { adminApi, type AdminMetrics } from '@/lib/api';
import { num, stampDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const metrics = await adminApi<AdminMetrics>('/admin/metrics');
  if (!metrics?.data) {
    return (
      <div className="card mx-auto max-w-md p-6 text-center">
        <h1 className="text-[18px] font-medium">Admin unavailable</h1>
        <p className="mt-2 text-[13px]" style={{ color: 'var(--fg-2)' }}>
          Set <span className="mono">ADMIN_USERNAME</span> and <span className="mono">ADMIN_PASSWORD</span> on both
          the platform backend and this frontend to enable the dashboard. This page is never indexed.
        </p>
      </div>
    );
  }
  const d = metrics.data;
  const cards: [string, string][] = [
    ['Medicines', num(d.stats.medicines)],
    ['Verified', num(d.stats.verified)],
    ['Needs re-check', num(d.stats.needsRecheck)],
    ['Offers', num(d.stats.offers)],
    ['Companies', num(d.stats.companies)],
    ['Categories', num(d.stats.categories)],
    ['Missing images', num(d.stats.missingImages)],
    ['History entries', num(d.stats.priceHistoryEntries)],
  ];
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-[24px] font-medium">Admin — data monitoring</h1>
        <span className="badge mono">DB pool {d.database.poolTotal}/{d.database.poolIdle} idle</span>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Dataset metrics">
        {cards.map(([k, v]) => (
          <div key={k} className="card px-4 py-3">
            <div className="text-[11px]" style={{ color: 'var(--fg-3)' }}>{k}</div>
            <div className="mono mt-1 text-[22px]">{v}</div>
          </div>
        ))}
      </section>

      <section className="card overflow-hidden" aria-label="Validation breakdown">
        <div className="border-b hairline px-4 py-2.5 text-[13px] font-medium">Validation breakdown</div>
        <div className="flex flex-wrap gap-2 p-4">
          {d.validationBreakdown.map((v) => (
            <span key={v.status} className="badge mono" style={
              v.status === 'VERIFIED' ? { color: 'var(--accent)' }
                : v.status === 'NEEDS_RECHECK' ? { color: 'var(--warning)' }
                  : v.status === 'FAILED' ? { color: 'var(--danger)' } : undefined
            }>{v.status}: {num(v.ct)}</span>
          ))}
        </div>
      </section>

      <section className="card overflow-hidden" aria-label="Import history">
        <div className="border-b hairline px-4 py-2.5 text-[13px] font-medium">Import history</div>
        <table className="mono w-full text-[12px]">
          <thead>
            <tr className="border-b hairline text-left text-[11px]" style={{ color: 'var(--fg-3)' }}>
              <th className="p-3 font-medium">Job</th><th className="p-3 font-medium">Mode</th>
              <th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Imported</th>
              <th className="p-3 font-medium">Duplicates</th><th className="p-3 font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {d.imports.map((j) => (
              <tr key={j.id} className="border-b hairline last:border-0">
                <td className="p-3">#{j.id}</td>
                <td className="p-3">{j.mode}</td>
                <td className="p-3" style={{ color: j.status === 'completed' ? 'var(--accent)' : 'var(--warning)' }}>{j.status}</td>
                <td className="p-3">{num(j.totals?.importedRecords ?? 0)}</td>
                <td className="p-3">{num(j.totals?.duplicateCandidates ?? 0)}</td>
                <td className="p-3">{stampDateTime(j.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card overflow-hidden" aria-label="Recent price changes">
        <div className="border-b hairline px-4 py-2.5 text-[13px] font-medium">Recent price changes</div>
        {d.recentPriceChanges.length === 0 ? (
          <p className="px-4 py-3 text-[13px]" style={{ color: 'var(--fg-2)' }}>No price changes recorded yet.</p>
        ) : (
          <table className="mono w-full text-[12px]">
            <thead>
              <tr className="border-b hairline text-left text-[11px]" style={{ color: 'var(--fg-3)' }}>
                <th className="p-3 font-medium">Medicine</th>
                <th className="p-3 font-medium">Offer (strip)</th>
                <th className="p-3 font-medium">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {d.recentPriceChanges.map((c) => (
                <tr key={`${c.medicineId}-${c.recordedAt}`} className="border-b hairline last:border-0">
                  <td className="p-3"><a href={`/${c.slug}`} className="underline decoration-dotted">{c.name}</a></td>
                  <td className="p-3">{c.offerSales != null ? `৳${c.offerSales}` : '—'}</td>
                  <td className="p-3">{stampDateTime(c.recordedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

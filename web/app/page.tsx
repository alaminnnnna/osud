/* Medora — homepage: hero with live price board, stats band, discovery sections.
   Server Component; data from the PostgreSQL-backed API (fresh, never bundled). */
import Link from 'next/link';
import { api, type StatsData, type MedicineListItem, type CompanyItem, type CategoryItem } from '@/lib/api';
import { num } from '@/lib/format';
import { MedicineCard, DataFreshness, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [statsRes, offersRes, companiesRes, categoriesRes] = await Promise.all([
    api<StatsData>('/stats', { revalidate: 30 }),
    api<MedicineListItem[]>('/offers?limit=8&sort=discount', { revalidate: 120 }),
    api<CompanyItem[]>('/companies?limit=10', { revalidate: 300 }),
    api<CategoryItem[]>('/categories?limit=12', { revalidate: 300 }),
  ]);
  const stats = statsRes.data;
  const priceBoard = offersRes.data.slice(0, 5);

  return (
    <div className="flex flex-col gap-10">
      <section className="grid gap-6 md:grid-cols-[1fr_380px]">
        <div className="flex flex-col justify-center gap-4">
          <h1 className="text-[28px] font-medium leading-tight md:text-[40px]">
            What does your medicine<br />cost today?
          </h1>
          <p className="max-w-[52ch] text-[14px]" style={{ color: 'var(--fg-2)' }}>
            {num(stats.medicines)} medicines from {num(stats.companies)} companies, with per-strip and
            per-tablet prices kept separately, listed offers, and price history — checked against the
            source catalogue so you never confuse a tablet price with a strip price.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/search" className="btn btn-primary">Browse medicines</Link>
            <Link href="/offers" className="btn">{num(stats.offers)} live offers</Link>
            <DataFreshness lastVerifiedAt={stats.lastVerifiedAt} scrapedAt={stats.lastScrapeRun?.started_at ?? null} />
          </div>
        </div>
        {/* Real price board — actual crawled data, not a mockup */}
        <div className="card overflow-hidden" aria-label="Live price board">
          <div className="mono flex items-center justify-between border-b hairline px-4 py-2 text-[11px]" style={{ color: 'var(--fg-3)' }}>
            <span>PRICE BOARD — TODAY</span>
            <span>sales unit</span>
          </div>
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {priceBoard.map((m) => (
              <li key={m.slug}>
                <Link href={`/${m.slug}`} className="mono flex items-baseline justify-between gap-3 px-4 py-2.5 text-[13px] hover:opacity-80">
                  <span className="truncate">{m.name}</span>
                  <span style={{ color: 'var(--accent)' }}>
                    ৳{m.price.offerSales ?? m.price.regularSales}
                    {m.price.hasOffer && <s className="ml-1.5 text-[11px]" style={{ color: 'var(--fg-3)' }}>৳{m.price.regularSales}</s>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-label="Dataset" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Medicines', num(stats.medicines)],
          ['Verified', num(stats.verified)],
          ['Companies', num(stats.companies)],
          ['History entries', num(stats.priceHistoryEntries)],
        ].map(([k, v]) => (
          <div key={k} className="card px-4 py-3">
            <div className="text-[11px]" style={{ color: 'var(--fg-3)' }}>{k}</div>
            <div className="mono mt-1 text-[22px]">{v}</div>
          </div>
        ))}
      </section>

      <section aria-label="Top offers">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[20px] font-medium">Biggest listed offers</h2>
          <Link href="/offers" className="text-[13px]" style={{ color: 'var(--accent)' }}>All offers →</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {offersRes.data.map((m) => <MedicineCard key={m.slug} med={m} showCompare={false} />)}
        </div>
      </section>

      <section aria-label="Categories">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[20px] font-medium">Browse by category</h2>
          <Link href="/categories" className="text-[13px]" style={{ color: 'var(--accent)' }}>All categories →</Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {categoriesRes.data.map((c) => (
            <Link key={c.slug} href={`/categories/${c.slug}`} className="badge min-h-[32px] px-3 text-[12px] hover:opacity-85">
              {c.name} <span className="mono" style={{ color: 'var(--fg-3)' }}>{num(c.productCount)}</span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="Companies">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[20px] font-medium">Largest companies</h2>
          <Link href="/companies" className="text-[13px]" style={{ color: 'var(--accent)' }}>All companies →</Link>
        </div>
        <ul className="card divide-y" style={{ borderColor: 'var(--border)' }}>
          {companiesRes.data.map((c) => (
            <li key={c.slug}>
              <Link href={`/companies/${c.slug}`} className="mono flex items-baseline justify-between px-4 py-2.5 text-[13px] hover:opacity-80">
                <span>{c.name}</span>
                <span style={{ color: 'var(--fg-3)' }}>{num(c.productCount)} products</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {stats.medicines === 0 && (
        <EmptyState title="Catalog not imported yet"
          hint="The database is reachable but empty. Run `npm run db:migrate && npm run import:data` in platform/."
          action={<Link className="btn" href="/api-docs">Setup guide</Link>} />
      )}
    </div>
  );
}

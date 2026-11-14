/* Medora — /offers: only genuinely discounted items from the source data. */
import type { Metadata } from 'next';
import { api, type MedicineListItem } from '@/lib/api';
import { num } from '@/lib/format';
import { MedicineCard, Pagination, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Live medicine offers',
  description: 'Medicines whose listed offer price is genuinely below the regular price in the source catalogue — never invented discounts.',
  alternates: { canonical: '/offers' },
};

export default async function OffersPage({ searchParams }: { searchParams: Promise<{ page?: string; sort?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const sort = sp.sort === 'recent' || sp.sort === 'price-asc' ? sp.sort : 'discount';
  const { data, pagination } = await api<MedicineListItem[]>(`/offers?page=${page}&limit=24&sort=${sort}`, { noStore: true });
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-[24px] font-medium">Offers</h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--fg-2)' }}>
            {num(pagination?.total ?? 0)} medicines where the source lists a real discount. Prices as listed — including the source’s own flash offers.
          </p>
        </div>
        <nav aria-label="Sort" className="flex gap-1.5">
          {(['discount', 'recent', 'price-asc'] as const).map((s) => (
            <a key={s} href={`/offers?sort=${s}`} className="badge min-h-[28px] cursor-pointer px-3 text-[12px]"
              style={sort === s ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}>
              {s === 'discount' ? 'Biggest discount' : s === 'recent' ? 'Recently verified' : 'Lowest price'}
            </a>
          ))}
        </nav>
      </header>
      {data.length === 0
        ? <EmptyState title="No offers in the catalogue right now" hint="Offers appear only when the source data lists one." />
        : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {data.map((m) => <MedicineCard key={m.slug} med={m} />)}
            </div>
            <Pagination page={page} totalPages={pagination?.totalPages ?? 1} makeHref={(p) => `/offers?page=${p}&sort=${sort}`} />
          </>
        )}
    </div>
  );
}

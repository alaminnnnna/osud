/* Medora — /search: server-rendered results over the backend search API,
   with client filters rail and server pagination. */
import type { Metadata } from 'next';
import { api, type MedicineListItem, type CompanyItem } from '@/lib/api';
import { num } from '@/lib/format';
import { MedicineCard, Pagination, EmptyState } from '@/components/ui';
import { Filters } from '@/components/filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search medicines',
  description: 'Search 58,000+ Bangladesh medicine prices by brand, generic, company, form and price. Typo-tolerant, exact matches first.',
  alternates: { canonical: '/search' },
};

interface SP { q?: string; company?: string; form?: string; offer?: string; min?: string; max?: string; sort?: string; page?: string }

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = new URLSearchParams();
  for (const k of ['q', 'company', 'form', 'offer', 'min', 'max', 'sort'] as const) {
    if (sp[k]) qs.set(k, sp[k]);
  }
  qs.set('page', String(page));
  qs.set('limit', '24');

  let data: MedicineListItem[] = [];
  let total = 0;
  let totalPages = 1;
  let error: string | null = null;
  try {
    const res = await api<{ query: string; mode: string; items: MedicineListItem[] }>(`/search?${qs.toString()}`, { noStore: true });
    data = res.data.items;
    void res.data.mode;
    total = res.pagination?.total ?? 0;
    totalPages = res.pagination?.totalPages ?? 1;
  } catch (e) {
    error = e instanceof Error ? e.message : 'Search failed';
  }

  let forms: string[] = [];
  let companies: { slug: string; name: string }[] = [];
  try {
    const cRes = await api<CompanyItem[]>('/companies?limit=50', { revalidate: 600 });
    companies = cRes.data.map((c) => ({ slug: c.slug, name: c.name }));
  } catch { /* filters degrade gracefully */ }

  const makeHref = (p: number) => {
    const n = new URLSearchParams(qs.toString());
    n.set('page', String(p));
    return `/search?${n.toString()}`;
  };

  return (
    <div className="flex gap-6">
      <Filters
        forms={[]}
        companies={companies.map((c) => ({ value: c.slug, label: c.name }))}
      />
      <section className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-[20px] font-medium">
            {sp.q ? <>Results for <span className="mono">“{sp.q}”</span></> : 'All medicines'}
          </h1>
          <span className="mono text-[12px]" style={{ color: 'var(--fg-3)' }}>{num(total)} medicines</span>
        </div>

        {error && (
          <div className="card px-4 py-3 text-[13px]" style={{ color: 'var(--danger)' }} role="alert">
            Could not load results: {error} — the backend may be restarting. Try again.
          </div>
        )}

        {!error && data.length === 0 && (
          <EmptyState
            title="No medicines match"
            hint="Check the spelling, or try the generic name (e.g. “paracetamol”), a company, or clear the filters."
          />
        )}

        {!error && data.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.map((m) => <MedicineCard key={m.slug} med={m} />)}
            </div>
            <Pagination page={page} totalPages={totalPages} makeHref={makeHref} />
          </>
        )}
      </section>
    </div>
  );
}

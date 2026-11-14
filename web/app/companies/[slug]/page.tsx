/* Medora — company detail /[company-slug]. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, type CompanyItem, type MedicineListItem, ApiError, SITE_URL } from '@/lib/api';
import { num } from '@/lib/format';
import { MedicineCard, Pagination, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const { data: c } = await api<CompanyItem>(`/companies/${encodeURIComponent(slug)}`, { revalidate: 600 });
    return {
      title: `${c.name} — ${num(c.productCount)} medicine prices`,
      description: `${c.name} medicines with per-strip and per-tablet prices as listed by the source catalogue.`,
      alternates: { canonical: `/companies/${c.slug}` },
      openGraph: { title: `${c.name} · Medora`, url: `${SITE_URL}/companies/${c.slug}` },
    };
  } catch (e) {
    // Raise the 404 during metadata so the HTTP status is correct (the page
    // body streams after metadata and can no longer change the status code).
    if (e instanceof ApiError && e.status === 404) notFound();
    return { title: 'Company not found', robots: { index: false, follow: false } };
  }
}

export default async function CompanyDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  let company: CompanyItem;
  try {
    company = (await api<CompanyItem>(`/companies/${encodeURIComponent(slug)}`, { revalidate: 600 })).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  let medicines: MedicineListItem[] = [];
  let totalPages = 1;
  try {
    const res = await api<MedicineListItem[]>(`/medicines?company=${encodeURIComponent(slug)}&page=${page}&limit=24&sort=name`, { noStore: true });
    medicines = res.data;
    totalPages = res.pagination?.totalPages ?? 1;
  } catch { /* header still renders */ }

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="mono text-[12px]" style={{ color: 'var(--fg-3)' }}>
        <Link href="/companies">Companies</Link> / <span style={{ color: 'var(--fg-2)' }}>{company.name}</span>
      </nav>
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-[24px] font-medium">{company.name}</h1>
        <span className="badge mono">{num(company.productCount)} products</span>
      </header>
      {medicines.length === 0
        ? <EmptyState title="No medicines listed for this company yet" />
        : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {medicines.map((m) => <MedicineCard key={m.slug} med={m} />)}
            </div>
            <Pagination page={page} totalPages={totalPages} makeHref={(p) => `/companies/${slug}?page=${p}`} />
          </>
        )}
    </div>
  );
}

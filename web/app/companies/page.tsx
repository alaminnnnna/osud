/* Medora — companies directory. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { api, type CompanyItem } from '@/lib/api';
import { num } from '@/lib/format';
import { Pagination } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Medicine companies',
  description: 'All medicine companies in the Bangladesh price catalogue with live product counts.',
  alternates: { canonical: '/companies' },
};

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { data, pagination } = await api<CompanyItem[]>(`/companies?page=${page}&limit=50`, { revalidate: 300 });
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[24px] font-medium">Medicine companies</h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--fg-2)' }}>
          Every company in the catalogue with its live product count ({num(pagination?.total ?? 0)} total).
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((c) => (
          <Link key={c.slug} href={`/companies/${c.slug}`} className="card flex items-baseline justify-between gap-2 p-4 hover:opacity-90">
            <span className="truncate text-[14px] font-medium">{c.name}</span>
            <span className="mono shrink-0 text-[12px]" style={{ color: 'var(--fg-3)' }}>{num(c.productCount)}</span>
          </Link>
        ))}
      </div>
      <Pagination page={page} totalPages={pagination?.totalPages ?? 1} makeHref={(p) => `/companies?page=${p}`} />
    </div>
  );
}

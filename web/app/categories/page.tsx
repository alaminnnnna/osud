/* Medora — categories directory. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { api, type CategoryItem } from '@/lib/api';
import { num } from '@/lib/format';
import { Pagination } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Medicine categories',
  description: 'Browse the Bangladesh medicine catalogue by product category with live counts.',
  alternates: { canonical: '/categories' },
};

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { data, pagination } = await api<CategoryItem[]>(`/categories?page=${page}&limit=60`, { revalidate: 300 });
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[24px] font-medium">Categories</h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--fg-2)' }}>
          Product categories from the source catalogue ({num(pagination?.total ?? 0)} with medicines).
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((c) => (
          <Link key={c.slug} href={`/categories/${c.slug}`} className="card flex items-baseline justify-between gap-2 p-4 hover:opacity-90">
            <span className="truncate text-[14px] font-medium">{c.name}</span>
            <span className="mono shrink-0 text-[12px]" style={{ color: 'var(--fg-3)' }}>{num(c.productCount)}</span>
          </Link>
        ))}
      </div>
      <Pagination page={page} totalPages={pagination?.totalPages ?? 1} makeHref={(p) => `/categories?page=${p}`} />
    </div>
  );
}

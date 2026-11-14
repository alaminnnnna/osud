/* Medora — /compare: side-by-side price comparison from the compare tray. */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { useCompare } from '@/lib/client-store';
import { tk } from '@/lib/format';

interface Detail {
  slug: string; name: string; company: string | null; generic: string | null; strength: string | null;
  regularBase: number | null; offerBase: number | null; regularSales: number | null; offerSales: number | null;
  baseUnit: string | null; salesUnit: string | null; salesUnitMultiplier: number | null;
}

export default function ComparePage() {
  const { items, toggle, clear } = useCompare();
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!items.length) return;
    setLoading(true);
    let cancelled = false;
    (async () => {
      const next: Record<string, Detail> = {};
      await Promise.all(items.map(async (slug) => {
        try {
          const res = await fetch(`/api/suggest-by-slug?slug=${encodeURIComponent(slug)}`);
          const body = await res.json();
          if (body?.data?.product) next[slug] = body.data.product;
        } catch { /* ignore */ }
      }));
      if (!cancelled) { setDetails(next); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [items]);

  const rows: [string, (d: Detail) => React.ReactNode][] = [
    ['Company', (d) => d.company ?? '—'],
    ['Generic', (d) => d.generic ?? '—'],
    ['Strength', (d) => d.strength ?? '—'],
    ['Regular — per sales unit', (d) => tk(d.regularSales)],
    ['Offer — per sales unit', (d) => d.offerSales != null && d.regularSales != null && d.offerSales < d.regularSales ? tk(d.offerSales) : '—'],
    ['Sales unit', (d) => d.salesUnit ?? '—'],
    ['Regular — per base unit', (d) => tk(d.regularBase)],
    ['Offer — per base unit', (d) => d.offerBase != null && d.regularBase != null && d.offerBase < d.regularBase ? tk(d.offerBase) : '—'],
    ['Base unit', (d) => d.baseUnit ?? '—'],
  ];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-[24px] font-medium">Compare</h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--fg-2)' }}>
            Up to 4 medicines side by side. Base-unit and sales-unit prices are never mixed.
          </p>
        </div>
        {items.length > 0 && <button className="btn" onClick={clear}>Clear all</button>}
      </header>

      {items.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-[15px] font-medium">Nothing to compare yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px]" style={{ color: 'var(--fg-2)' }}>
            Add medicines with the “Compare” button on any product card or page.
          </p>
          <Link href="/search" className="btn btn-primary mt-4">Browse medicines</Link>
        </div>
      ) : loading ? (
        <div className="card h-40 skeleton" aria-label="Loading comparison" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b hairline">
                <th className="p-3 text-left text-[11px] font-medium" style={{ color: 'var(--fg-3)' }}>Attribute</th>
                {items.map((slug) => (
                  <th key={slug} className="p-3 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/${slug}`} className="truncate font-medium">{details[slug]?.name ?? slug}</Link>
                      <button aria-label={`Remove ${slug} from compare`} onClick={() => toggle(slug)} style={{ color: 'var(--fg-3)' }}>
                        <X size={14} aria-hidden />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, render]) => (
                <tr key={label} className="border-b hairline last:border-0">
                  <td className="p-3 text-[12px]" style={{ color: 'var(--fg-3)' }}>{label}</td>
                  {items.map((slug) => (
                    <td key={slug} className="mono p-3">{details[slug] ? render(details[slug]) : <span style={{ color: 'var(--fg-3)' }}>…</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

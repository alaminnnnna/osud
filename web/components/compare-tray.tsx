/* Medora — floating compare tray (client, localStorage). Shows slugs; detail
   prices load from the backend suggest proxy per slug for a light payload. */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useCompare } from '@/lib/client-store';

interface Entry { slug: string; name: string; price: number | null; salesUnit: string | null }

export function CompareTray() {
  const { items, toggle, clear } = useCompare();
  const [entries, setEntries] = useState<Record<string, Entry>>({});

  useEffect(() => {
    let cancelled = false;
    const missing = items.filter((s) => !entries[s]);
    if (!missing.length) return;
    (async () => {
      const next: Record<string, Entry> = {};
      await Promise.all(missing.map(async (slug) => {
        try {
          const res = await fetch(`/api/suggest-by-slug?slug=${encodeURIComponent(slug)}`);
          const body = await res.json();
          if (body?.data?.product) next[slug] = body.data.product;
        } catch { /* ignore */ }
      }));
      if (!cancelled && Object.keys(next).length) setEntries((e) => ({ ...e, ...next }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  if (items.length === 0) return null;
  return (
    <aside aria-label="Compare tray"
      className="fixed inset-x-3 bottom-[76px] z-40 rounded-2xl border hairline p-3 md:bottom-4 md:left-auto md:right-4 md:w-[420px]"
      style={{ background: 'var(--surface)', boxShadow: 'var(--shadow)' }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-medium">Compare ({items.length}/4)</span>
        <div className="flex gap-2">
          <Link href="/compare" className="btn px-2 py-1 text-[11px]" style={{ minHeight: 26 }}
            aria-disabled={items.length < 2}
            onClick={(e) => { if (items.length < 2) e.preventDefault(); }}>Open compare</Link>
          <button className="btn px-2 py-1 text-[11px]" style={{ minHeight: 26 }} onClick={clear}>Clear</button>
        </div>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((slug) => (
          <li key={slug} className="badge mono gap-1.5 py-1">
            <Link href={`/${slug}`} className="max-w-[220px] truncate">{entries[slug]?.name ?? slug}</Link>
            {entries[slug]?.price != null && <span style={{ color: 'var(--accent)' }}>৳{entries[slug].price}</span>}
            <button aria-label={`Remove ${slug} from compare`} onClick={() => toggle(slug)} style={{ color: 'var(--fg-3)' }}>
              <X size={12} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

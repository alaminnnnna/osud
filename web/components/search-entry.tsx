/* Medora — search entry in the header: debounce 300ms, AbortController for
   stale requests, keyboard navigable suggestions (↑↓ Enter Esc). */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

interface Suggestion { slug: string; name: string; price: number | null; salesUnit: string | null }

export function SearchEntry({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
        const body = await res.json();
        setItems(body?.data?.products ?? []);
        setOpen(true);
        setActive(-1);
      } catch { /* aborted or network — stale results discarded */ }
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  function go(term: string) {
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(term)}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && items[active]) go(items[active].name);
      else if (q.trim()) go(q.trim());
    }
  }

  return (
    <div ref={boxRef} className="relative" role="combobox" aria-expanded={open} aria-controls="header-suggestions">
      <div className="flex items-center gap-2 rounded-[10px] border hairline px-3"
        style={{ background: 'var(--surface)', borderColor: 'var(--border-strong)' }}>
        <Search size={15} style={{ color: 'var(--fg-3)' }} aria-hidden />
        <input
          className="mono w-full bg-transparent py-2 text-[13px] outline-none"
          style={{ color: 'var(--fg)' }}
          placeholder={compact ? 'Search medicines…' : 'Search medicine, generic or company…'}
          aria-label="Search medicines"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => items.length && setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {loading && <span className="skeleton mono px-2 py-0.5 text-[10px]">···</span>}
      </div>
      {open && items.length > 0 && (
        <ul id="header-suggestions" role="listbox" aria-label="Search suggestions"
          className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl border hairline"
          style={{ background: 'var(--bg)', boxShadow: 'var(--shadow)' }}>
          {items.map((s, i) => (
            <li key={s.slug} role="option" aria-selected={i === active}>
              <button
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] hover:opacity-90"
                style={i === active ? { background: 'var(--accent-soft)' } : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(s.name)}>
                <span className="truncate" style={{ color: 'var(--fg)' }}>{s.name}</span>
                {s.price != null && (
                  <span className="mono shrink-0 text-[12px]" style={{ color: 'var(--accent)' }}>
                    ৳{s.price}/{s.salesUnit ?? ''}
                  </span>
                )}
              </button>
            </li>
          ))}
          <li className="border-t hairline px-3 py-1.5 text-[11px]" style={{ color: 'var(--fg-3)' }}>
            Enter to see all results
          </li>
        </ul>
      )}
    </div>
  );
}

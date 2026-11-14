/* Medora — filter rail: desktop sidebar + mobile bottom sheet (client). */
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SlidersHorizontal, X } from 'lucide-react';

export interface FilterOption { value: string; label: string; count?: number }

export function Filters({ forms, companies, showOffer }: { forms: FilterOption[]; companies: FilterOption[]; showOffer?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value == null || value === '') next.delete(key);
    else next.set(key, value);
    next.delete('page');
    router.push(`/search?${next.toString()}`);
  }

  const body = (
    <div className="flex flex-col gap-4">
      <Field label="Company">
        <select className="input mono" value={params.get('company') ?? ''} onChange={(e) => setParam('company', e.target.value)}>
          <option value="">All companies</option>
          {companies.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="Dosage form">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={!params.get('form')} onClick={() => setParam('form', null)}>All</Chip>
          {forms.map((f) => (
            <Chip key={f.value} active={params.get('form') === f.value} onClick={() => setParam('form', f.value)}>{f.label}</Chip>
          ))}
        </div>
      </Field>
      <Field label="Price (৳, sales unit)">
        <div className="flex items-center gap-2">
          <input className="input mono" type="number" min="0" placeholder="min" aria-label="Minimum price"
            defaultValue={params.get('min') ?? ''} onBlur={(e) => setParam('min', e.target.value)} />
          <span style={{ color: 'var(--fg-3)' }}>–</span>
          <input className="input mono" type="number" min="0" placeholder="max" aria-label="Maximum price"
            defaultValue={params.get('max') ?? ''} onBlur={(e) => setParam('max', e.target.value)} />
        </div>
      </Field>
      {showOffer !== false && (
        <label className="flex min-h-[28px] items-center gap-2 text-[13px]">
          <input type="checkbox" checked={params.get('offer') === '1'} onChange={(e) => setParam('offer', e.target.checked ? '1' : null)} />
          Only real offers
        </label>
      )}
      <button className="btn" onClick={() => router.push('/search')}>Reset filters</button>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="card hidden w-[260px] shrink-0 self-start p-4 md:block" aria-label="Filters">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-medium"><SlidersHorizontal size={15} aria-hidden /> Filters</div>
        {body}
      </aside>
      {/* Mobile trigger + sheet */}
      <button className="btn md:hidden" onClick={() => setOpen(true)} aria-expanded={open} aria-haspopup="dialog">
        <SlidersHorizontal size={15} aria-hidden /> Filters
      </button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t hairline p-4"
            style={{ background: 'var(--bg)', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[14px] font-medium">Filters</span>
              <button aria-label="Close filters" onClick={() => setOpen(false)} style={{ color: 'var(--fg-2)' }}><X size={18} aria-hidden /></button>
            </div>
            {body}
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px]" style={{ color: 'var(--fg-3)' }}>{label}</div>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="badge min-h-[28px] cursor-pointer"
      style={active ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}>
      {children}
    </button>
  );
}

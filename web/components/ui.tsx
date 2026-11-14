/* Medora — shared server components: verification stamp, freshness, cards,
   pagination, empty state. The dated verification stamp is the design signature. */
import Link from 'next/link';
import { BadgeCheck, CircleAlert, Clock3 } from 'lucide-react';
import { stampDate } from '@/lib/format';
import type { MedicineListItem } from '@/lib/api';
import { PriceBlock } from '@/components/price-block';
import { CompareButton, FavButton } from '@/components/item-actions';

export function VerificationStamp({ status, verifiedAt, source = 'Arogga' }: { status: string; verifiedAt: string | null; source?: string }) {
  const ok = status === 'VERIFIED';
  const warn = status === 'NEEDS_RECHECK';
  const color = ok ? 'var(--accent)' : warn ? 'var(--warning)' : 'var(--fg-3)';
  const Icon = ok ? BadgeCheck : warn ? CircleAlert : BadgeCheck;
  return (
    <span className="badge" style={{ color, borderColor: 'color-mix(in srgb, ' + color + ' 30%, transparent)' }}>
      <Icon size={12} aria-hidden />
      {ok ? 'Verified' : warn ? 'Needs re-check' : status}
      {' · '}
      {stampDate(verifiedAt)} · {source}
    </span>
  );
}

export function DataFreshness({ lastVerifiedAt, scrapedAt }: { lastVerifiedAt: string | null; scrapedAt: string | null }) {
  return (
    <span className="badge mono">
      <Clock3 size={12} aria-hidden />
      Data: {stampDate(lastVerifiedAt)}{scrapedAt ? ` · crawled ${stampDate(scrapedAt)}` : ''}
    </span>
  );
}

export function MedicineCard({ med, showCompare = true }: { med: MedicineListItem; showCompare?: boolean }) {
  return (
    <article className="card flex flex-col gap-2 p-4 transition-opacity hover:opacity-95">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/${med.slug}`} className="block truncate text-[15px] font-medium" style={{ color: 'var(--fg)' }}>
            {med.name}
          </Link>
          <div className="mt-0.5 truncate text-[12px]" style={{ color: 'var(--fg-3)' }}>
            {med.generic ?? 'Generic not listed'}{med.strength ? ` · ${med.strength}` : ''}
          </div>
        </div>
        <FavButton slug={med.slug} name={med.name} />
      </div>
      <PriceBlock price={med.price} compact />
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <div className="min-w-0 truncate text-[11px]" style={{ color: 'var(--fg-3)' }}>
          {med.company ?? '—'}
          {med.prescriptionRequired && <span className="badge ml-1" style={{ color: 'var(--info)' }}>Rx</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {showCompare && <CompareButton slug={med.slug} name={med.name} />}
          <Link href={`/${med.slug}`} className="btn px-2.5 py-1 text-[12px]" style={{ minHeight: 28 }}>View</Link>
        </div>
      </div>
    </article>
  );
}

export function Pagination({ page, totalPages, makeHref }: { page: number; totalPages: number; makeHref: (p: number) => string }) {
  if (totalPages <= 1) return null;
  const window = 2;
  const pages: number[] = [];
  for (let p = Math.max(1, page - window); p <= Math.min(totalPages, page + window); p++) pages.push(p);
  return (
    <nav className="mt-6 flex items-center justify-center gap-1.5" aria-label="Pagination">
      {page > 1 && <Link className="btn px-3" href={makeHref(page - 1)} rel="prev">← Prev</Link>}
      {pages[0] > 1 && <Link className="btn px-3" href={makeHref(1)}>1</Link>}
      {pages[0] > 2 && <span className="px-1" style={{ color: 'var(--fg-3)' }}>…</span>}
      {pages.map((p) => (
        <Link key={p} className="btn px-3" href={makeHref(p)}
          aria-current={p === page ? 'page' : undefined}
          style={p === page ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' } : undefined}>
          {p}
        </Link>
      ))}
      {pages[pages.length - 1] < totalPages - 1 && <span className="px-1" style={{ color: 'var(--fg-3)' }}>…</span>}
      {pages[pages.length - 1] < totalPages && <Link className="btn px-3" href={makeHref(totalPages)}>{totalPages}</Link>}
      {page < totalPages && <Link className="btn px-3" href={makeHref(page + 1)} rel="next">Next →</Link>}
    </nav>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="text-[16px] font-medium">{title}</div>
      {hint && <p className="max-w-md text-[13px]" style={{ color: 'var(--fg-2)' }}>{hint}</p>}
      {action}
    </div>
  );
}

/* Medora — favourite + compare item actions (client; localStorage-backed). */
'use client';

import { useCompare, useFavourites } from '@/lib/client-store';
import { Heart, GitCompareArrows } from 'lucide-react';

export function FavButton({ slug, name }: { slug: string; name: string }) {
  const { items, toggle } = useFavourites();
  const active = items.includes(slug);
  return (
    <button
      aria-label={active ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
      aria-pressed={active}
      onClick={() => toggle(slug)}
      className="rounded-lg p-1.5"
      style={{ color: active ? 'var(--accent)' : 'var(--fg-3)' }}>
      <Heart size={16} fill={active ? 'currentColor' : 'none'} aria-hidden />
    </button>
  );
}

export function CompareButton({ slug, name }: { slug: string; name: string }) {
  const { items, toggle } = useCompare();
  const active = items.includes(slug);
  return (
    <button
      aria-label={active ? `Remove ${name} from compare tray` : `Add ${name} to compare tray`}
      aria-pressed={active}
      onClick={() => toggle(slug)}
      className="btn px-2 py-1 text-[11px]"
      style={{ minHeight: 28, color: active ? 'var(--accent)' : undefined, borderColor: active ? 'var(--accent)' : undefined }}>
      <GitCompareArrows size={13} aria-hidden />
      {active ? 'Added' : 'Compare'}
    </button>
  );
}

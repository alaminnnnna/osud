/* Medora — mobile floating bottom navigation (DESIGN.md §3: blur backdrop,
   safe-area padding, animated active indicator). */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, Tags, LayoutGrid, Menu } from 'lucide-react';

const TABS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/offers', label: 'Offers', icon: Tags },
  { href: '/categories', label: 'Cats', icon: LayoutGrid },
  { href: '/compare', label: 'More', icon: Menu },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Mobile" className="fixed inset-x-0 bottom-0 z-40 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-3 mb-3 flex items-stretch justify-around rounded-2xl border hairline px-1 py-1.5"
        style={{ background: 'color-mix(in srgb, var(--bg) 82%, transparent)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined}
              className="relative flex min-h-[44px] min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5"
              style={active ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : { color: 'var(--fg-3)' }}>
              <Icon size={19} aria-hidden />
              <span className="text-[10px]">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

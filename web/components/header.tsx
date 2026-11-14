/* Medora — header (client: theme toggle, active nav, favourites count). */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Moon, Sun, Heart, BookOpenText } from 'lucide-react';
import { useFavourites } from '@/lib/client-store';
import { SearchEntry } from '@/components/search-entry';

const NAV = [
  { href: '/search', label: 'Medicines' },
  { href: '/companies', label: 'Companies' },
  { href: '/categories', label: 'Categories' },
  { href: '/offers', label: 'Offers' },
  { href: '/api-docs', label: 'API' },
];

export function Header() {
  const pathname = usePathname();
  const [dark, setDark] = useState(false);
  const { items: favs } = useFavourites();

  useEffect(() => {
    const stored = window.localStorage.getItem('medora.theme');
    const prefers = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = stored ? stored === 'dark' : prefers;
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    window.localStorage.setItem('medora.theme', next ? 'dark' : 'light');
  }

  return (
    <header className="sticky top-0 z-40 border-b hairline" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-medium" aria-label="Medora home">
          <BookOpenText size={20} style={{ color: 'var(--accent)' }} aria-hidden />
          <span className="text-[15px]">Medora</span>
          <span className="badge hidden sm:inline-flex">Bangladesh price index</span>
        </Link>
        <div className="mx-2 hidden flex-1 md:block"><SearchEntry compact /></div>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}
              className="rounded-lg px-3 py-1.5 text-[13px]"
              style={pathname === n.href ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : { color: 'var(--fg-2)' }}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <Link href="/compare" className="rounded-lg p-2 hover:opacity-80" style={{ color: 'var(--fg-2)' }} aria-label="Compare tray">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18M7 12h10M10 18h4" strokeLinecap="round"/></svg>
          </Link>
          <Link href="/search?favourites=1" className="relative rounded-lg p-2 hover:opacity-80" style={{ color: 'var(--fg-2)' }} aria-label={`Favourites (${favs.length})`}>
            <Heart size={18} aria-hidden />
            {favs.length > 0 && (
              <span className="mono absolute -right-0.5 -top-0.5 rounded-full px-1.5 text-[10px]" style={{ background: 'var(--accent)', color: '#fff' }}>{favs.length}</span>
            )}
          </Link>
          <button onClick={toggleTheme} className="rounded-lg p-2 hover:opacity-80" style={{ color: 'var(--fg-2)' }} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} aria-pressed={dark}>
            {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
          </button>
        </div>
      </div>
      <div className="border-t hairline px-4 py-2 md:hidden"><SearchEntry /></div>
    </header>
  );
}

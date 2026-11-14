/* Medora — root layout: metadata template, theme boot script, chrome. */
import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { Header } from '@/components/header';
import { MobileNav } from '@/components/mobile-nav';
import { CompareTray } from '@/components/compare-tray';
import { SITE_URL } from '@/lib/api';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Medora — Bangladesh Medicine Price Index',
    template: '%s · Medora',
  },
  description:
    'Compare real medicine prices in Bangladesh: per-strip and per-tablet prices, offers and price history, verified against the source catalogue.',
  openGraph: {
    siteName: 'Medora',
    type: 'website',
    locale: 'en_BD',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#0A0E0C' },
  ],
  width: 'device-width',
  initialScale: 1,
};

const THEME_BOOT = `(function(){try{var s=localStorage.getItem('medora.theme');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <Header />
        <main id="main" className="mx-auto min-h-[70vh] max-w-[1200px] px-4 pb-24 pt-6 sm:px-6 md:pb-16">
          {children}
        </main>
        <footer className="border-t hairline px-4 py-8 text-[12px] sm:px-6" style={{ color: 'var(--fg-3)' }}>
          <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-4 gap-y-2">
            <span>Medora — Bangladesh medicine price index. Data from the public Arogga catalogue; prices as listed by the source, never edited.</span>
            <span className="ml-auto flex gap-4">
              <Link href="/api-docs">API</Link>
              <Link href="/about-static.html" style={{ display: 'none' }}>x</Link>
              <Link href="/offers">Offers</Link>
              <a href="https://www.arogga.com" rel="noopener nofollow">Source</a>
            </span>
          </div>
        </footer>
        <CompareTray />
        <MobileNav />
      </body>
    </html>
  );
}

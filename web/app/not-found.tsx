/* Medora — 404 page. */
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-md p-8 text-center">
      <p className="mono text-[12px]" style={{ color: 'var(--fg-3)' }}>404</p>
      <h1 className="mt-1 text-[20px] font-medium">This page doesn’t exist</h1>
      <p className="mt-2 text-[13px]" style={{ color: 'var(--fg-2)' }}>
        The medicine, company or category you’re looking for isn’t in the catalogue. Prices change —
        renamed products redirect automatically from their old URLs.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Link href="/" className="btn btn-primary">Home</Link>
        <Link href="/search" className="btn">Search medicines</Link>
      </div>
    </div>
  );
}

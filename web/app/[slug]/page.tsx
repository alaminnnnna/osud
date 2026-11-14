/* Medora — medicine detail /[slug]: full record, verification stamp, price
   history, JSON-LD, related products. Dynamic metadata + canonicals. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { api, type MedicineDetail, SITE_URL, ApiError } from '@/lib/api';
import { num, stampDateTime, tk } from '@/lib/format';
import { PriceBlock } from '@/components/price-block';
import { VerificationStamp } from '@/components/ui';
import { FavButton, CompareButton } from '@/components/item-actions';

export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const { data: m } = await api<MedicineDetail>(`/medicines/${encodeURIComponent(slug)}`, { revalidate: 300 });
    const price = m.price.offerSales ?? m.price.regularSales;
    const title = `${m.name} price in Bangladesh${m.strength ? ` ${m.strength}` : ''}`;
    const desc = `${m.name}${m.generic ? ` (${m.generic})` : ''} by ${m.company ?? 'unknown company'}: ${price != null ? `৳${price} per ${m.price.salesUnit ?? 'unit'}` : 'price not listed'}${m.price.hasOffer ? ' · offer price listed' : ''}. Per-strip and per-tablet prices, verification status and price history.`;
    return {
      title,
      description: desc,
      alternates: { canonical: `/${m.slug}` },
      openGraph: {
        title: `${title} · Medora`,
        description: desc,
        url: `${SITE_URL}/${m.slug}`,
        images: m.image ? [{ url: m.image }] : undefined,
      },
    };
  } catch (e) {
    // Raise the 404 during metadata so the HTTP status is correct (the page
    // body streams after metadata and can no longer change the status code).
    if (e instanceof ApiError && e.status === 404) notFound();
    return { title: 'Medicine not found', robots: { index: false, follow: false } };
  }
}

export default async function MedicinePage({ params }: Props) {
  const { slug } = await params;
  let m: MedicineDetail;
  try {
    const res = await api<MedicineDetail>(`/medicines/${encodeURIComponent(slug)}`, { revalidate: 300 });
    m = res.data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  // Old-slug support: the API returns { redirect } for renamed medicines.
  if ((m as unknown as { redirect?: string }).redirect) {
    permanentRedirect(`/${(m as unknown as { redirect: string }).redirect}`);
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: m.name,
    sku: String(m.id),
    url: `${SITE_URL}/${m.slug}`,
    ...(m.image ? { image: [m.image] } : {}),
    ...(m.generic ? { description: `${m.name} (${m.generic}) — price as listed by the source catalogue.` } : {}),
    ...(m.company ? { brand: { '@type': 'Brand', name: m.company } } : {}),
  };
  const salePrice = m.price.offerSales ?? m.price.regularSales;
  if (salePrice != null) {
    jsonLd.offers = {
      '@type': 'Offer',
      priceCurrency: 'BDT',
      price: salePrice,
      url: `${SITE_URL}/${m.slug}`,
      ...(m.price.hasOffer ? { name: 'Offer price as listed by the source' } : {}),
    };
  }

  return (
    <div className="flex flex-col gap-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav aria-label="Breadcrumb" className="mono text-[12px]" style={{ color: 'var(--fg-3)' }}>
        <Link href="/search">Medicines</Link>
        {' / '}
        {m.companySlug ? <Link href={`/companies/${m.companySlug}`}>{m.company}</Link> : m.company ?? '—'}
        {' / '}
        <span style={{ color: 'var(--fg-2)' }}>{m.name}</span>
      </nav>

      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-medium leading-snug md:text-[28px]">{m.name}</h1>
            <div className="mt-1 text-[13px]" style={{ color: 'var(--fg-2)' }}>
              {m.generic ? <>Generic: <Link className="underline decoration-dotted" href={`/search?q=${encodeURIComponent(m.generic)}`}>{m.generic}</Link> · </> : null}
              {m.strength ? `${m.strength} · ` : ''}{m.form ?? ''}{m.prescriptionRequired ? ' · Rx required' : ''}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <FavButton slug={m.slug} name={m.name} />
            <CompareButton slug={m.slug} name={m.name} />
          </div>
        </div>
        <VerificationStamp status={m.verificationStatus} verifiedAt={m.lastVerifiedAt} />
      </header>

      <section className="card p-5" aria-label="Prices">
        <PriceBlock price={m.price} />
        <p className="mt-3 text-[11px]" style={{ color: 'var(--fg-3)' }}>
          Price updated {stampDateTime(m.lastVerifiedAt)}. Prices are exactly as listed by the source
          catalogue — per-strip and per-tablet values are stored separately and never converted.
          {m.price.hasOffer ? ' The offer price is shown because the source lists a genuine discount.' : ''}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="btn" href={m.sourceUrl} rel="noopener nofollow">View at source</a>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <section className="card overflow-hidden" aria-label="Price history">
          <div className="border-b hairline px-4 py-2.5 text-[13px] font-medium">Price history</div>
          {m.priceHistory.length === 0 ? (
            <p className="px-4 py-4 text-[13px]" style={{ color: 'var(--fg-2)' }}>
              No recorded changes yet — the first import is the baseline. History is appended whenever a
              future crawl or ingestion changes this medicine’s prices.
            </p>
          ) : (
            <table className="mono w-full text-[13px]">
              <thead>
                <tr className="border-b hairline text-left text-[11px]" style={{ color: 'var(--fg-3)' }}>
                  <th className="px-4 py-2 font-medium">Recorded</th>
                  <th className="px-4 py-2 font-medium">Regular (strip)</th>
                  <th className="px-4 py-2 font-medium">Offer (strip)</th>
                </tr>
              </thead>
              <tbody>
                {m.priceHistory.map((h) => (
                  <tr key={h.id} className="border-b hairline last:border-0">
                    <td className="px-4 py-2" style={{ color: 'var(--fg-2)' }}>{stampDateTime(h.recordedAt)}</td>
                    <td className="px-4 py-2">{tk(h.regularSales)}</td>
                    <td className="px-4 py-2">{tk(h.offerSales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          {m.images.length > 0 && (
            <div className="card overflow-hidden">
              {/* Source images are hotlinked, never downloaded or re-hosted */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.images[0].url} alt={m.images[0].title ?? `${m.name} product image`} className="aspect-square w-full object-contain p-3" loading="lazy" />
            </div>
          )}
          <div className="card p-4 text-[12px]" style={{ color: 'var(--fg-2)' }}>
            <div className="mb-2 text-[13px] font-medium" style={{ color: 'var(--fg)' }}>Data quality</div>
            <ul className="flex flex-col gap-1">
              <li>Status: <span className="mono">{m.verificationStatus}</span></li>
              <li>Company: {m.company ? <Link className="underline decoration-dotted" href={`/companies/${m.companySlug}`}>{m.company}</Link> : 'not listed'}</li>
              <li className="mono" style={{ color: 'var(--fg-3)' }}>Source ID {num(m.id)}</li>
            </ul>
          </div>
        </aside>
      </div>

      {m.related.length > 0 && (
        <section aria-label="Related products with the same generic">
          <h2 className="mb-3 text-[20px] font-medium">Same generic — {m.generic}</h2>
          <ul className="card divide-y" style={{ borderColor: 'var(--border)' }}>
            {m.related.map((r) => (
              <li key={r.slug}>
                <Link href={`/${r.slug}`} className="mono flex items-baseline justify-between px-4 py-2.5 text-[13px] hover:opacity-80">
                  <span className="truncate">{r.name}</span>
                  <span style={{ color: 'var(--accent)' }}>{r.price != null ? tk(r.price) : '—'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

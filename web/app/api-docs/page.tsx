/* Medora — /api-docs: documents the live platform API. */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API documentation',
  description: 'The Medora REST API: medicines, search, offers, companies, categories, price history, health and stats — backed by PostgreSQL.',
  alternates: { canonical: '/api-docs' },
};

const ENDPOINTS: [string, string, string][] = [
  ['GET', '/api/v1/medicines', 'Paginated catalogue. Filters: company, category, form, type, rx, offer, min, max. Sorts: name, price-asc, price-desc, discount, recent.'],
  ['GET', '/api/v1/medicines/:slug', 'Full record: prices (base + sales units), images, price history, related generics. Numeric source IDs also resolve.'],
  ['GET', '/api/v1/medicines/:slug/price-history', 'Append-only price history with changed fields and recording timestamps.'],
  ['GET', '/api/v1/search?q=', 'Server-side search: exact > brand > prefix > partial > fuzzy (trigram) > company relevance. Same filters as /medicines.'],
  ['GET', '/api/v1/search/suggestions?q=', 'Lightweight suggestions for search-as-you-type.'],
  ['GET', '/api/v1/offers', 'Only items whose listed offer is genuinely below the regular price.'],
  ['GET', '/api/v1/companies', 'Company directory with live product counts; :slug returns detail + medicines.'],
  ['GET', '/api/v1/categories', 'Category directory; :slug returns detail + medicines.'],
  ['GET', '/api/v1/health', 'Database connectivity probe (503 when degraded).'],
  ['GET', '/api/v1/stats', 'Dataset statistics, verification counts, last crawl run.'],
  ['GET', '/sitemap.xml', 'Dynamic sitemap index, partitioned at 20,000 URLs per file.'],
  ['POST', '/api/v1/ingest/*', 'Authenticated ingestion (Bearer token): run summaries + validated record batches with idempotent upserts.'],
];

export default function ApiDocsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[24px] font-medium">API documentation</h1>
        <p className="mt-1 max-w-[70ch] text-[13px]" style={{ color: 'var(--fg-2)' }}>
          Every page on this site is rendered from the live REST API, which queries PostgreSQL
          directly — the catalogue is never bundled into the browser. Responses share one envelope:
        </p>
      </header>

      <pre className="card mono overflow-x-auto p-4 text-[12px]" aria-label="Response envelope example">{`{
  "success": true,
  "data": [ … ],
  "pagination": { "page": 1, "limit": 20, "total": 58297, "totalPages": 2915 }
}`}</pre>

      <section aria-label="Endpoints" className="card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b hairline text-left text-[11px]" style={{ color: 'var(--fg-3)' }}>
              <th className="p-3 font-medium">Method</th>
              <th className="p-3 font-medium">Path</th>
              <th className="p-3 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map(([method, path, desc]) => (
              <tr key={path} className="border-b hairline last:border-0">
                <td className="mono p-3" style={{ color: method === 'GET' ? 'var(--accent)' : 'var(--warning)' }}>{method}</td>
                <td className="mono p-3">{path}</td>
                <td className="p-3" style={{ color: 'var(--fg-2)' }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-4 text-[13px]" style={{ color: 'var(--fg-2)' }}>
        <h2 className="mb-2 text-[15px] font-medium" style={{ color: 'var(--fg)' }}>Data integrity rules</h2>
        <ul className="flex flex-col gap-1.5">
          <li>• Base-unit and sales-unit prices are stored and served separately — a tablet price is never presented as a strip price.</li>
          <li>• Offer prices appear only when the source lists a genuine discount; discounts are never recomputed or invented.</li>
          <li>• Uncertain duplicate products are flagged (<span className="mono">NEEDS_RECHECK</span>) and never auto-merged.</li>
          <li>• Price history is append-only with source provenance and recording timestamps.</li>
          <li>• Rate limiting: 120 requests/minute per IP; responses carry <span className="mono">Cache-Control</span> and <span className="mono">X-RateLimit-*</span> headers.</li>
        </ul>
      </section>
    </div>
  );
}

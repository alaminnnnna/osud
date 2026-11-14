/* Medora — server-side API access to the platform backend. */

export const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:4000').replace(/\/$/, '');
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export interface Envelope<T> {
  success: boolean;
  data: T;
  pagination?: { page: number; limit: number; total: number; totalPages: number };
  error?: { code: string; message: string };
}

export interface PriceInfo {
  regularBase: number | null;
  offerBase: number | null;
  regularSales: number | null;
  offerSales: number | null;
  hasOffer: boolean;
  discountPercent: number | null;
  baseUnit: string | null;
  salesUnit: string | null;
  salesUnitMultiplier: number | null;
}

export interface MedicineListItem {
  id: number;
  slug: string;
  name: string;
  nameBn?: string | null;
  generic: string | null;
  company: string | null;
  companySlug: string | null;
  strength: string | null;
  form: string | null;
  productType: string | null;
  prescriptionRequired: boolean;
  verificationStatus: string;
  price: PriceInfo;
  image: string | null;
  sourceUrl: string;
  lastVerifiedAt: string | null;
}

export interface MedicineDetail extends MedicineListItem {
  missingFields?: string[];
  minQty?: number | null;
  maxQty?: number | null;
  priceHistory: {
    id: number;
    regularBase: string | null;
    offerBase: string | null;
    regularSales: string | null;
    offerSales: string | null;
    changedFields: string[];
    recordedAt: string;
  }[];
  images: { url: string; title: string | null; isPrimary: boolean; available: boolean }[];
  related: { slug: string; name: string; genericName: string | null; price: number | null }[];
}

export interface CompanyItem { id: number; slug: string; name: string; productCount: number }
export interface CategoryItem { id: number; slug: string; name: string; type: string | null; productCount: number }
export interface OfferItem extends MedicineListItem { discountPercent: number | null }

export interface StatsData {
  medicines: number;
  verified: number;
  offers: number;
  companies: number;
  categories: number;
  priceHistoryEntries: number;
  missingImages: number;
  needsRecheck: number;
  lastVerifiedAt: string | null;
  lastScrapeRun: { run_id: string; mode: string; status: string; started_at: string; finished_at: string | null; productsCollected: number | null; coveragePct: number | null; fullCoverage: boolean | null } | null;
}

export interface AdminMetrics {
  stats: StatsData;
  imports: { id: number; mode: string; status: string; startedAt: string; finishedAt: string | null; totals: Record<string, number> | null }[];
  recentPriceChanges: { medicineId: number; name: string; slug: string; regularSales: string | null; offerSales: string | null; changedFields: string[]; recordedAt: string }[];
  validationBreakdown: { status: string; ct: number }[];
  database: { poolTotal: number; poolIdle: number; poolWaiting: number };
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, opts: { revalidate?: number; noStore?: boolean } = {}): Promise<Envelope<T>> {
  const res = await fetch(`${BACKEND_URL}/api/v1${path}`, {
    next: opts.noStore ? { revalidate: 0 } : { revalidate: opts.revalidate ?? 60 },
    headers: { Accept: 'application/json' },
  });
  let body: Envelope<T> | null = null;
  try { body = await res.json(); } catch { throw new ApiError(res.status, 'bad_gateway', 'Backend returned a non-JSON response.'); }
  if (!res.ok || !body?.success) {
    throw new ApiError(res.status, body?.error?.code ?? 'backend_error', body?.error?.message ?? `Backend request failed (${res.status})`);
  }
  return body;
}

/** For admin pages: server-side fetch with server-held Basic credentials. */
export async function adminApi<T>(path: string): Promise<Envelope<T> | null> {
  const user = process.env.ADMIN_USERNAME ?? '';
  const pass = process.env.ADMIN_PASSWORD ?? '';
  if (!user || !pass) return null;
  const res = await fetch(`${BACKEND_URL}/api/v1${path}`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json() as Promise<Envelope<T>>;
}

/* Medora — unified data access (Phase 4).
   The Next.js app IS the backend now: server components resolve API paths
   directly against the shared service layer (lib/server/*) — same functions
   the /api/v1 route handlers use, no HTTP hop, no second origin. Response
   envelopes are identical to the REST API. */
import 'server-only';
import { localApi } from './server/dispatch';
export { ApiError } from './server/http';

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

/**
 * Resolve an API path (same paths as /api/v1) against the local service
 * layer. `revalidate`/`noStore` options are accepted for call-site
 * compatibility; server components now read live database state directly.
 */
export async function api<T>(path: string, opts: { revalidate?: number; noStore?: boolean } = {}): Promise<Envelope<T>> {
  void opts;
  const [rawPath, query = ''] = path.split('?');
  const sp = new URLSearchParams(query);
  const res = await localApi(rawPath, sp) as Envelope<T>;
  return res;
}

/** For admin pages: metrics resolved locally with server-held env credentials. */
export async function adminApi<T>(path: string): Promise<Envelope<T> | null> {
  const user = process.env.ADMIN_USERNAME ?? '';
  const pass = process.env.ADMIN_PASSWORD ?? '';
  if (!user || !pass) return null;
  const [rawPath, query = ''] = path.split('?');
  try {
    return await localApi(rawPath, new URLSearchParams(query)) as Envelope<T>;
  } catch {
    return null;
  }
}

/* Medora — API plumbing for the unified Next.js route handlers (server-only).
   Mirrors the superseded Express middleware exactly: response envelope,
   fixed-window rate limiting per IP, CORS allow-list, cache headers and safe
   errors (no stack traces, no credentials). */
import { NextRequest, NextResponse } from 'next/server';
import { config } from './config';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function ok<T>(data: T, pagination?: unknown): NextResponse {
  return NextResponse.json(okBody(data, pagination));
}

/** Pure envelope body for local (no-HTTP) dispatch — same shape as ok(). */
export function okBody<T>(data: T, pagination?: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = { success: true, data };
  if (pagination) body.pagination = pagination;
  return body;
}

export function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

/* ---------- query-param helpers (same rules as the Express API) ---------- */
export function pageParams(sp: URLSearchParams): { page: number; limit: number } {
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 20));
  return { page, limit };
}
export function boolParam(v: string | null): boolean {
  return v === '1' || v === 'true';
}
export function numParam(v: string | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function strParam(sp: URLSearchParams, key: string): string | undefined {
  const v = sp.get(key);
  return typeof v === 'string' ? v : undefined;
}
export function strOrNull(sp: URLSearchParams, key: string): string | null {
  const v = sp.get(key);
  return typeof v === 'string' && v !== '' ? v : null;
}

/* ---------- rate limiting (fixed window per IP; Redis for multi-instance) ---------- */
const hits = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
}

function rateLimit(req: NextRequest): NextResponse | null {
  const limitPerMin = config.RATE_LIMIT_PER_MINUTE;
  if (!limitPerMin) return null;
  const ip = clientIp(req);
  const now = Date.now();
  let entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + 60_000 };
    hits.set(ip, entry);
  }
  entry.count++;
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limitPerMin),
    'X-RateLimit-Remaining': String(Math.max(0, limitPerMin - entry.count)),
  };
  if (entry.count > limitPerMin) {
    headers['Retry-After'] = '60';
    return NextResponse.json(
      { success: false, error: { code: 'rate_limited', message: 'Too many requests — try again in a minute.' } },
      { status: 429, headers },
    );
  }
  // Stash the headers for the real response via a marker the wrapper reads.
  (req as unknown as { __rateHeaders?: Record<string, string> }).__rateHeaders = headers;
  return null;
}

/* ---------- CORS ---------- */
function applyCors(req: NextRequest, res: NextResponse): void {
  const origin = req.headers.get('origin');
  if (config.corsOrigins === '*') {
    res.headers.set('Access-Control-Allow-Origin', '*');
  } else if (origin && (config.corsOrigins as string[]).includes(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
  }
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/* ---------- cache headers ---------- */
function applyCache(path: string, res: NextResponse): void {
  if (res.headers.get('cache-control')) return; // handler already set a policy (e.g. /health)
  if (path.includes('/admin') || path.includes('/ingest')) {
    res.headers.set('Cache-Control', 'no-store');
  } else {
    res.headers.set('Cache-Control', `public, max-age=${config.CACHE_LIST_SECONDS}, stale-while-revalidate=300`);
  }
}

const NO_LIMIT = /\/admin(\/|$)|\/ingest(\/|$)/;

/** Wrap a route handler with rate limiting + CORS + cache + safe errors. */
export async function withApi(req: NextRequest, fn: () => Promise<NextResponse>): Promise<NextResponse> {
  const path = req.nextUrl.pathname;
  let res: NextResponse;
  try {
    if (NO_LIMIT.test(path)) {
      res = await fn();
    } else {
      const limited = rateLimit(req);
      res = limited ?? await fn();
      const rh = (req as unknown as { __rateHeaders?: Record<string, string> }).__rateHeaders;
      if (rh) for (const [k, v] of Object.entries(rh)) res.headers.set(k, v);
    }
  } catch (e) {
    console.error('API error:', e instanceof Error ? e.message : e);
    if (e instanceof ApiError) res = fail(e.status, e.code, e.message);
    else res = fail(500, 'internal_error', 'An unexpected error occurred.');
  }
  applyCors(req, res);
  applyCache(path, res);
  return res;
}

/** OPTIONS preflight (Express answered 204 the same way). */
export function preflight(req: NextRequest): NextResponse {
  const res = new NextResponse(null, { status: 204 });
  applyCors(req, res);
  return res;
}

/* ---------- auth guards ---------- */
export function requireIngestToken(req: NextRequest): NextResponse | null {
  if (!config.ingestEnabled) return fail(503, 'ingest_disabled', 'Ingestion is disabled (set INGEST_TOKEN).');
  const header = req.headers.get('authorization') ?? '';
  if (header !== `Bearer ${config.INGEST_TOKEN}`) return fail(401, 'unauthorized', 'Valid bearer token required.');
  return null;
}

export function requireAdmin(req: NextRequest): NextResponse | null {
  if (!config.adminEnabled) return fail(503, 'admin_disabled', 'Admin is disabled (set ADMIN_USERNAME/ADMIN_PASSWORD).');
  const header = req.headers.get('authorization') ?? '';
  const expected = 'Basic ' + Buffer.from(`${config.ADMIN_USERNAME}:${config.ADMIN_PASSWORD}`).toString('base64');
  if (header !== expected) {
    const res = fail(401, 'unauthorized', 'Admin authentication required.');
    res.headers.set('WWW-Authenticate', 'Basic realm="Medora admin", charset="UTF-8"');
    return res;
  }
  return null;
}

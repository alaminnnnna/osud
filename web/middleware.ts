/* Medora — middleware: admin Basic auth + pre-render 404 gate.
   Next 15 streams metadata by default, so notFound() inside metadata can no
   longer set the HTTP status on dynamic routes. For root-level medicine slugs
   we validate against the backend BEFORE rendering and return a real 404 /
   308 redirect from middleware. */
import { NextRequest, NextResponse } from 'next/server';

const RESERVED = new Set([
  'search', 'companies', 'categories', 'offers', 'compare', 'api-docs', 'admin',
  'api', '_next', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'assets', 'm',
  'about-static.html', 'index.html', '404.html', '500.html', 'manifest.json',
]);

const NOT_FOUND_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found · Medora</title>
<style>body{margin:0;background:#fff;color:#17211C;font:14px/1.55 -apple-system,'Segoe UI',Roboto,'Noto Sans Bengali',sans-serif}
.dark body{background:#0A0E0C;color:#E7EFEA}
main{max-width:420px;margin:96px auto;padding:0 24px}
.card{background:#F6F8F7;border:1px solid #E3EAE5;border-radius:14px;padding:32px;text-align:center}
.dark .card{background:#101613;border-color:#243029}
.k{font:12px ui-monospace,monospace;color:#75827A}a.btn{display:inline-flex;align-items:center;padding:8px 14px;border-radius:9px;background:#0E8C5A;color:#fff;text-decoration:none;font-weight:500;margin:12px 6px 0}</style></head>
<body><main><div class="card"><div class="k">404</div><h1 style="font-size:20px;font-weight:500;margin:6px 0">This page doesn't exist</h1>
<p style="color:#4C5A52;font-size:13px;margin:8px 0 4px">The medicine you're looking for isn't in the catalogue.</p>
<a class="btn" href="/">Home</a><a class="btn" style="background:transparent;color:inherit;border:1px solid #CFD9D2" href="/search">Search medicines</a>
</div></main></body></html>`;

export async function middleware(req: NextRequest) {
  // --- admin auth ---
  if (req.nextUrl.pathname === '/admin') {
    const user = process.env.ADMIN_USERNAME;
    const pass = process.env.ADMIN_PASSWORD;
    const expected = user && pass
      ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
      : null;
    if (!expected) return new NextResponse('Admin disabled: set ADMIN_USERNAME/ADMIN_PASSWORD.', { status: 503 });
    if (req.headers.get('authorization') !== expected) {
      return new NextResponse('Authentication required.', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Medora admin", charset="UTF-8"' },
      });
    }
    return NextResponse.next();
  }

  // --- entity detail routes: pre-render 404 gate + old-slug redirect ---
  const path = req.nextUrl.pathname;
  if (req.method !== 'GET' || path.includes('.') || path === '/') return NextResponse.next();
  const backend = (process.env.BACKEND_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  const segs = path.slice(1).replace(/\/$/, '').split('/');
  const gate404 = () => new NextResponse(NOT_FOUND_HTML, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' },
  });

  const check = async (upstreamPath: string): Promise<NextResponse | null> => {
    try {
      const upstream = await fetch(`${backend}/api/v1${upstreamPath}`, {
        cache: 'no-store', headers: { Accept: 'application/json' },
      });
      if (upstream.status === 404) return gate404();
      const body = await upstream.json().catch(() => null);
      const redirectSlug = body?.data?.redirect;
      if (redirectSlug && typeof redirectSlug === 'string') {
        return NextResponse.redirect(new URL(`/${redirectSlug}`, req.nextUrl.origin), 308);
      }
      return null;
    } catch {
      return null; // backend unreachable → let the app render its error state
    }
  };

  if (segs.length === 1 && !RESERVED.has(segs[0] ?? '')) {
    const gate = await check(`/medicines/${encodeURIComponent(segs[0] ?? '')}`);
    if (gate) return gate;
  }
  if (segs.length === 2 && segs[0] === 'companies' && segs[1]) {
    const gate = await check(`/companies/${encodeURIComponent(segs[1])}`);
    if (gate) return gate;
  }
  if (segs.length === 2 && segs[0] === 'categories' && segs[1]) {
    const gate = await check(`/categories/${encodeURIComponent(segs[1])}`);
    if (gate) return gate;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};

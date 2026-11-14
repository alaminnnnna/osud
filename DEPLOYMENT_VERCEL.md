# Deploying the Medora frontend to Vercel

The Next.js app lives in `web/` (App Router, TypeScript, Tailwind 4). The static
site in the same folder is **not** served by the Next app and can stay as-is.

## 1. Import the project
1. Push the repository to GitHub/GitLab.
2. Vercel → New Project → import the repo.
3. Root Directory: `web`.

## 2. Build settings (auto-detected)
- Framework: Next.js
- Build: `npm run build` · Install: `npm install` · Output: handled by Vercel
- Node: 20+ (project engines)

## 3. Environment variables (Project → Settings → Environment Variables)
| Key | Example | Notes |
| --- | --- | --- |
| `BACKEND_URL` | `https://medora-api.onrender.com` | Render backend base URL, **no** `/api/v1` suffix |
| `NEXT_PUBLIC_SITE_URL` | `https://medora.vercel.app` | Canonical URLs, metadata, sitemap |
| `ADMIN_USERNAME` | (secret) | enables `/admin` (middleware Basic auth) |
| `ADMIN_PASSWORD` | (secret) | must match the backend's admin creds |

Never add `DATABASE_URL` to the frontend — it has no direct database access;
all data flows through the backend API (`BACKEND_URL`).

## 4. Deploy
Deploy → verify:
- `/` renders the live price board (backend reachable)
- `/napa-500-tablet` shows prices + verification stamp
- `/robots.txt` lists both sitemaps; `/sitemap.xml` returns frontend routes
- unknown slugs return **HTTP 404** (middleware gate), e.g. `/definitely-not-a-real-page`

## 5. Notes
- All data routes are dynamic (`force-dynamic`) — data freshness is guaranteed at
  request time; Vercel edge caching of API responses is controlled by the backend's
  `Cache-Control` headers passed through Next's fetch cache.
- The `/api/suggest` route proxies suggestions to the backend so the browser never
  talks to the backend origin directly (keeps the backend private if you enable
  Vercel→Render private networking or IP allow-listing).
- Secrets are never committed: keep only `.env.example` files in git.

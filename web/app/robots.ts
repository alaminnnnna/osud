/* Medora — robots.txt (unified app).
   The Next app now serves both the frontend sitemap (app/sitemap.ts) and the
   prerendered static-site sitemaps that ship inside web/ — same origin. */
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/api';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/'] }],
    sitemap: [`${SITE_URL}/sitemap.xml`],
  };
}

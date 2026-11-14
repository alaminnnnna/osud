/* Medora — robots.txt: dynamic frontend sitemap + partitioned backend sitemaps. */
import type { MetadataRoute } from 'next';
import { SITE_URL, BACKEND_URL } from '@/lib/api';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/'] }],
    sitemap: [`${BACKEND_URL}/sitemap.xml`, `${SITE_URL}/sitemap.xml`],
  };
}

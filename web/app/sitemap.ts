/* Medora — frontend sitemap: static routes + company/category partitions.
   Medicine URLs (58k+) are served by the backend's partitioned sitemap index
   (referenced from robots.txt) — generated fresh from the database. */
import type { MetadataRoute } from 'next';
import { api, type CompanyItem, type CategoryItem, SITE_URL } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    '', '/search', '/companies', '/categories', '/offers', '/api-docs',
  ].map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified: new Date(),
    changeFrequency: p === '' ? 'daily' : 'weekly',
    priority: p === '' ? 1 : 0.7,
  }));

  try {
    const [companies, categories] = await Promise.all([
      api<CompanyItem[]>('/companies?limit=100', { revalidate: 3600 }),
      api<CategoryItem[]>('/categories?limit=100', { revalidate: 3600 }),
    ]);
    return [
      ...staticRoutes,
      ...companies.data.map((c) => ({ url: `${SITE_URL}/companies/${c.slug}`, changeFrequency: 'weekly' as const, priority: 0.5 })),
      ...categories.data.map((c) => ({ url: `${SITE_URL}/categories/${c.slug}`, changeFrequency: 'weekly' as const, priority: 0.5 })),
    ];
  } catch {
    return staticRoutes;
  }
}

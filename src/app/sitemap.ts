import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/config';

/**
 * Sitemap for the static, always-present surfaces. Record/profile pages are
 * unbounded (any repo in the network) so they're intentionally left to
 * organic discovery via the OG-tagged universal links themselves.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl().replace(/\/$/, '');

  const routes = [
    { path: '/', priority: 1 },
    { path: '/links', priority: 0.9 },
    { path: '/extension', priority: 0.9 },
    { path: '/explore', priority: 0.8 },
    { path: '/welcome', priority: 0.7 },
    { path: '/explore/lexicons', priority: 0.6 },
    { path: '/docs', priority: 0.6 },
    { path: '/fork', priority: 0.4 },
    { path: '/extension/privacy', priority: 0.3 },
    { path: '/terms', priority: 0.3 },
  ];

  return routes.map(({ path, priority }) => ({
    url: `${base}${path}`,
    changeFrequency: 'weekly' as const,
    priority,
  }));
}

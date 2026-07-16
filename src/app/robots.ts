import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl().replace(/\/$/, '');

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // API routes (OG generation is expensive to crawl), the OAuth
        // callback, and the signed-in account page have no crawl value.
        disallow: ['/api/', '/oauth/', '/account'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}

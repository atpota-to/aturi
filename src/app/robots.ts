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
        //
        // `/at/` and `/at:` are the pasted-AT-URI entry points. Both are
        // client-side stubs that render "Redirecting..." and then bounce to
        // `/explore/...`, so there is nothing on them to crawl — but crawlers
        // execute JavaScript, so left alone they follow the bounce and pull an
        // unbounded slice of the network in behind them. Blocking the stubs
        // themselves costs nothing: the destinations stay reachable by their
        // own URLs. Kept as two specific prefixes rather than a bare `/at` so
        // this can't accidentally match a future `/atproto`-style route.
        disallow: ['/api/', '/oauth/', '/account', '/at/', '/at:'],
      },
      {
        // Bytespider (ByteDance) crawls aggressively for AI training and is a
        // top-five source of traffic here while returning nothing. It has a
        // reputation for ignoring robots.txt, so treat this as the polite ask
        // and pair it with a Vercel Firewall rule for enforcement.
        userAgent: 'Bytespider',
        disallow: '/',
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}

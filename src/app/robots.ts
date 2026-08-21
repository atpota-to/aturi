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
        // The two `/explore/*/space` entries are the permissioned-data tree.
        // Belt and braces alongside the per-page `robots: { index: false,
        // follow: false }`: every one of those pages renders nothing without a
        // credential, but the address itself — which space, which type, which
        // member DIDs — is private information worth not handing to a crawler
        // at all.
        //
        // It takes two patterns because robots matching is prefix-based. The
        // trailing-slash form covers the subtree; the `$`-anchored form covers
        // the listing page `/explore/<id>/space` itself, which is where the
        // tree starts and which every space breadcrumb links back to. A bare
        // `/explore/*/space` prefix would cover both, but it would also match a
        // public collection whose NSID begins with those letters (say
        // `/explore/<id>/space.example.thing`), so the anchor is the narrower
        // spelling. Crawlers that don't implement `$` ignore that line and
        // still get the subtree.
        //
        // `/at/` and `/at:` are the pasted-AT-URI entry points. Both are
        // client-side stubs that render "Redirecting..." and then bounce to
        // `/explore/...`, so there is nothing on them to crawl — but crawlers
        // execute JavaScript, so left alone they follow the bounce and pull an
        // unbounded slice of the network in behind them. Blocking the stubs
        // themselves costs nothing: the destinations stay reachable by their
        // own URLs. Kept as two specific prefixes rather than a bare `/at` so
        // this can't accidentally match a future `/atproto`-style route.
        disallow: [
          '/api/',
          '/oauth/',
          '/account',
          '/explore/*/space$',
          '/explore/*/space/',
          '/at/',
          '/at:',
        ],
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

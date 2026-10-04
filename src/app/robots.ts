import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl().replace(/\/$/, '');

  return {
    rules: [
      {
        userAgent: '*',
        // The five public read endpoints are named explicitly so they survive
        // the blanket `/api/` disallow below. They're the machine-readable half
        // of the site — the thing an agent is *supposed* to call — and hiding
        // them behind robots.txt is why crawler audits conclude aturi.to has no
        // public API at all. Longest-match wins in every robots parser that
        // implements Allow, so each of these beats the `/api/` prefix; parsers
        // that don't implement Allow were already ignoring the whole group.
        //
        // /openapi.json and /llms.txt sit at the root, so the bare `/` already
        // covers them.
        allow: [
          '/',
          '/api/resolve',
          '/api/waypoints',
          '/api/at-tags',
          '/api/did-doc',
          '/api/oembed',
        ],
        // The rest of /api (OG generation is expensive to crawl), the OAuth
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
          // Vercel's Web Analytics beacon. A crawler that renders JavaScript
          // runs the analytics script like any other client and posts a
          // pageview per render, which put /_vercel/insights/view among the
          // most-requested paths on the site — 1.2M in a 10.4M sample, none of
          // it a reader.
          //
          // Disallowing it works because Googlebot applies robots.txt to every
          // URL it fetches while rendering a page, not only to links it decides
          // to follow. /account is the proof: it is prefetched on every page
          // load (SessionPanel renders it in the signed-out branch) and appears
          // nowhere in the traffic data, alone among the prefetched links.
          //
          // Real visitors are unaffected — browsers don't read robots.txt — so
          // analytics keeps working for the traffic it is meant to measure, and
          // is rid of pageviews from clients that were never reading.
          //
          // Safe as a whole-prefix block: /_vercel/insights/script.js is the
          // only thing under here the pages actually request, and nothing on
          // the critical rendering path lives here. Next's image optimizer is
          // /_next/image, which this does not match.
          '/_vercel/',
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

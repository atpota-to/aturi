import { NextRequest, NextResponse } from 'next/server';
import { fetchPageHtml } from '@/utils/fetchPageHtml';
import { isBlockedFetchHost } from '@/utils/ssrfGuard';
import { iconCandidates, isFaviconDomain, sniffIconType } from '@/utils/favicon';

export const runtime = 'edge';

/**
 * The icon of the site a lexicon namespace reverses to, for the collections
 * tree: `GET /api/favicon?domain=bsky.app` answers with the image itself, so
 * it drops straight into an `<img src>`. A 404 means no usable icon was found
 * and the caller draws its own fallback.
 *
 * Reads the site's home page for `<link rel="icon">` (and apple-touch-icon)
 * declarations, tries the best few, then `/favicon.ico`. See
 * `src/utils/favicon.ts` for why the page has to be read and how candidates
 * are ranked.
 *
 * Safety:
 *  - `domain` must be one `appDomainFor` could have produced (two labels, or
 *    three under a per-project host), and pass the SSRF guard. Every redirect
 *    hop of every fetch is re-guarded.
 *  - The page read is bounded by `fetchPageHtml`; each icon read by a byte cap
 *    and the request's overall deadline.
 *  - The body is served only if its bytes are a PNG, ICO, GIF, JPEG, WebP or
 *    SVG, under the sniffed type rather than the upstream one. An SVG served
 *    from this origin could carry script if opened directly, so every response
 *    carries a sandboxing CSP and `nosniff`; inside an `<img>` none of it runs.
 *
 * Cost: one edge invocation per domain per CDN cache lifetime. Hits are cached
 * for a week at the CDN and a day in the browser; misses for a day, so a site
 * that adds an icon shows up without anyone purging anything. `/api/` is
 * disallowed in robots.txt, so crawlers don't spend these.
 */

/** Overall budget for the icon reads after the page read. */
const ICON_BUDGET_MS = 6000;
const ICON_FETCH_TIMEOUT_MS = 3000;
const ICON_MAX_BYTES = 256 * 1024;
/** Candidates tried before giving up. The fallback `/favicon.ico` is always
 * one of them. */
const MAX_ATTEMPTS = 3;
const PAGE_MAX_BYTES = 256 * 1024;
const PAGE_TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const SAFETY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'X-Robots-Tag': 'noindex',
};

export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get('domain') ?? '';
  if (!isFaviconDomain(domain)) {
    return new NextResponse(null, {
      status: 400,
      headers: { ...SAFETY_HEADERS, 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
    });
  }

  const base = `https://${domain}/`;
  const html = await fetchPageHtml(base, { maxBytes: PAGE_MAX_BYTES, timeoutMs: PAGE_TIMEOUT_MS });
  const candidates = iconCandidates(html, base);
  // The conventional path always gets its turn, however many links outrank it.
  const fallback = candidates[candidates.length - 1];
  const attempts = [...candidates.slice(0, MAX_ATTEMPTS - 1), fallback].filter(
    (href, i, all) => all.indexOf(href) === i,
  );

  const deadline = Date.now() + ICON_BUDGET_MS;
  for (const href of attempts) {
    const remaining = deadline - Date.now();
    if (remaining < 250) break;
    const icon = await fetchIcon(href, Math.min(ICON_FETCH_TIMEOUT_MS, remaining));
    if (!icon) continue;
    return new NextResponse(icon.bytes as BodyInit, {
      status: 200,
      headers: {
        ...SAFETY_HEADERS,
        'Content-Type': icon.type,
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
      },
    });
  }

  return new NextResponse(null, {
    status: 404,
    headers: { ...SAFETY_HEADERS, 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
  });
}

/**
 * Read one icon URL, following redirects by hand so each hop's host is
 * re-guarded (see `fetchPageHtml`). Null on any failure, an oversized body,
 * or bytes that are not an image format the route serves.
 */
async function fetchIcon(
  url: string,
  timeoutMs: number,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(current);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
      if (isBlockedFetchHost(parsed.hostname)) return null;
      const res = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AturiResolver/1.0; +https://aturi.to)',
          Accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
        },
      });
      if (REDIRECT_STATUSES.has(res.status)) {
        const location = res.headers.get('location');
        if (!location) return null;
        current = new URL(location, current).toString();
        continue;
      }
      if (res.status === 0) return null;
      response = res;
      break;
    }
    if (!response || !response.ok || !response.body) return null;
    const declared = Number(response.headers.get('content-length'));
    if (declared > ICON_MAX_BYTES) return null;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > ICON_MAX_BYTES) return null;
        chunks.push(value);
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    if (size === 0) return null;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const type = sniffIconType(bytes);
    return type ? { bytes, type } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

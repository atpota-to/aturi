/**
 * Which pages have a Markdown twin, and the shared response shape for serving
 * one.
 *
 * The pairing is explicit rather than inferred. Middleware runs before routing
 * and can't know whether an arbitrary path resolves, so guessing "every page
 * has a .md" would rewrite live URLs onto routes that don't exist. Only the
 * paths listed here negotiate; everything else is served as it always was.
 *
 * Each `.md` route is also reachable directly (`/docs.md`, `/about.md`), which
 * is the more reliable option for an agent: no Accept header to get right, and
 * no CDN in between that might have cached the wrong variant.
 */

export const MARKDOWN_MEDIA_TYPE = 'text/markdown';
export const HTML_MEDIA_TYPE = 'text/html';

/**
 * What each negotiating page can produce, in server-preference order. HTML
 * leads so that a client expressing no preference — no Accept header, or
 * `*​/*` — keeps getting the browser representation.
 */
export const NEGOTIABLE_TYPES = [HTML_MEDIA_TYPE, MARKDOWN_MEDIA_TYPE] as const;

/** Page path → the route serving its Markdown representation. */
export const MARKDOWN_VARIANTS: Readonly<Record<string, string>> = {
  '/': '/index.md',
  '/docs': '/docs.md',
  '/about': '/about.md',
  '/contact': '/contact.md',
  '/mcp': '/mcp.md',
};

/**
 * The Markdown twin for a page path, or null when it has none.
 *
 * Trailing slashes are normalised because `/about/` and `/about` are the same
 * page to Next.js but different keys in the map above. The root stays `/`.
 */
export function markdownVariantFor(pathname: string): string | null {
  const normalized =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.replace(/\/+$/, '') : pathname;
  return MARKDOWN_VARIANTS[normalized || '/'] ?? null;
}

/**
 * Standard response for a Markdown representation.
 *
 * `Vary: Accept` is the load-bearing header. These bodies are served both at
 * their own `.md` URL and — via middleware rewrite — at the HTML page's URL,
 * where a CDN would otherwise cache whichever variant was requested first and
 * hand a browser a wall of raw Markdown, or an agent a wall of `<div>`s.
 * `Accept-Encoding` rides along because the edge compresses these too.
 */
export function markdownResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      Vary: 'Accept, Accept-Encoding',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

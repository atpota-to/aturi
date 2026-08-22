import { NextResponse, type NextRequest } from 'next/server';
import { selectRepresentation } from '@/lib/acceptNegotiation';
import {
  HTML_MEDIA_TYPE,
  MARKDOWN_MEDIA_TYPE,
  NEGOTIABLE_TYPES,
  markdownVariantFor,
} from '@/lib/markdownVariants';

/**
 * Markdown content negotiation (https://acceptmarkdown.com/).
 *
 * A handful of pages can be served as either HTML or Markdown from the same
 * URL. An agent that sends `Accept: text/markdown` gets the prose without the
 * nav, the scripts, or the hydration payload — on the homepage that's a few
 * kilobytes instead of a few hundred.
 *
 * Three rules, in the order RFC 9110 §12.5.1 puts them:
 *
 *  - Markdown wins the Accept ranking → rewrite to the `.md` route. The URL
 *    the client asked for doesn't change; only the bytes do.
 *  - HTML wins, or the client expressed no preference (no Accept header, or
 *    `*​/*`) → serve the page as normal. `Vary: Accept` is still appended,
 *    because this URL's representation *did* depend on the header.
 *  - Neither is acceptable — say `Accept: application/pdf`, or
 *    `text/html;q=0, text/markdown;q=0` → 406, with a plain-text body naming
 *    what the URL can actually produce so the client can retry usefully.
 *
 * Only the paths in MARKDOWN_VARIANTS reach any of this. Middleware runs
 * before routing and can't tell whether an arbitrary path resolves, so
 * negotiating site-wide would mean rewriting live URLs onto `.md` routes that
 * were never built — and would fragment the CDN cache on every page.
 */

export function middleware(request: NextRequest) {
  const variant = markdownVariantFor(request.nextUrl.pathname);
  if (!variant) return NextResponse.next();

  const chosen = selectRepresentation(
    request.headers.get('accept'),
    NEGOTIABLE_TYPES,
  );

  if (chosen === null) {
    return new NextResponse(
      `Not Acceptable\n\n` +
        `${request.nextUrl.pathname} can be served as:\n` +
        `- ${HTML_MEDIA_TYPE}\n` +
        `- ${MARKDOWN_MEDIA_TYPE}\n\n` +
        `You requested: ${request.headers.get('accept') ?? '(none)'}\n\n` +
        `The Markdown representation is also at ${variant}, with no Accept header needed.\n`,
      {
        status: 406,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          // 406 turns on the request's Accept value, and the same URL answers
          // 200 for a different client — so it must never be cached flat.
          Vary: 'Accept',
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  if (chosen === MARKDOWN_MEDIA_TYPE) {
    const url = request.nextUrl.clone();
    url.pathname = variant;
    const response = NextResponse.rewrite(url);
    // Belt and braces with the same header on the .md route itself: which of
    // the two survives to the edge depends on how the rewrite is served, and
    // getting this wrong is precisely the bug Vary exists to prevent.
    response.headers.set('Vary', 'Accept, Accept-Encoding');
    return response;
  }

  // HTML: serve the page as it always was.
  //
  // No `Vary: Accept` here, and not for want of trying. Next.js owns the Vary
  // header on rendered pages — base-server's setVaryHeader() replaces whatever
  // middleware or next.config headers() put there with its own RSC list, while
  // every other header from both survives (verified against 16.1). Route
  // Handlers are unaffected, which is why the Markdown branch, and every `.md`
  // route, does carry it.
  //
  // The asymmetry is safe in the direction that matters. A shared cache can't
  // store the Markdown body and later hand it to a browser — that response
  // carries Vary and is keyed by Accept. The unprotected direction is a cache
  // storing this HTML and returning it to an agent that asked for Markdown,
  // which gets a valid, if bulkier, representation of the same page. Agents
  // that want a guarantee should fetch the `.md` URL directly; /llms.txt
  // points at those.
  return NextResponse.next();
}

export const config = {
  // Matcher entries must be static for Next to compile them, so this is the
  // literal spelling of MARKDOWN_VARIANTS' keys. markdownVariantFor() is still
  // the authority on what negotiates — this just keeps middleware off the
  // other 99% of requests. Keep the two in step; a test asserts they match.
  matcher: ['/', '/docs', '/about', '/contact'],
};

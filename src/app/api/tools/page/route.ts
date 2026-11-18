import { NextRequest } from 'next/server';
import { normalizePageUrl, readPage, type PageReport } from '@/lib/tools/page';
import { toolError, toolJson } from '@/lib/tools/server/respond';
import { fetchPageHtml } from '@/utils/fetchPageHtml';
import { toPublicHttpUrl } from '@/utils/ssrfGuard';

// Edge, like /api/at-tags: the same bounded fetch, which needs nothing from Node.
export const runtime = 'edge';

/**
 * Reads a web page for the page checker.
 *
 *   GET /api/tools/page?url=https://example.com/post
 *
 * Returns what a client would learn from the page and nothing else: its
 * title, its Open Graph and Twitter card fields, its canonical link, and the
 * at:// records it declares (the same grouped shape /api/at-tags returns,
 * plus the `at:` tags that parser ignores and any older `<link href="at://">`).
 * The HTML itself never leaves this function.
 *
 * The fetch is the one /api/at-tags and /api/resolve already make
 * (fetchPageHtml): public http(s) hosts only, every redirect hop re-checked,
 * HTML only, and bounded by a timeout and a byte cap. A page that cannot be
 * read is an answer (`fetched: false`), not an error, since "this page
 * refuses to be fetched" is itself what the checker is there to say.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('url');
  if (!raw) {
    return toolError(400, 'missing_parameter', 'Missing url parameter', 'Pass ?url=<the address of a web page>.');
  }
  const input = normalizePageUrl(raw);
  if (!input.ok) return toolError(400, 'invalid_parameter', input.reason);

  // Rejects loopback, private and link-local hosts, so this cannot be used
  // to probe the deployment's own network.
  const target = toPublicHttpUrl(input.url);
  if (!target) {
    return toolError(400, 'invalid_parameter', 'Invalid or disallowed url', 'Must be an absolute http(s) URL on a public host.');
  }

  const url = target.toString();
  const html = await fetchPageHtml(url);
  const report: PageReport = html === null ? { url, fetched: false } : { url, fetched: true, ...readPage(html) };
  return toolJson({ ok: true, ...report }, html === null ? 20 : 60);
}

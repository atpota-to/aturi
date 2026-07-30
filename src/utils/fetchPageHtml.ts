/**
 * Bounded HTML fetch for the routes that inspect a caller-supplied page
 * (`/api/at-tags`, `/api/resolve`). Streams the response and stops at a byte
 * cap or a timeout, so a hostile or enormous page can never tie up the worker.
 *
 * Deliberately does NOT stop reading at `</head>`, and deliberately returns
 * the whole buffer rather than a `<head>` slice.
 *
 * That looks wasteful until you check where metadata actually lands on a
 * streaming framework. Next.js renders `generateMetadata` output into the body
 * and lets React hoist it into `<head>` on the client, and it flushes that
 * markup whenever the metadata promise resolves — so the position is not
 * stable. Measured on aturi.to's own pages: `</head>` closes at ~byte 3,300,
 * while `<meta name="at:canonical">` landed at ~byte 67,000 on one request and
 * ~byte 300,000 (of a 304KB document) on another, because a record page awaits
 * a PDS fetch before its metadata resolves. A scanner that bails at `</head>`
 * sees nothing on those pages, and one with a small cap sees them only
 * sometimes — both were bugs this replaced.
 *
 * Scanning the full buffer is safe for tag extraction: React's streamed flight
 * payload carries the same metadata as escaped JSON (`\"name\":\"at:author\"`),
 * which is not a `<meta>` element and so never matches a tag-shaped pattern.
 *
 * Callers should treat a null return as "couldn't read this as HTML" rather
 * than as "no tags here".
 */

/**
 * Stop reading here. Sized to cover a fully-streamed app-framework page (the
 * 304KB record page above) with headroom, since late-flushed metadata means a
 * tight cap silently loses tags. The timeout, not this, is the real backstop.
 */
export const PAGE_HTML_MAX_BYTES = 1024 * 1024;
const PAGE_FETCH_TIMEOUT_MS = 5000;

export async function fetchPageHtml(
  url: string,
  opts?: { timeoutMs?: number; maxBytes?: number },
): Promise<string | null> {
  const maxBytes = opts?.maxBytes ?? PAGE_HTML_MAX_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts?.timeoutMs ?? PAGE_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Some atmosphere apps (Leaflet, Offprint, pckt) gate on UA; identify
        // ourselves plainly and ask for HTML.
        'User-Agent': 'Mozilla/5.0 (compatible; AturiResolver/1.0; +https://aturi.to)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
      },
    });
    if (!response.ok || !response.body) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) return null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let bytesRead = 0;
    try {
      while (bytesRead < maxBytes) {
        const { value, done } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        buffer += decoder.decode(value, { stream: true });
      }
    } catch {
      // Timed out or the connection dropped part-way. Keep what we already
      // have rather than discarding it — a partial page still parses, and the
      // tags may well be in the bytes that did arrive.
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    return buffer;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

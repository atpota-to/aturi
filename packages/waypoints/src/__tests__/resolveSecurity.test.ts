import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveUrl, resolveViaApi } from '../resolve';

/**
 * Regression tests for the three defects that made `resolveUrl({fetchHead:true})`
 * and `resolveViaApi` unsafe to put behind a server route. Each `it` below
 * pins behaviour that was measured broken before the fix; none of them can pass
 * by accident.
 *
 *   - SSRF: the head probe fetched whatever hostname it was handed. Measured
 *     before the fix: 5 of 5 private hosts reached `fetch`.
 *   - Unbounded body: `await response.text()` buffered the whole response.
 *   - Quadratic backtracking: `/<head[\s\S]*?<\/head>/i` over a 293 KB page
 *     with repeated unclosed `<head` blocked the event loop for 8,840 ms.
 *   - `resolveViaApi` called `res.json()` unconditionally, so a 500 serving an
 *     HTML error page threw a raw SyntaxError instead of returning the
 *     `ResolveApiFailure` arm its own signature documents.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The two escape hatches the SSRF guard adds to `ResolveUrlOptions`. Declared
 * as an intersection so this file compiles against the options type either
 * way — the assertions below, not the types, are what pin the behaviour.
 */
type GuardOptions = NonNullable<Parameters<typeof resolveUrl>[1]> & {
  allowPrivateHosts?: boolean;
  isAllowedFetchHost?: (url: URL) => boolean;
};

function htmlResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (/content-type/i.test(name) ? 'text/html' : null) },
    text: async () => body,
    body: null,
  } as unknown as Response;
}

/**
 * A response whose body is a stream, so the probe has to read it incrementally.
 * `pulled()` reports how many bytes the probe actually asked for — the whole
 * point of the cap is that this stays far below what the server offers.
 */
function streamingHtmlResponse(chunk: string, totalChunks: number) {
  let served = 0;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(chunk);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (served >= totalChunks) {
        controller.close();
        return;
      }
      served++;
      controller.enqueue(encoded);
    },
    cancel() {
      /* the probe is expected to cancel once it hits the cap */
    },
  });
  return {
    response: {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (/content-type/i.test(name) ? 'text/html' : null) },
      // Reading the body as one string is exactly the unbounded path this
      // guards against, so it counts every byte as pulled.
      text: async () => {
        served = totalChunks;
        return chunk.repeat(totalChunks);
      },
      body: stream,
    } as unknown as Response,
    pulledBytes: () => served * encoded.byteLength,
  };
}

describe('resolveUrl head probe: SSRF host guard', () => {
  const PRIVATE_TARGETS = [
    'http://127.0.0.1/admin',
    'http://127.1.2.3/admin',
    'http://localhost/admin',
    'http://LOCALHOST/admin',
    'http://api.localhost/admin',
    'http://printer.local/status',
    'http://vault.internal/v1/secret',
    'http://0.0.0.0/',
    'http://10.1.2.3/',
    'http://172.16.0.1/',
    'http://172.31.255.254/',
    'http://192.168.1.1/',
    // The cloud metadata endpoint, the single highest-value SSRF target.
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
  ];

  it.each(PRIVATE_TARGETS)('never fetches %s', async (target) => {
    const fetchSpy = vi.fn(async () => htmlResponse('<head></head>'));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await resolveUrl(target, { fetchHead: true });
    // The guard has to run *before* the request: a blocked host that still hit
    // the network would have already leaked whether the host exists.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('still probes a public host', async () => {
    const fetchSpy = vi.fn(async () =>
      htmlResponse('<head><link href="at://did:plc:x/app.bsky.feed.post/abc"></head>'),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const result = await resolveUrl('https://example.com/some/post', { fetchHead: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result?.parsed.uri).toBe('at://did:plc:x/app.bsky.feed.post/abc');
  });

  it('does not fetch at all unless fetchHead was asked for', async () => {
    const fetchSpy = vi.fn(async () => htmlResponse('<head></head>'));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await resolveUrl('https://example.com/some/post')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets a caller opt back in to private hosts explicitly', async () => {
    const fetchSpy = vi.fn(async () =>
      htmlResponse('<head><link href="at://did:plc:x/app.bsky.feed.post/abc"></head>'),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const options: GuardOptions = { fetchHead: true, allowPrivateHosts: true };
    const result = await resolveUrl('http://127.0.0.1:3000/post/abc', options);
    // Local development against a dev server is a real use; it just cannot be
    // the default for a library whose stated reason to exist is server-side use.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result?.parsed.uri).toBe('at://did:plc:x/app.bsky.feed.post/abc');
  });

  it('honours a caller-supplied host predicate', async () => {
    const fetchSpy = vi.fn(async () => htmlResponse('<head></head>'));
    vi.stubGlobal('fetch', fetchSpy);
    const options: GuardOptions = {
      fetchHead: true,
      isAllowedFetchHost: (url: URL) => url.hostname === 'allowed.example',
    };
    await resolveUrl('https://example.com/post', options);
    expect(fetchSpy).not.toHaveBeenCalled();

    await resolveUrl('https://allowed.example/post', options);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('resolveUrl head probe: bounded body', () => {
  it('stops reading long before an oversized body is buffered', async () => {
    // 8 MB offered in 64 KB chunks. The documented cap is 1 MB; anything that
    // reads the whole stream is the memory-exhaustion DoS this guards against
    // (a 611 KB gzip response was measured inflating to 1.24 GB RSS).
    const { response, pulledBytes } = streamingHtmlResponse('x'.repeat(64 * 1024), 128);
    vi.stubGlobal('fetch', vi.fn(async () => response));
    await resolveUrl('https://example.com/huge', { fetchHead: true });
    expect(pulledBytes()).toBeLessThan(2 * 1024 * 1024);
  });

  it('still finds an at-uri that arrives inside the cap', async () => {
    const head =
      '<head><link rel="alternate" href="at://did:plc:x/app.bsky.feed.post/abc"></head>';
    const { response } = streamingHtmlResponse(head + '<body>' + 'y'.repeat(1024), 8);
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const result = await resolveUrl('https://example.com/page', { fetchHead: true });
    expect(result?.parsed.uri).toBe('at://did:plc:x/app.bsky.feed.post/abc');
  });
});

describe('resolveUrl head probe: no catastrophic backtracking', () => {
  /**
   * 293 KB of repeated unclosed `<head` and `<link` openers: every one is a new
   * start position for a pattern that then scans to end of input. Measured
   * before the fix, end to end through resolveUrl: 8,840 ms of blocked event
   * loop. The bound below is deliberately generous — the fixed scan is
   * sub-millisecond, so anything near the old number fails by two orders of
   * magnitude rather than by a flaky margin.
   */
  const HOSTILE =
    '<!doctype html><html><head>' + '<link '.repeat(25_000) + '<head '.repeat(25_000);

  it('scans a 293 KB hostile page in under a second', async () => {
    expect(HOSTILE.length).toBeGreaterThan(290_000);
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(HOSTILE)));
    const started = Date.now();
    const result = await resolveUrl('https://example.com/hostile', { fetchHead: true });
    const elapsed = Date.now() - started;
    expect(result).toBeNull();
    expect({ elapsedUnder1s: elapsed < 1000, elapsed }).toMatchObject({ elapsedUnder1s: true });
  }, 30_000);

  it('does not block the event loop while it scans', async () => {
    // The timeout option gives no protection here: the scan is synchronous and
    // runs after the response resolves. A timer scheduled before the call is
    // the only honest way to observe the starvation.
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(HOSTILE)));
    let timerRanAfterMs = -1;
    const scheduledAt = Date.now();
    const timer = new Promise<void>((done) =>
      setTimeout(() => {
        timerRanAfterMs = Date.now() - scheduledAt;
        done();
      }, 50),
    );
    await resolveUrl('https://example.com/hostile', { fetchHead: true });
    await timer;
    expect({ delayedUnder1s: timerRanAfterMs < 1000, timerRanAfterMs }).toMatchObject({
      delayedUnder1s: true,
    });
  }, 30_000);

  it('still reads a link tag out of a normal page', async () => {
    const page =
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="alternate" type="application/at-uri" ' +
      'href="at://did:plc:x/app.bsky.feed.post/abc">' +
      '</head><body>' +
      'z'.repeat(50_000) +
      '</body></html>';
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(page)));
    const result = await resolveUrl('https://example.com/post', { fetchHead: true });
    expect(result?.parsed.uri).toBe('at://did:plc:x/app.bsky.feed.post/abc');
    expect(result?.parsed.collection).toBe('app.bsky.feed.post');
  });
});

describe('resolveViaApi', () => {
  const jsonResponse = (payload: unknown, status = 200): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }) as unknown as Response;

  const brokenResponse = (status: number, body: string): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        throw new SyntaxError(`Unexpected token '<', "${body.slice(0, 10)}"... is not valid JSON`);
      },
      text: async () => body,
    }) as unknown as Response;

  it('returns the failure arm instead of throwing on a non-JSON 500', async () => {
    // The declared return type is a discriminated union, so the documented way
    // to call this is `if (!r.ok) …`. Before the fix that threw the first time
    // aturi.to answered a 502 with an HTML error page.
    const result = await resolveViaApi(
      { url: 'https://bsky.app/profile/alice.bsky.social' },
      { fetch: async () => brokenResponse(500, '<html><body>500 Internal Server Error</body></html>') },
    );
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'http_error' });
  });

  it('returns the failure arm on a 429 serving plain text', async () => {
    const result = await resolveViaApi(
      { atUri: 'at://did:plc:x/app.bsky.feed.post/abc' },
      { fetch: async () => brokenResponse(429, 'Too Many Requests') },
    );
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'http_error' });
  });

  it('returns the failure arm on a 200 whose body is not JSON', async () => {
    const result = await resolveViaApi(
      { url: 'https://bsky.app/profile/alice.bsky.social' },
      { fetch: async () => brokenResponse(200, '<html>captive portal</html>') },
    );
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'invalid_response' });
  });

  it('returns the failure arm when the network is unreachable', async () => {
    const result = await resolveViaApi(
      { url: 'https://bsky.app/profile/alice.bsky.social' },
      {
        fetch: async () => {
          throw new TypeError('fetch failed');
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'network_error' });
  });

  it('still propagates an abort so callers can cancel', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      resolveViaApi(
        { url: 'https://bsky.app/profile/alice.bsky.social' },
        {
          signal: controller.signal,
          fetch: async (_input, init) => {
            (init as RequestInit)?.signal?.throwIfAborted();
            return jsonResponse({ ok: true });
          },
        },
      ),
    ).rejects.toThrow();
  });

  it('passes the input through as query parameters', async () => {
    let seen = '';
    const capture = async (input: RequestInfo | URL) => {
      seen = String(input);
      return jsonResponse({ ok: true, waypoints: [], recommended: { ids: [], label: '' } });
    };
    await resolveViaApi(
      { url: 'https://bsky.app/profile/alice.bsky.social', headDetect: false, composeText: 'a b' },
      { fetch: capture, endpoint: 'https://example.test/api/resolve' },
    );
    const parsed = new URL(seen);
    expect(parsed.origin + parsed.pathname).toBe('https://example.test/api/resolve');
    expect(parsed.searchParams.get('url')).toBe('https://bsky.app/profile/alice.bsky.social');
    expect(parsed.searchParams.get('headDetect')).toBe('false');
    expect(parsed.searchParams.get('composeText')).toBe('a b');
    expect(parsed.searchParams.get('atUri')).toBeNull();
  });

  it('prefers atUri over url and omits headDetect when it is on', async () => {
    let seen = '';
    await resolveViaApi(
      { atUri: 'at://did:plc:x/app.bsky.feed.post/abc', url: 'https://bsky.app/x' },
      {
        fetch: async (input) => {
          seen = String(input);
          return jsonResponse({ ok: true });
        },
      },
    );
    const parsed = new URL(seen);
    expect(parsed.origin + parsed.pathname).toBe('https://aturi.to/api/resolve');
    expect(parsed.searchParams.get('atUri')).toBe('at://did:plc:x/app.bsky.feed.post/abc');
    expect(parsed.searchParams.get('url')).toBeNull();
    expect(parsed.searchParams.get('headDetect')).toBeNull();
  });

  it('throws only for the one caller error it documents', async () => {
    await expect(resolveViaApi({}, { fetch: async () => jsonResponse({}) })).rejects.toThrow(
      /requires either/,
    );
  });
});

/**
 * A bounded, guarded read of a caller-named public URL, for the tool routes
 * under /api/tools.
 *
 * Several tools have to read something the browser cannot: a handle's
 * `/.well-known/atproto-did`, an OAuth client metadata document, a feed
 * generator's answer. Those are public, but they live on arbitrary hosts that
 * rarely send `Access-Control-Allow-Origin`, so the read happens here.
 *
 * That makes each route a fetch of a host the caller chose, and the same
 * rules the MCP server keeps apply (src/lib/mcp/guard.ts):
 *
 *   - Every hop is checked before it is dialled, by name and by the addresses
 *     the name resolves to, so a public name aimed at a private address is
 *     refused. Redirects are followed by hand for the same reason: the guard
 *     on the first URL says nothing about where a Location header points.
 *   - The body is read to a byte cap and the whole exchange to a deadline, so
 *     a host that answers with gigabytes, or never finishes, costs a bounded
 *     amount.
 *   - The request identifies itself, as every upstream request here does.
 *
 * Node runtime only: the guard resolves DNS.
 *
 * This is not a general proxy. Each route that uses it decides the URL's
 * shape itself (a fixed path on a handle's host, a JSON document) and returns
 * a parsed, narrowed result rather than the response.
 */

import { McpToolError } from '@/lib/mcp/errors';
import { assertPublicServiceBase } from '@/lib/mcp/guard';
import { identifyingHeaders } from '@/utils/requestDeadline';

export type GuardedFetchFailure =
  /** Not a URL, not http(s), or a private or internal address. */
  | 'blocked'
  /** The host has no DNS record. */
  | 'unresolved'
  | 'timeout'
  /** Refused, reset, or a TLS failure. */
  | 'network'
  | 'redirects';

export class GuardedFetchError extends Error {
  readonly kind: GuardedFetchFailure;

  constructor(kind: GuardedFetchFailure, message: string) {
    super(message);
    this.name = 'GuardedFetchError';
    this.kind = kind;
  }
}

export type GuardedResponse = {
  /** The URL that finally answered, after any redirects. */
  url: string;
  /** Each URL a redirect led away from, in order. */
  redirectedFrom: string[];
  status: number;
  contentType: string | null;
  headers: Headers;
  /** The body as text, up to the cap. */
  text: string;
  /** True when the body was longer than the cap and was cut there. */
  truncated: boolean;
};

export type GuardedFetchOptions = {
  maxBytes: number;
  timeoutMs?: number;
  accept?: string;
  /** Refuse plain http, on the first URL and on every redirect. */
  httpsOnly?: boolean;
  maxRedirects?: number;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_TIMEOUT_MS = 6000;

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = maxBytes - bytes;
      if (value.byteLength > room) {
        text += decoder.decode(value.subarray(0, room), { stream: true });
        truncated = true;
        break;
      }
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    try {
      await reader.cancel();
    } catch {
      // already closed
    }
  }
  return { text, truncated };
}

export async function guardedFetch(rawUrl: string, options: GuardedFetchOptions): Promise<GuardedResponse> {
  const { maxBytes, timeoutMs = DEFAULT_TIMEOUT_MS, accept, httpsOnly = false, maxRedirects = 3 } = options;
  const signal = AbortSignal.timeout(timeoutMs);
  const redirectedFrom: string[] = [];
  let current = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new GuardedFetchError('blocked', 'Not a valid URL');
    }
    if (parsed.protocol !== 'https:' && (httpsOnly || parsed.protocol !== 'http:')) {
      throw new GuardedFetchError('blocked', httpsOnly ? 'Only https URLs can be read' : 'Only http(s) URLs can be read');
    }
    if (parsed.username || parsed.password) {
      throw new GuardedFetchError('blocked', 'URLs with credentials are not read');
    }

    try {
      await assertPublicServiceBase(parsed.origin, 'The host');
    } catch (err) {
      if (err instanceof McpToolError) {
        const kind: GuardedFetchFailure =
          err.code === 'not_found' ? 'unresolved' : err.code === 'upstream_error' ? 'timeout' : 'blocked';
        throw new GuardedFetchError(kind, err.message);
      }
      throw new GuardedFetchError('network', 'The host could not be checked');
    }

    let res: Response;
    try {
      res = await fetch(parsed.toString(), {
        signal,
        redirect: 'manual',
        headers: identifyingHeaders(accept ? { Accept: accept } : undefined),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new GuardedFetchError('timeout', 'The host did not answer in time');
      }
      throw new GuardedFetchError('network', 'The connection failed');
    }

    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new GuardedFetchError('redirects', 'A redirect named no destination');
      redirectedFrom.push(parsed.toString());
      try {
        current = new URL(location, parsed).toString();
      } catch {
        throw new GuardedFetchError('redirects', 'A redirect named an invalid destination');
      }
      continue;
    }

    let body: { text: string; truncated: boolean };
    try {
      body = await readCapped(res, maxBytes);
    } catch {
      throw new GuardedFetchError('timeout', 'The host stopped answering part-way');
    }
    return {
      url: parsed.toString(),
      redirectedFrom,
      status: res.status,
      contentType: res.headers.get('content-type'),
      headers: res.headers,
      text: body.text,
      truncated: body.truncated,
    };
  }

  throw new GuardedFetchError('redirects', 'Too many redirects');
}

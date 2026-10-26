/**
 * Deadline and identification for the direct-fetch upstream clients.
 *
 * Most outbound calls go through `upstreamFetch`, which bounds and retries
 * them. A handful of clients (appview, slingshot, constellation, plc,
 * identity, ufos) deliberately use bare `fetch` instead: they swallow failures
 * into null rather than throwing, and they must not retry. They still need a
 * deadline, since a host that accepts a connection and never answers would
 * otherwise hold a serverless invocation until the platform kills it.
 *
 * Both concerns live here rather than being repeated per module, so the
 * timeout and the User-Agent cannot drift apart between them.
 */

/** Matches upstreamFetch's per-attempt budget. */
export const UPSTREAM_TIMEOUT_MS = 8000;

/** The caller's signal, if any, combined with the deadline. */
export function withDeadline(signal?: AbortSignal | null): AbortSignal {
  const deadline = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/**
 * Identify this deployment to the services it reads.
 *
 * Constellation, Slingshot and UFOs are run by volunteers, and Bluesky's
 * public AppView is a courtesy; an operator seeing unusual traffic should be
 * able to tell who it is and where to complain. Set only off-browser: a
 * browser forbids scripts from setting User-Agent, and these modules are
 * imported by the extension too.
 */
export const UPSTREAM_USER_AGENT = 'aturi.to (+https://aturi.to/mcp)';

/**
 * The identifying headers to merge into an outbound request, or nothing at
 * all in a browser, where scripts are forbidden from setting User-Agent and
 * the attempt is either ignored or throws.
 */
export function identifyingHeaders(
  existing?: HeadersInit,
): Record<string, string> | undefined {
  const headers = existing as Record<string, string> | undefined;
  if (typeof window !== 'undefined') return headers;
  return { ...headers, 'User-Agent': UPSTREAM_USER_AGENT };
}

export function withIdentification(init?: RequestInit): RequestInit {
  const merged: RequestInit = { ...init, signal: withDeadline(init?.signal) };
  const headers = identifyingHeaders(init?.headers);
  if (headers) merged.headers = headers;
  return merged;
}

/**
 * Shared fetch wrapper for upstream atproto services (appview, PLC
 * directory, PDS hosts).
 *
 * Every server-rendered page ultimately funnels through these upstream
 * calls, so two failure modes matter in production:
 *
 * - A hung TCP connection with no timeout keeps the whole function alive
 *   until the platform kills it (observed as 300s Vercel timeouts).
 * - Transient socket resets (ECONNRESET against public.api.bsky.app) fail
 *   requests that would succeed on an immediate retry.
 *
 * This wrapper bounds every request with AbortSignal.timeout and retries
 * once on network-level failures (never on HTTP error statuses, which are
 * meaningful responses). Works in Node, edge, and browser runtimes — the
 * extension imports sibling modules from this directory.
 *
 * It also identifies the caller. These requests reach personal data servers
 * and plc.directory, run by individuals and by a small team; an operator
 * looking at unfamiliar traffic should be able to see whose it is without
 * having to guess. Without this the requests go out as undici's default
 * `node`, which says nothing.
 */

import { identifyingHeaders } from './requestDeadline';

export type UpstreamFetchOptions = RequestInit & {
  /** Per-attempt timeout in milliseconds. Defaults to 8000. */
  timeoutMs?: number;
  /** Extra attempts after a network-level failure. Defaults to 1. */
  retries?: number;
};

const RETRY_DELAY_MS = 250;

export async function upstreamFetch(
  url: string,
  { timeoutMs = 8000, retries = 1, ...init }: UpstreamFetchOptions = {}
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = identifyingHeaders(init.headers);
      return await fetch(url, {
        ...init,
        ...(headers ? { headers } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  throw lastError;
}

/**
 * Log an upstream HTTP error at the right level: 4xx responses are almost
 * always caused by user-supplied input (a bad handle or rkey in a shared
 * link) and are expected, so they log as warnings; 5xx and everything else
 * logs as an error. Keeps the production error dashboard signal-rich.
 */
export function logUpstreamHttpError(context: string, response: Response): void {
  if (response.status >= 400 && response.status < 500) {
    console.warn(`${context}: HTTP ${response.status} (expected for bad input)`);
  } else {
    console.error(`${context}: HTTP ${response.status}`);
  }
}

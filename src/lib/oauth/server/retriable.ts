/**
 * Which upstream failures are safe to retry.
 *
 * SERVER ONLY. Adapted from anisota-cocoon's lib/retriable-errors.js (MIT).
 *
 * The rule is narrower than "retry network errors", and the narrowness is the
 * whole point. Every code below is a connection-*establishment* failure: the
 * socket to the PDS never opened, so the request never left this process and a
 * retry cannot duplicate it. That safety is what lets writes retry at all.
 *
 * Deliberately excluded, and they must stay excluded:
 *   UND_ERR_HEADERS_TIMEOUT — request sent, response headers never arrived
 *   UND_ERR_BODY_TIMEOUT    — response started, body stalled
 *   ECONNRESET / UND_ERR_SOCKET — connection died at an unknown point
 *
 * Any of those can occur *after* the PDS accepted the write. Retrying one
 * double-posts a record or double-votes.
 */

const RETRIABLE_CONNECT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function codeOf(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  if (typeof e.code === 'string') return e.code;
  if (e.cause && typeof e.cause.code === 'string') return e.cause.code;
  return undefined;
}

export function isRetriableConnectError(err: unknown): boolean {
  const code = codeOf(err);
  if (code && RETRIABLE_CONNECT_CODES.has(code)) return true;
  // undici sometimes surfaces the code only in the message.
  const message = err instanceof Error ? err.message : '';
  return [...RETRIABLE_CONNECT_CODES].some((c) => message.includes(c));
}

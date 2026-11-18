/**
 * Fixed-window rate limiting. SERVER ONLY.
 *
 * Three endpoints need it and none of them are optional. `/api/oauth/login` is
 * unauthenticated and, per call, resolves a caller-supplied identifier,
 * fetches authorization-server metadata, performs a pushed authorization
 * request and writes a row. The XRPC proxy fronts a user's whole repo. The
 * delegation-token endpoint mints credentials against third-party authorities.
 *
 * The window is a row keyed (bucket, window_start) and incremented with an
 * upsert, so counting is atomic across instances rather than per-instance —
 * which on a serverless platform would mean no limit at all.
 *
 * Fails open. A rate limiter that takes the site down when its table is
 * unreachable is a worse outage than the one it prevents.
 */

import { getStore } from './store';

export type RateLimitRule = { limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  login: { limit: 20, windowSeconds: 300 },
  exchange: { limit: 30, windowSeconds: 300 },
  xrpc: { limit: 600, windowSeconds: 60 },
  delegation: { limit: 60, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

function windowStart(windowSeconds: number): string {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(Date.now() / ms) * ms).toISOString();
}

/** True when the caller is within budget. */
export async function allow(bucket: string, rule: RateLimitRule): Promise<boolean> {
  const start = windowStart(rule.windowSeconds);
  const store = getStore();
  try {
    const hits = await store.rpc<number>('bump_rate_limit', {
      p_bucket: bucket,
      p_window_start: start,
    });
    return typeof hits === 'number' ? hits <= rule.limit : true;
  } catch {
    return true;
  }
}

/**
 * A coarse client identifier for unauthenticated endpoints.
 *
 * `x-real-ip` first: Vercel sets it to the address it actually saw, and it is
 * a single value. The leftmost entry of `x-forwarded-for` is whatever the
 * client claimed, so a caller can rotate it freely and buy itself an unlimited
 * number of buckets — using it as the primary key would make the limit
 * decorative. Kept only as a fallback for a host that sets no `x-real-ip`.
 *
 * Hashing happens at the call site, so no raw address is stored.
 */
export function callerKey(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const fwd = request.headers.get('x-forwarded-for');
  return (fwd?.split(',')[0] ?? '').trim() || 'unknown';
}

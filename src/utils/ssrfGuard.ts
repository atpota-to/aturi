/**
 * SSRF guards for API routes that fetch caller-supplied URLs or hosts.
 *
 * Several routes (resolve, og/explore, did-doc) fetch a URL or host derived
 * from user input. Without a guard, an attacker can point them at loopback,
 * link-local, or RFC1918 addresses to probe the server's internal network
 * (a blind reachability/content oracle). These checks reject the obvious
 * private/internal targets by hostname.
 *
 * Limitation: this is a string/literal-IP check, edge-runtime compatible. It
 * does NOT resolve DNS, so a public hostname that resolves to a private IP
 * (DNS rebinding) is not caught here, and callers that follow redirects should
 * treat each hop's URL as untrusted. It matches the existing did-doc guard and
 * raises the bar for the common cases without a Node-only DNS lookup.
 */

/**
 * True when `hostname` points at a loopback/link-local/private/internal
 * target that server-side fetches must not reach.
 */
export function isBlockedFetchHost(hostname: string | undefined | null): boolean {
  if (!hostname) return true;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host.startsWith('fc') || // IPv6 unique-local fc00::/7
    host.startsWith('fd') ||
    host.startsWith('fe80') || // IPv6 link-local
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/**
 * Parse `raw` and return the URL only if it is an http(s) URL on a public,
 * routable host. Returns null for invalid URLs, non-http(s) schemes, and
 * blocked hosts — so callers can `if (!url) return 400` in one line.
 */
export function toPublicHttpUrl(raw: string | undefined | null): URL | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (isBlockedFetchHost(parsed.hostname)) return null;
  return parsed;
}

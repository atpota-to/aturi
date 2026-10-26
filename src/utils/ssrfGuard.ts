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
 * Normalize the two spellings that reach a blocked address without matching
 * its literal text.
 *
 * A trailing dot is the fully-qualified form of the same name: `localhost.`
 * resolves exactly where `localhost` does. An IPv4-mapped IPv6 address
 * (`::ffff:127.0.0.1`, or `::ffff:7f00:1` once the URL parser has compressed
 * it) reaches the same host as the bare IPv4 address it embeds.
 *
 * Alternate integer spellings of an IPv4 address (decimal `2130706433`, hex
 * `0x7f000001`, octal `0177.0.0.1`) need no handling here: the WHATWG URL
 * parser canonicalizes all of them to dotted-quad before a caller ever reads
 * `url.hostname`, so the literal checks below already see `127.0.0.1`.
 */
function canonicalizeHost(hostname: string): string {
  let host = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (host.length > 1 && host.endsWith('.')) host = host.slice(0, -1);

  const mapped = host.match(/^::ffff:([0-9a-f.:]+)$/i);
  if (mapped) {
    const rest = mapped[1];
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rest)) return rest;
    const groups = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (groups) {
      const high = parseInt(groups[1], 16);
      const low = parseInt(groups[2], 16);
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
  }
  return host;
}

/**
 * True when `hostname` points at a loopback/link-local/private/internal
 * target that server-side fetches must not reach.
 */
export function isBlockedFetchHost(hostname: string | undefined | null): boolean {
  if (!hostname) return true;
  const host = canonicalizeHost(hostname);
  // fc00::/7 and fe80::/10 are IPv6 ranges, so those prefixes only mean
  // anything on an IPv6 literal — which always carries a colon, since the URL
  // parser rejects a bare colon-less one. Without this check the prefixes also
  // match ordinary names that happen to start with the same letters
  // (fdcdn.example.com, fcbarcelona.com), refusing public hosts.
  const isIpv6Literal = host.includes(':');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    (isIpv6Literal && host.startsWith('fc')) || // IPv6 unique-local fc00::/7
    (isIpv6Literal && host.startsWith('fd')) ||
    (isIpv6Literal && host.startsWith('fe80')) || // IPv6 link-local
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

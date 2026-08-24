/**
 * Host validation for MCP tools that fetch anything not hard-coded in
 * src/utils/atproto/config.ts. That covers caller-supplied hostnames
 * (describe_pds) and PDS endpoints resolved from DID documents, which are
 * author-controlled and can point anywhere — including at loopback or
 * link-local addresses this server must never fetch.
 *
 * Two checks, because the string one is not enough on its own. The shared
 * `isBlockedFetchHost` reads the hostname only, since it also runs on the edge
 * runtime where DNS is unavailable. That leaves an obvious hole: a perfectly
 * ordinary public name can point wherever its owner likes, and some
 * permanently-registered ones (localtest.me, vcap.me) resolve to loopback with
 * no attacker infrastructure at all. Every caller of this module runs on the
 * Node runtime, so here the name is also resolved and the addresses behind it
 * are checked.
 *
 * This is check-then-connect, so a resolver that answers differently on the
 * second lookup (DNS rebinding) can still win the race. Closing that needs the
 * connection itself pinned to the verified address, which fetch does not
 * expose. What this does remove is the entire class that needs no timing at
 * all: a stable public name aimed at a private address.
 */

import { lookup } from 'node:dns/promises';
import { isBlockedFetchHost } from '@/utils/ssrfGuard';
import { McpToolError } from '@/lib/mcp/errors';

/** IPv4 ranges that must never be dialled, as [first octet match, test]. */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable: fail closed
  }
  const [a, b] = parts;
  return (
    a === 0 || // "this network"
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT, RFC6598
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) || // RFC1918
    (a === 192 && b === 0) || // IETF protocol assignments / TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmarking, RFC2544
    (a === 198 && b === 51) || // TEST-NET-2
    (a === 203 && b === 0) || // TEST-NET-3
    a >= 224 // multicast and reserved, through 255.255.255.255
  );
}

function isPrivateIpv6(ip: string): boolean {
  const host = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]; // drop zone id
  if (host === '::1' || host === '::') return true;

  // IPv4-mapped and NAT64 both carry a v4 address that decides the answer.
  const embedded = host.match(/(?:^::ffff:|^64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embedded) return isPrivateIpv4(embedded[1]);
  const hexMapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }

  return (
    /^f[cd]/.test(host) || // unique-local, fc00::/7
    /^fe[89ab]/.test(host) || // link-local, fe80::/10
    host.startsWith('2001:db8:') // documentation range
  );
}

/** True when an already-resolved address is one this server must not dial. */
export function isPrivateAddress(ip: string): boolean {
  if (!ip) return true;
  return ip.includes(':') ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

/**
 * Normalize a host or URL to an origin with no trailing slash, rejecting
 * anything that is not a public http(s) target. `what` names the value in the
 * error ("The host", "The resolved PDS endpoint").
 */
export async function assertPublicServiceBase(input: string, what: string): Promise<string> {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new McpToolError('invalid_parameter', `${what} is not a valid host or URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new McpToolError('invalid_parameter', `${what} must be an http(s) target`);
  }
  if (isBlockedFetchHost(url.hostname)) {
    throw new McpToolError(
      'invalid_parameter',
      `${what} points at a private or internal address`,
      'Only public hosts can be fetched from this server.',
    );
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    // A name that does not resolve cannot be fetched either, so saying so is
    // both safe and more useful than the connection error that would follow.
    throw new McpToolError(
      'not_found',
      `${what} does not resolve`,
      'Check the hostname; it has no DNS record this server can see.',
    );
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new McpToolError(
      'invalid_parameter',
      `${what} resolves to a private or internal address`,
      'The name is public but points inside a private network, which this server will not fetch.',
    );
  }

  return url.origin;
}

import { NextRequest } from 'next/server';
import { normalizeHandleInput, type DnsProbe, type HandleProbe, type HttpProbe } from '@/lib/tools/handle';
import { GuardedFetchError, guardedFetch } from '@/lib/tools/server/guardedFetch';
import { toolError, toolJson } from '@/lib/tools/server/respond';
import { readTxtAnswer } from '@/lib/tools/txt';
import { DOH_RESOLVER } from '@/utils/atproto/config';
import { identifyingHeaders } from '@/utils/requestDeadline';

// Node runtime: the guard in guardedFetch resolves DNS before it dials.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The two lookups the handle debugger cannot make from a browser.
 *
 *   GET /api/tools/handle?handle=alice.example.com
 *
 * A handle resolves to a DID by a TXT record at `_atproto.<handle>` or by a
 * plain-text file at `https://<handle>/.well-known/atproto-did`. A browser
 * has no DNS API, and the file is on an arbitrary host that seldom allows
 * cross-origin reads, so both are made here and reported as found, raw: the
 * records at the name, and the status, type and body the host returned. What
 * they mean is decided by the page (src/lib/tools/handle.ts), which keeps
 * this route a thin observer.
 *
 * The input must be a syntactically valid handle, so the only URL this ever
 * fetches is that fixed path on that host, and the host is cleared by the
 * same guard as every other server-side fetch here.
 */

const DNS_TIMEOUT_MS = 5000;
const WELL_KNOWN_MAX_BYTES = 2048;

/**
 * DNS over HTTPS: the resolver the lexicon lookups and the OAuth client
 * already use (config.ts), with a second one behind it. Node's own resolver
 * would do, but it asks whatever nameserver the platform configured, and
 * those do not all answer TXT queries; this gives the same answer wherever
 * it runs.
 */
const DOH_ENDPOINTS = [
  (name: string) => `${DOH_RESOLVER}?name=${encodeURIComponent(name)}&type=TXT`,
  (name: string) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
];

async function lookupTxt(name: string): Promise<DnsProbe> {
  let lastError = 'the resolver did not answer';
  for (const endpoint of DOH_ENDPOINTS) {
    try {
      const res = await fetch(endpoint(name), {
        signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
        headers: identifyingHeaders({ Accept: 'application/dns-json' }),
      });
      if (!res.ok) {
        lastError = `the resolver answered HTTP ${res.status}`;
        continue;
      }
      return readTxtAnswer(name, await res.json());
    } catch {
      lastError = 'the resolver did not answer in time';
    }
  }
  return { name, status: 'error', records: [], error: lastError };
}

const FETCH_FAILURE: Record<GuardedFetchError['kind'], string> = {
  blocked: 'the host is not a public address',
  unresolved: 'the domain has no address record, so there is no web server to ask',
  timeout: 'the host did not answer in time',
  network: 'the connection failed (refused, reset, or a certificate problem)',
  redirects: 'the address redirects too many times',
};

async function readWellKnownFile(handle: string): Promise<HttpProbe> {
  const url = `https://${handle}/.well-known/atproto-did`;
  try {
    const res = await guardedFetch(url, {
      maxBytes: WELL_KNOWN_MAX_BYTES,
      httpsOnly: true,
      accept: 'text/plain, */*;q=0.5',
    });
    return {
      url,
      status: 'answered',
      httpStatus: res.status,
      contentType: res.contentType,
      body: res.text.trim().slice(0, 400),
      finalUrl: res.url,
    };
  } catch (err) {
    const error = err instanceof GuardedFetchError ? FETCH_FAILURE[err.kind] : 'the request failed';
    return { url, status: 'error', error };
  }
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('handle');
  if (!raw) {
    return toolError(400, 'missing_parameter', 'Missing handle parameter', 'Pass ?handle=<a handle such as alice.example.com>.');
  }
  const input = normalizeHandleInput(raw);
  if (!input.ok) return toolError(400, 'invalid_parameter', input.reason);

  const { handle } = input;
  const [dns, http] = await Promise.all([lookupTxt(`_atproto.${handle}`), readWellKnownFile(handle)]);
  const probe: HandleProbe = { handle, dns, http };
  // Short: someone fixing a record reloads to see whether it took.
  return toolJson({ ok: true, ...probe }, 20);
}

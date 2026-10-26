import { NextRequest, NextResponse } from 'next/server';
import { apiErrorBody, type ApiErrorCode } from '@/lib/apiError';

// Node runtime (not edge): the OAuth client falls back to this only when a
// direct browser fetch of a did:web document is blocked by CORS, and Node's
// fetch is the most compatible for reaching arbitrary PDS-adjacent hosts.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Same-origin proxy for did:web DID documents.
 *
 * did:web documents are public, but they live at `https://{host}/.well-known/
 * did.json` on arbitrary hosts, many of which don't send
 * `Access-Control-Allow-Origin`. A browser can open the URL directly, yet a
 * cross-origin `fetch()` from our app is blocked from reading the response —
 * which stops the OAuth client from resolving a did:web user's PDS. Fetching
 * the document server-side sidesteps CORS entirely.
 *
 * Because this fetches a caller-supplied URL, it's constrained to look like a
 * DID document (https + a `/did.json` path) on a routable host, so it can't be
 * repurposed as a general SSRF proxy.
 */

const FETCH_TIMEOUT_MS = 8000;

function isAllowedDidDocUrl(u: URL): boolean {
  if (u.protocol !== 'https:') return false;
  if (!u.pathname.endsWith('/did.json')) return false;
  const host = u.hostname.toLowerCase();
  return !(
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('url');
  if (!target) {
    return jsonError(400, 'missing_parameter', 'Missing url parameter',
      'Pass ?url=https://<host>/.well-known/did.json.');
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return jsonError(400, 'invalid_parameter', 'Invalid url',
      'Pass a fully-qualified absolute URL.');
  }
  if (!isAllowedDidDocUrl(parsed)) {
    return jsonError(400, 'invalid_parameter', 'URL is not an allowed did:web document',
      'Must be https, end in /did.json, and sit on a public host.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstream = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'application/did+ld+json,application/json' },
    });
    if (!upstream.ok) {
      return jsonError(502, 'upstream_error', `Upstream returned ${upstream.status}`,
        'The DID document host answered with an error; retry later.');
    }
    const body = await upstream.text();
    return new NextResponse(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=1800',
      },
    });
  } catch {
    return jsonError(502, 'upstream_error', 'Failed to fetch did document',
      'The host was unreachable or timed out; retry later.');
  } finally {
    clearTimeout(timeout);
  }
}

function jsonError(
  status: number,
  code: ApiErrorCode,
  message: string,
  hint?: string,
) {
  return NextResponse.json(apiErrorBody(code, message, hint), {
    status,
    headers: CORS_HEADERS,
  });
}

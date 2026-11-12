import { NextRequest } from 'next/server';
import { narrowClientMetadata, parseClientId, type ClientMetadataProbe } from '@/lib/tools/oauth';
import { GuardedFetchError, guardedFetch } from '@/lib/tools/server/guardedFetch';
import { toolError, toolJson } from '@/lib/tools/server/respond';

// Node runtime: the guard in guardedFetch resolves DNS before it dials.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reads an OAuth client metadata document for the client checker.
 *
 *   GET /api/tools/oauth?client_id=https://app.example.com/oauth-client-metadata.json
 *
 * A `client_id` is the URL of a public JSON document, on whatever host the
 * client's developer chose, and those hosts rarely allow a cross-origin read.
 * So the document is fetched here and handed back parsed, with the facts the
 * spec has rules about: the status, the content type, and whether the address
 * redirected. What they mean is decided by the page (src/lib/tools/oauth.ts).
 * Only the fields client metadata defines are returned, with the names of any
 * others, so the route cannot be used to read arbitrary JSON through.
 *
 * The input must pass the same test the page applies (an https URL with no
 * port and no credentials), and the fetch goes through the guard every other
 * server-side fetch here uses. The `http://localhost` development form is
 * refused: it names no document, and its metadata is derived from the URL
 * alone, in the browser. A `jwks_uri` in the document is never followed.
 */

/** Real documents are a kilobyte or two; one with inline keys, a little more. */
const MAX_BYTES = 64 * 1024;

const FETCH_FAILURE: Record<GuardedFetchError['kind'], string> = {
  blocked: 'the host is not a public address',
  unresolved: 'the hostname does not resolve',
  timeout: 'the host did not answer in time',
  network: 'the connection failed (refused, reset, or a certificate problem)',
  redirects: 'the address redirects too many times',
};

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('client_id');
  if (!raw) {
    return toolError(400, 'missing_parameter', 'Missing client_id parameter', 'Pass ?client_id=<the https URL of a client metadata document>.');
  }
  const input = parseClientId(raw);
  if (!input.ok) return toolError(400, 'invalid_parameter', input.reason);
  if (input.kind === 'loopback') {
    return toolError(400, 'invalid_parameter', 'A http://localhost client_id has no document to fetch', 'Its metadata is derived from the URL itself.');
  }

  const { clientId } = input;
  let probe: ClientMetadataProbe;
  try {
    const res = await guardedFetch(clientId, {
      maxBytes: MAX_BYTES,
      httpsOnly: true,
      accept: 'application/json',
    });
    probe = {
      clientId,
      status: 'answered',
      httpStatus: res.status,
      contentType: res.contentType,
      redirectedFrom: res.redirectedFrom,
      finalUrl: res.url,
    };
    if (res.truncated) {
      probe.bodyProblem = 'The response is larger than 64KB, which is not a client metadata document.';
    } else {
      try {
        const body: unknown = JSON.parse(res.text);
        if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
          // Only the fields client metadata defines go back to the page, and
          // the names of the rest: this reads documents, it does not relay
          // whatever JSON an address serves.
          const narrowed = narrowClientMetadata(body as Record<string, unknown>);
          probe.document = narrowed.document;
          if (narrowed.otherFields.length) probe.otherFields = narrowed.otherFields;
        } else {
          probe.bodyProblem = 'The body is JSON, but not an object. The document must be a JSON object.';
        }
      } catch {
        probe.bodyProblem = /^\s*</.test(res.text)
          ? 'The address returns a web page rather than JSON.'
          : 'The body is not valid JSON.';
      }
    }
  } catch (err) {
    probe = {
      clientId,
      status: 'error',
      error: err instanceof GuardedFetchError ? FETCH_FAILURE[err.kind] : 'the request failed',
    };
  }
  // Short: someone fixing their document reloads to see whether it took.
  return toolJson({ ok: true, ...probe }, 20);
}

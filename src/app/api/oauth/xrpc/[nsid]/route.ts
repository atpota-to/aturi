/**
 * The XRPC proxy: path-passthrough, not method-name RPC.
 *
 * This is the decision the whole migration turns on. The reference backend
 * takes an `X-XRPC-Method` header and walks it into an `@atproto/api` Agent by
 * NSID segment. Two consequences follow from that, and both are fatal here:
 *
 *   - `com.atproto.space.*` has no lexicon in any released `@atproto/api`, so
 *     a method walk cannot serve it at any version. Permissioned spaces — 13
 *     components and the DPoP credential layer — would simply stop working.
 *   - The client then has to hand-mimic the whole Agent surface to talk to it.
 *     anisota's does, in 2,175 lines.
 *
 * Passing the path through instead means `new Agent({ did, fetchHandler })`
 * works unmodified, so the app's existing call sites do not change at all.
 *
 * The security property that replaces the method walk's implicit narrowing:
 * the NSID arrives as OUR OWN route segment and the upstream path is rebuilt
 * server-side. A caller-supplied path is never concatenated with the PDS
 * origin — which matters because the library resolves the path against the
 * token audience with `new URL(path, aud)`, and `new URL(absolute, base)`
 * returns the absolute URL. An unvalidated path is therefore blind
 * request-forgery carrying a live DPoP-bound access token.
 *
 * The segment is `[nsid]`, deliberately not `[...nsid]`: a catch-all accepts
 * slashes, which is exactly what the guard exists to reject.
 */

import { NextResponse } from 'next/server';
import { getOAuthClient } from '@/lib/oauth/server/client';
import { corsPreflight, CORS_HEADERS, fail, guarded, resolveOrigin } from '@/lib/oauth/server/http';
import { isRetriableConnectError } from '@/lib/oauth/server/retriable';
import { allow, RATE_LIMITS } from '@/lib/oauth/server/rateLimit';
import { resolveActor } from '@/lib/oauth/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Every method the app actually calls. An allowlist beats a shape regex at
 * this size, and adding one is a one-line change with a reviewer attached.
 *
 * Derived from every SpaceTransport call site, not only those that assert an
 * OAuth transport — several space methods accept either transport and route
 * through OAuth when that is what they were given, so auditing the asserted
 * ones alone undercounts and produces 403s in exactly the paths spaces need.
 *
 * `com.atproto.repo.uploadBlob` is absent because nothing calls it yet;
 * allowlisting an authenticated 4MB write endpoint ahead of a caller is free
 * exposure. Add it in the change that adds the caller.
 *
 * `com.atproto.space.getDelegationToken` is absent on purpose — it has its own
 * consent-gated endpoint and must not be reachable generically.
 */
const ALLOWED_NSIDS = new Set([
  'com.atproto.repo.getRecord',
  'com.atproto.repo.putRecord',
  'com.atproto.repo.createRecord',
  'com.atproto.repo.deleteRecord',
  'com.atproto.repo.applyWrites',
  'com.atproto.repo.listRecords',
  'com.atproto.repo.describeRepo',
  'com.atproto.space.listSpaces',
  'com.atproto.space.getRecord',
  'com.atproto.space.listRecords',
  'com.atproto.space.putRecord',
  'com.atproto.space.createRecord',
  'com.atproto.space.deleteRecord',
  'com.atproto.simplespace.listMembers',
  'com.atproto.simplespace.getSpace',
  'app.bsky.actor.getProfile',
]);

const NSID_SHAPE = /^[a-z][a-z0-9]*(\.[a-zA-Z0-9]+){2,}$/;

/**
 * `atproto-proxy` is validated by VALUE, not merely allowed by name.
 *
 * The header names a DID plus a service fragment which the user's own PDS
 * resolves and then forwards the request to, carrying a service-auth token
 * that identifies the user. A caller-controlled value therefore points that
 * token at a host of the caller's choosing.
 */
const ALLOWED_PROXY_TARGETS = new Set([
  'did:web:api.bsky.app#bsky_appview',
  'did:web:api.blacksky.community#bsky_appview',
  'did:web:api.bsky.chat#bsky_chat',
]);

/** Request headers relayed upstream. Everything else is dropped. */
const RELAYED_REQUEST_HEADERS = ['content-type', 'accept', 'accept-language', 'atproto-accept-labelers'];

/**
 * Response headers relayed back.
 *
 * `content-encoding` and `content-length` are deliberately absent: undici
 * decodes the body while leaving those headers in place, so copying them
 * describes bytes that are no longer there and the client sees a corrupt
 * response.
 */
const RELAYED_RESPONSE_HEADERS = /^(content-type|retry-after|ratelimit-.*|atproto-.*)$/i;

/**
 * Vercel rejects a request body over 4.5 MB at the platform edge, before this
 * handler runs, so a larger cap here would be unreachable and anything in
 * between would surface as an opaque platform error instead of a clean 413.
 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function OPTIONS() {
  return corsPreflight();
}

async function handle(request: Request, nsid: string): Promise<NextResponse> {
  const origin = resolveOrigin(request);
  if (!origin) return fail(400, 'UNKNOWN_HOST', 'Unknown host');

  if (!NSID_SHAPE.test(nsid) || nsid.split('.').some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) {
    return fail(400, 'INVALID_NSID', 'Not a valid XRPC method name');
  }
  if (!ALLOWED_NSIDS.has(nsid)) {
    return fail(403, 'METHOD_NOT_ALLOWED', `${nsid} is not proxied`);
  }

  const actor = await resolveActor(request, origin);
  if (!actor.ok) return fail(actor.status, actor.code, 'Not signed in');

  if (!(await allow(`xrpc:${actor.tokenHash}`, RATE_LIMITS.xrpc))) {
    return fail(429, 'RATE_LIMITED', 'Too many requests');
  }

  const proxyTarget = request.headers.get('atproto-proxy');
  if (proxyTarget && !ALLOWED_PROXY_TARGETS.has(proxyTarget)) {
    return fail(400, 'INVALID_PROXY_TARGET', 'Unsupported atproto-proxy target');
  }

  // Buffer the body before it reaches the SDK. The OAuth session refuses its
  // refresh-and-retry when the body is a ReadableStream, which would silently
  // disable refresh-on-401 for every write — presenting as intermittent
  // "could not save" on exactly the operations that matter most.
  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return fail(413, 'BODY_TOO_LARGE', 'That request is too large');
    }
  }

  const headers: Record<string, string> = {};
  for (const name of RELAYED_REQUEST_HEADERS) {
    const v = request.headers.get(name);
    if (v) headers[name] = v;
  }
  if (proxyTarget) headers['atproto-proxy'] = proxyTarget;

  const upstreamPath = `/xrpc/${nsid}${new URL(request.url).search}`;

  const { client, sessionStore } = await getOAuthClient(origin, actor.client);

  // Restore, with the retry ladder that exists because concurrent instances
  // race a rotating refresh token: a loser reads the winner's fresh tokens
  // after a short wait.
  let session = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      session = await client.restore(actor.userDid);
      if (session) break;
    } catch (err) {
      if (attempt === 2) {
        console.warn('[oauth] restore failed', err instanceof Error ? err.message : err);
      }
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  if (!session) {
    return fail(401, 'GRANT_MISSING', 'Re-authorization required');
  }

  let tokenRetried = false;
  let connectRetried = false;

  for (;;) {
    let upstream: Response;
    try {
      upstream = await session.fetchHandler(upstreamPath, {
        method: request.method,
        headers,
        ...(body ? { body } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (!tokenRetried && /invalid token/i.test(message)) {
        // Almost always a rotation race: a concurrent request refreshed and
        // invalidated our copy. Re-restore forcing a refresh and try once.
        tokenRetried = true;
        await new Promise((r) => setTimeout(r, 1200));
        try {
          session = await client.restore(actor.userDid, true);
          continue;
        } catch {
          // fall through to the terminal answer below
        }
      }

      if (/invalid token/i.test(message)) {
        // A second failure means the grant is permanently dead — the PDS has
        // revoked it, typically after seeing a replayed refresh token. Drop
        // the row so later requests do not pay the restore ladder to reach the
        // same 401. This is the one place a grant is really deleted; the
        // store's own del() ignores library-initiated deletes on purpose.
        await sessionStore.forceDelete(actor.userDid).catch(() => {});
        return fail(401, 'GRANT_MISSING', 'Re-authorization required');
      }

      if (!connectRetried && isRetriableConnectError(err)) {
        // Connection establishment failed, so the request never left this
        // process and retrying cannot duplicate a write.
        connectRetried = true;
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      return fail(502, 'UPSTREAM_UNREACHABLE', 'Could not reach your PDS');
    }

    // Verbatim status and body. No envelope: three call sites in the app parse
    // structure off thrown errors — one of them distinguishes RecordNotFound
    // from a bare 400 and writes local preferences up to the PDS when it sees
    // "missing", so re-wrapping an error there is a data-loss path.
    const outHeaders = new Headers(CORS_HEADERS);
    upstream.headers.forEach((value, name) => {
      if (RELAYED_RESPONSE_HEADERS.test(name)) outHeaders.set(name, value);
    });
    outHeaders.set('Cache-Control', 'no-store');

    return new NextResponse(await upstream.arrayBuffer(), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  }
}

type Ctx = { params: Promise<{ nsid: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { nsid } = await ctx.params;
  return guarded(() => handle(request, nsid));
}
export async function POST(request: Request, ctx: Ctx) {
  const { nsid } = await ctx.params;
  return guarded(() => handle(request, nsid));
}
export async function PUT(request: Request, ctx: Ctx) {
  const { nsid } = await ctx.params;
  return guarded(() => handle(request, nsid));
}
export async function DELETE(request: Request, ctx: Ctx) {
  const { nsid } = await ctx.params;
  return guarded(() => handle(request, nsid));
}

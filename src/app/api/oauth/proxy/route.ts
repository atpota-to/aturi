/**
 * Confidential OAuth BFF proxy — forwards authenticated XRPC calls to the PDS.
 *
 * {GET,POST} /api/oauth/proxy?<params>
 *   Authorization: Bearer <frontend token>
 *   X-XRPC-Method: <dotted method, e.g. com.atproto.repo.putRecord>
 *   X-Atproto-Proxy: <did#service>   (optional, e.g. did:web:api.bsky.app#bsky_appview)
 *
 * The frontend never holds OAuth tokens; it sends its opaque session token and
 * the desired XRPC method, and we execute it with the user's restored session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { Agent } from '@atproto/api';
import { oauthClient, type OAuthSession } from '@/lib/oauth/server/oauthClient';
import { frontendSessionStore } from '@/lib/oauth/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOOLEAN_PARAMS = ['reverse', 'validate', 'includeTakedowns', 'includeItemCount', 'includePins'];
const NUMERIC_PARAMS = ['limit', 'depth', 'parentHeight'];
const ARRAY_PARAMS = ['feeds', 'uris', 'actors', 'dids', 'handles', 'members', 'labelers'];

type XrpcResult = { data: unknown };

async function handle(request: NextRequest, method: 'GET' | 'POST') {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Missing or invalid authorization header' }, { status: 401 });
  }
  const token = authHeader.slice(7);

  const validation = await frontendSessionStore.validateWithDetails(token);
  if (!validation.userDid) {
    if (validation.error) {
      return NextResponse.json(
        { success: false, code: 'VALIDATION_TRANSIENT_ERROR', error: 'Session validation temporarily unavailable, please retry' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { success: false, code: 'FRONTEND_SESSION_INVALID', error: 'Invalid or expired session' },
      { status: 401 },
    );
  }
  const userDid = validation.userDid;

  const params = request.nextUrl.searchParams;
  const xrpcMethod = request.headers.get('x-xrpc-method') || params.get('method');
  if (!xrpcMethod) {
    return NextResponse.json(
      { success: false, error: 'Missing X-XRPC-Method header or method query parameter' },
      { status: 400 },
    );
  }

  // Restore with retry to ride out refresh-token rotation races across instances.
  let oauthSession: OAuthSession | null = await oauthClient.restoreSession(userDid);
  for (let attempt = 1; attempt < 3 && !oauthSession; attempt++) {
    await new Promise((r) => setTimeout(r, 800 * attempt));
    oauthSession = await oauthClient.restoreSession(userDid);
  }
  if (!oauthSession) {
    return NextResponse.json(
      { success: false, code: 'OAUTH_SESSION_MISSING', error: 'OAuth session missing. Automatic re-authentication required.' },
      { status: 401 },
    );
  }

  // Coerce query params (everything arrives as strings).
  const queryParams: Record<string, unknown> = {};
  for (const [k, v] of params.entries()) queryParams[k] = v;
  delete queryParams.method;
  for (const p of BOOLEAN_PARAMS) if (queryParams[p] !== undefined) queryParams[p] = queryParams[p] === 'true';
  for (const p of NUMERIC_PARAMS) if (queryParams[p] !== undefined) queryParams[p] = Number(queryParams[p]);
  for (const p of ARRAY_PARAMS) {
    if (typeof queryParams[p] === 'string') {
      queryParams[p] = (queryParams[p] as string).split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  let body: unknown = null;
  if (method === 'POST') {
    try {
      body = await request.json();
    } catch {
      body = null;
    }
  }

  const proxyHeader = request.headers.get('x-atproto-proxy');

  const execute = async (session: OAuthSession): Promise<XrpcResult> => {
    const agent = new Agent(session);
    let target: unknown = agent;
    if (proxyHeader) {
      const [proxyDid, serviceType] = proxyHeader.includes('#')
        ? [proxyHeader.split('#')[0], proxyHeader.split('#')[1]]
        : [proxyHeader, 'bsky_fg'];
      target = agent.withProxy(serviceType as never, proxyDid as `did:${string}`);
    }

    // Walk the dotted XRPC path (e.g. com.atproto.repo.putRecord) to the method.
    let parent: unknown = null;
    let current: unknown = target;
    for (const part of xrpcMethod.split('.')) {
      const obj = current as Record<string, unknown> | null;
      if (obj && obj[part] !== undefined) {
        parent = current;
        current = obj[part];
      } else {
        throw new Error(`Unknown XRPC method: ${xrpcMethod}`);
      }
    }
    if (typeof current !== 'function') {
      throw new Error(`${xrpcMethod} is not a callable method`);
    }

    const fn = current as (arg?: unknown) => Promise<XrpcResult>;
    if (method === 'POST' && body) return fn.call(parent, body);
    if (Object.keys(queryParams).length > 0) return fn.call(parent, queryParams);
    return fn.call(parent);
  };

  // Execute with one retry on "Invalid token" (token rotation race); a second
  // failure means the refresh token is genuinely dead → frontend must re-auth.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await execute(oauthSession);
      return NextResponse.json({ success: true, data: result.data });
    } catch (err) {
      const e = err as { message?: string; error?: string; status?: number; statusCode?: number };
      const isInvalidToken =
        e.message === 'Invalid token' || e.message?.includes('Invalid token') || e.error === 'InvalidToken';

      if (isInvalidToken && attempt < 1) {
        await new Promise((r) => setTimeout(r, 1200));
        const fresh = await oauthClient.restoreSession(userDid);
        if (fresh) {
          oauthSession = fresh;
          continue;
        }
      }

      if (isInvalidToken) {
        return NextResponse.json(
          { success: false, code: 'OAUTH_SESSION_MISSING', error: 'OAuth session expired. Automatic re-authentication required.' },
          { status: 401 },
        );
      }

      return NextResponse.json(
        { success: false, error: e.message || 'Proxy request failed', code: e.error },
        { status: e.status || e.statusCode || 500 },
      );
    }
  }

  return NextResponse.json({ success: false, error: 'Proxy request failed' }, { status: 500 });
}

export async function GET(request: NextRequest) {
  return handle(request, 'GET');
}

export async function POST(request: NextRequest) {
  return handle(request, 'POST');
}

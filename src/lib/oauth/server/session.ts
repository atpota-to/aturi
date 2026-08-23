/**
 * App sessions: the opaque credential the browser and the extension actually
 * hold. SERVER ONLY.
 *
 * The ATProto tokens never leave this process. What a client holds is a random
 * 32-byte token, presented either as a same-origin cookie (web) or as a bearer
 * (extension, and localhost dev against a deployed BFF).
 *
 * Only `sha256(token)` is stored. A database dump therefore yields nothing
 * replayable — unlike the reference implementation, which uses the raw 30-day
 * bearer as a table's primary key, one table over from AES-GCM-encrypted OAuth
 * tokens.
 */

import { requireBffConfig, isOAuthClientKind, type OAuthClientKind } from './env';
import { randomToken, sha256Hex } from './crypto';
import { appSessionCache } from './cache';
import { getStore, TABLE } from './store';

/**
 * `__Host-` forbids a `Domain` attribute, which is the point: it makes it
 * impossible for someone later to "fix" cross-subdomain sign-in by widening
 * the cookie to `.aturi.to` and exposing the session to every current and
 * future subdomain. The prefix also requires Secure, which a local http dev
 * server cannot satisfy — hence the unprefixed name there, and only there.
 */
export const SESSION_COOKIE_SECURE = '__Host-aturi_sid';
export const SESSION_COOKIE_INSECURE = 'aturi_sid';
// Re-exported rather than redeclared: the client reads this name and the
// server writes it, and two spellings of it would fail silently — the probe
// would simply never fire.
export { SIGNED_IN_HINT_COOKIE } from '../cookies';
/** Short-lived CSRF binding for an in-flight authorization. */
export const FLOW_COOKIE_SECURE = '__Host-aturi_flow';
export const FLOW_COOKIE_INSECURE = 'aturi_flow';

export function isSecureOrigin(origin: string): boolean {
  return origin.startsWith('https://');
}

export function sessionCookieName(origin: string): string {
  return isSecureOrigin(origin) ? SESSION_COOKIE_SECURE : SESSION_COOKIE_INSECURE;
}

export function flowCookieName(origin: string): string {
  return isSecureOrigin(origin) ? FLOW_COOKIE_SECURE : FLOW_COOKIE_INSECURE;
}

export type AppSession = {
  token: string;
  userDid: string;
  client: OAuthClientKind;
  expiresAt: Date;
};

export async function mintAppSession(
  userDid: string,
  client: OAuthClientKind,
  label?: string,
): Promise<AppSession> {
  const cfg = requireBffConfig();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + cfg.appSessionTtlDays * 86_400_000);
  await getStore().insert(TABLE.appSessions, {
    token_sha256: sha256Hex(token),
    user_did: userDid,
    client,
    label: label ?? null,
    expires_at: expiresAt.toISOString(),
  });
  return { token, userDid, client, expiresAt };
}

export type ResolvedActor =
  | { ok: true; userDid: string; client: OAuthClientKind; tokenHash: string }
  | { ok: false; status: 401 | 403 | 503; code: string };

/**
 * Who is calling, from the cookie (web) or the bearer (extension, dev).
 *
 * The three outcomes are deliberately distinct and clients branch on them:
 * 401 means definitively signed out, 503 means the database could not answer
 * and the caller should retry rather than clear its session. Collapsing those
 * two turns a momentary database hiccup into a mass sign-out.
 */
export async function resolveActor(request: Request, origin: string): Promise<ResolvedActor> {
  const auth = request.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;

  let token = bearer;
  if (!token) {
    token = readCookie(request, sessionCookieName(origin));
    if (token) {
      // The cookie path is same-origin only. A cross-site top-level GET sends
      // no Origin header at all — and SameSite=Lax sends the cookie on exactly
      // those — so this check alone would fail open; Sec-Fetch-Site closes
      // that gap on every browser that sends it, and the flow-binding cookie
      // in the login/callback pair covers the rest.
      const reqOrigin = request.headers.get('origin');
      if (reqOrigin && reqOrigin !== origin) {
        return { ok: false, status: 403, code: 'CROSS_ORIGIN' };
      }
      const site = request.headers.get('sec-fetch-site');
      if (site && site !== 'same-origin' && site !== 'none') {
        return { ok: false, status: 403, code: 'CROSS_SITE' };
      }
    }
  }
  if (!token) return { ok: false, status: 401, code: 'SESSION_INVALID' };

  const hash = sha256Hex(token);

  const cached = appSessionCache.get(hash);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return {
        ok: true,
        userDid: cached.userDid,
        client: cached.client as OAuthClientKind,
        tokenHash: hash,
      };
    }
    appSessionCache.delete(hash);
  }

  let row;
  try {
    row = await getStore().selectOne(
      TABLE.appSessions,
      { token_sha256: hash },
      'user_did,client,expires_at',
    );
  } catch {
    return { ok: false, status: 503, code: 'SESSION_TRANSIENT' };
  }

  if (!row) return { ok: false, status: 401, code: 'SESSION_INVALID' };

  const expiresAt = new Date(String(row.expires_at)).getTime();
  if (expiresAt <= Date.now()) {
    await getStore()
      .remove(TABLE.appSessions, { token_sha256: hash })
      .catch(() => {});
    return { ok: false, status: 401, code: 'SESSION_INVALID' };
  }

  const client = row.client;
  if (!isOAuthClientKind(client)) return { ok: false, status: 401, code: 'SESSION_INVALID' };

  appSessionCache.set(hash, { userDid: String(row.user_did), client, expiresAt });
  return { ok: true, userDid: String(row.user_did), client, tokenHash: hash };
}

/**
 * Sliding expiry, at most once an hour. The reference implementation has none:
 * its sessions expire 30 days after issuance no matter how actively they are
 * used, so a daily user is signed out monthly for no reason.
 */
export async function touchAppSession(tokenHash: string): Promise<void> {
  const cfg = requireBffConfig();
  try {
    const row = await getStore().selectOne(
      TABLE.appSessions,
      { token_sha256: tokenHash },
      'last_seen_at',
    );
    if (!row) return;
    const last = new Date(String(row.last_seen_at)).getTime();
    if (Date.now() - last < 3_600_000) return;
    const expiresAt = new Date(Date.now() + cfg.appSessionTtlDays * 86_400_000);
    await getStore().update(
      TABLE.appSessions,
      { token_sha256: tokenHash },
      { last_seen_at: new Date().toISOString(), expires_at: expiresAt.toISOString() },
    );
    appSessionCache.delete(tokenHash);
  } catch {
    // Refreshing an expiry is never worth failing a request over.
  }
}

export async function deleteAppSession(tokenHash: string): Promise<void> {
  appSessionCache.delete(tokenHash);
  await getStore().remove(TABLE.appSessions, { token_sha256: tokenHash });
}

export async function deleteAppSessionsFor(
  userDid: string,
  client?: OAuthClientKind,
): Promise<void> {
  appSessionCache.deleteWhere(
    (_k, v) => v.userDid === userDid && (!client || v.client === client),
  );
  await getStore().remove(
    TABLE.appSessions,
    client ? { user_did: userDid, client } : { user_did: userDid },
  );
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    }
  }
  return null;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAge: number; secure: boolean; httpOnly?: boolean },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${opts.maxAge}`,
  ];
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean): string {
  const parts = [`${name}=`, 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

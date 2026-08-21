/**
 * Obtaining and holding space credentials.
 *
 * Reading a space that isn't your own repo takes a **space credential**: a JWT
 * the space authority signs, DPoP-bound to a keypair this app generates, that
 * every repo host in the space accepts. Getting one is a two-hop exchange:
 *
 *   1. `getDelegationToken` on the *signed-in user's own PDS*, over OAuth. The
 *      PDS attests "this app is acting for this user, for this space". Single
 *      use, ~60 seconds.
 *   2. `getSpaceCredential` on the *authority's space host*, presenting that
 *      delegation token plus a DPoP proof from the key to bind to. The
 *      authority decides whether to issue.
 *
 * A credential reads private data belonging to *other people* — every member's
 * permissioned repo in the space — so this module is deliberately the only one
 * that holds one, and holds it as conservatively as it can:
 *
 *   - **Memory only.** No localStorage, no sessionStorage, no IndexedDB. Any of
 *     those is plaintext-readable by any script that reaches this origin and
 *     survives navigation, so an XSS landing at any point in a two-hour window
 *     would walk off with a credential good against every host in the space.
 *     Memory-only bounds the exposure to the life of one page, at the cost of
 *     one re-mint per page load.
 *   - **Non-extractable key.** The bound keypair (see ./spaceDpop) cannot be
 *     exported, so even script executing here can only sign while the page
 *     lives; the credential is inert without a proof from that exact key.
 *   - **`redirect: 'error'` on every credential-bearing request.** A followed
 *     redirect would resend the credential to a host the proof does not name,
 *     with an `htu` that no longer matches.
 *   - **Never `credentials: 'include'`.** PDSes serve
 *     `Access-Control-Allow-Origin: *`, which a credentialed request cannot use.
 *
 * The delegation token is never stored at all: it is single-use, expires in a
 * minute, and is passed straight into the exchange.
 *
 * This module also owns the shared HTTP plumbing (`SpaceXrpcError`,
 * `joinXrpcUrl`) that ./spaceClient builds on, so the dependency edge between
 * the two runs one way only: the client layer imports the credential layer,
 * never the reverse.
 */

import { createDpopProof, decodeJwtPayload, generateSpaceDpopKey } from './spaceDpop';
import type { SpaceDpopKey } from './spaceDpop';
import type { SpaceAuthority } from './spaceIdentity';

export type SpaceCredential = {
  readonly token: string;
  readonly key: SpaceDpopKey;
  /** Canonical space ref this credential is scoped to. */
  readonly space: string;
  /** Epoch ms, read from the credential's own unverified `exp`. */
  readonly expiresAt: number;
};

/**
 * The one capability this module needs from the OAuth layer: a fetch that hits
 * the SIGNED-IN USER'S OWN PDS with the OAuth DPoP access token and handles the
 * OAuth DPoP-nonce dance. In practice `session.fetchHandler`.
 */
export type OwnPdsFetch = (path: string, init?: RequestInit) => Promise<Response>;

/* -------------------------------------------------------------------------- *
 * Shared HTTP plumbing
 * -------------------------------------------------------------------------- */

/**
 * Every failure out of a space call. The message format is byte-compatible
 * with `pdsClient`'s `fetchJson` on purpose — the explorer's record error panel
 * parses exactly that shape — and `xrpcError` carries the machine-readable
 * `error` field from the JSON body, which is what callers should branch on.
 */
export type SpaceXrpcError = Error & { status?: number; xrpcError?: string };

/**
 * Build the thrown error for a non-OK space response. Consumes the body, so it
 * is only ever called on the throwing path.
 */
export async function readSpaceXrpcError(res: Response, url: string): Promise<SpaceXrpcError> {
  const text = await res.text().catch(() => '');
  const err: SpaceXrpcError = new Error(
    `HTTP ${res.status} ${res.statusText} for ${url} :: ${text.slice(0, 200)}`,
  );
  err.status = res.status;

  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body?.error === 'string') err.xrpcError = body.error;
  } catch {
    // A non-JSON body (a proxy error page, an empty 502) is not an XRPC error
    // and leaves `xrpcError` unset. Callers treat that as "transport failure".
  }

  return err;
}

/**
 * Join an XRPC path onto a host that may itself carry a path prefix.
 *
 * `new URL('/xrpc/…', 'https://host/pds')` discards the `/pds`, which would
 * silently address the wrong service. Resolving a *relative* reference against
 * a base with a trailing slash keeps it.
 */
export function joinXrpcUrl(host: string, path: string): string {
  const base = host.endsWith('/') ? host : `${host}/`;
  return new URL(path.replace(/^\/+/, ''), base).toString();
}

/**
 * Issue a request carrying a freshly built DPoP proof.
 *
 * Deliberately plain `fetch`, not `upstreamFetch`: that wrapper retries once on
 * a network-level failure, and a DPoP proof is single-use against a replay
 * cache the host shares with its OAuth path. A silent retry would resend a
 * consumed `jti`.
 *
 * The nonce hedge below is dead code against the reference implementation,
 * which has no nonce concept on space paths at all — it never asks for one and
 * never issues one. It is here so that a host which *does* start asking gets a
 * single correct retry rather than a hard failure, and it fires only when the
 * host actually sent a `DPoP-Nonce` header. Never an unsolicited nonce, never
 * a loop.
 */
async function fetchWithDpop(
  url: string,
  init: RequestInit,
  buildProof: (nonce?: string) => Promise<string>,
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();

  const send = async (nonce?: string): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set('dpop', await buildProof(nonce));
    return fetch(url, { ...init, method, headers, redirect: 'error' });
  };

  const res = await send();
  if (res.ok || res.status !== 401) return res;

  const nonce = res.headers.get('dpop-nonce');
  if (!nonce) return res;
  const body = await res
    .clone()
    .text()
    .catch(() => '');
  if (!body.includes('use_dpop_nonce')) return res;

  return send(nonce);
}

/* -------------------------------------------------------------------------- *
 * The two-hop exchange
 * -------------------------------------------------------------------------- */

/** Protocol default credential lifetime, used only when `exp` is unreadable. */
const DEFAULT_CREDENTIAL_LIFETIME_MS = 7_200_000;

/** Re-mint this far ahead of expiry rather than racing a request against it. */
const RENEW_MARGIN_MS = 120_000;

/**
 * `com.atproto.space.getDelegationToken` on the user's own PDS.
 *
 * Needs an OAuth grant with `action=read` — `read_self` is explicitly refused,
 * because a delegation token is what an app trades for whole-space access — and
 * rejects app passwords. Single-use and ~60s-lived: spend it immediately, never
 * store it, and if the exchange fails for anything but a transport error, mint
 * a fresh one rather than retrying with the same token.
 */
export async function getDelegationToken(
  fetchOwnPds: OwnPdsFetch,
  space: string,
): Promise<string> {
  const params = new URLSearchParams({ space });
  const path = `/xrpc/com.atproto.space.getDelegationToken?${params}`;
  const res = await fetchOwnPds(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw await readSpaceXrpcError(res, res.url || path);

  const body = (await res.json()) as { token?: unknown };
  if (typeof body?.token !== 'string' || !body.token) {
    throw new Error('getDelegationToken returned no token');
  }
  return body.token;
}

/**
 * `com.atproto.space.getSpaceCredential` on the authority's space host.
 *
 * The delegation token rides under the **Bearer** scheme, not DPoP. The
 * distinction is load-bearing rather than stylistic: the host routes a
 * `DPoP`-scheme Authorization header to its space-credential verifier, so a
 * delegation token presented that way is misread rather than cleanly refused.
 *
 * The proof carries no `ath` — we are obtaining a credential, not presenting
 * one, and sending `ath` here is itself a 401.
 *
 * `clientAttestation` is never sent: aturi.to is a public OAuth client with no
 * published JWKS, so it has nothing to attest with. A space whose `appAccess`
 * is `#allowList` is therefore permanently out of reach, and that is a fact to
 * surface rather than retry.
 */
export async function exchangeSpaceCredential(opts: {
  spaceHost: string;
  delegationToken: string;
  space: string;
  key: SpaceDpopKey;
}): Promise<SpaceCredential> {
  const { spaceHost, delegationToken, space, key } = opts;
  const url = joinXrpcUrl(spaceHost, 'xrpc/com.atproto.space.getSpaceCredential');

  const res = await fetchWithDpop(
    url,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${delegationToken}`,
      },
      body: JSON.stringify({ space }),
    },
    (nonce) => createDpopProof(key, { htm: 'POST', htu: url, nonce }),
  );

  if (!res.ok) throw await readSpaceXrpcError(res, url);

  const body = (await res.json()) as { credential?: unknown };
  const token = body?.credential;
  if (typeof token !== 'string' || !token) {
    throw new Error('getSpaceCredential returned no credential');
  }

  return { token, key, space, expiresAt: credentialExpiry(token) };
}

/**
 * Read `exp` off the credential we were just handed over TLS by the host that
 * minted it. The signature is not verified and must not be trusted for
 * anything else; this only decides when to renew. A credential whose `exp` we
 * cannot read is treated as living for the protocol default, never as
 * non-expiring.
 */
function credentialExpiry(token: string): number {
  const exp = decodeJwtPayload(token)?.exp;
  if (typeof exp === 'number' && Number.isFinite(exp)) return exp * 1000;
  return Date.now() + DEFAULT_CREDENTIAL_LIFETIME_MS;
}

/* -------------------------------------------------------------------------- *
 * The in-memory credential store
 * -------------------------------------------------------------------------- */

const credentials = new Map<string, SpaceCredential>();
const inflight = new Map<string, Promise<SpaceCredential>>();

/**
 * The normal entry point: return a live credential for a space, minting one if
 * there isn't a usable one already. Concurrent callers for the same space share
 * one exchange rather than each burning a delegation token.
 *
 * A fresh keypair is generated per credential, as the proposal asks — the key
 * is what the credential is bound to, so reusing one across credentials would
 * link them.
 */
export async function acquireSpaceCredential(
  fetchOwnPds: OwnPdsFetch,
  space: string,
  authority: SpaceAuthority,
  opts?: { forceRefresh?: boolean },
): Promise<SpaceCredential> {
  if (opts?.forceRefresh) {
    credentials.delete(space);
  } else {
    const existing = credentials.get(space);
    if (existing && existing.expiresAt - Date.now() > RENEW_MARGIN_MS) return existing;
    if (existing) credentials.delete(space);
  }

  const pending = inflight.get(space);
  if (pending) return pending;

  const minting = (async () => {
    const key = await generateSpaceDpopKey();
    const delegationToken = await getDelegationToken(fetchOwnPds, space);
    const credential = await exchangeSpaceCredential({
      spaceHost: authority.spaceHost,
      delegationToken,
      space,
      key,
    });
    credentials.set(space, credential);
    return credential;
  })().finally(() => {
    inflight.delete(space);
  });

  inflight.set(space, minting);
  return minting;
}

/** Drop one cached credential — used by the single reactive re-mint. */
export function forgetSpaceCredential(space: string): void {
  credentials.delete(space);
}

/**
 * Drop everything. Called on sign-out and on account switch: a credential is
 * scoped to the user it was delegated for and must not outlive that session,
 * and neither does the visitor's consent to talk to the authorities that
 * issued them.
 */
export function clearSpaceCredentials(): void {
  credentials.clear();
  inflight.clear();
  unlockedAuthorities.clear();
  notifyUnlockListeners();
}

/* -------------------------------------------------------------------------- *
 * Which authorities the visitor has agreed to talk to
 * -------------------------------------------------------------------------- */

/**
 * Minting a credential is not a passive read. Step 1 asks the signed-in user's
 * OWN PDS for a delegation token — a short-lived assertion signed by their own
 * signing key, naming their DID — and step 2 hands it to whatever host the
 * authority's DID document points at. Both the authority DID and, through it,
 * the receiving host come out of the address, and a `read` grant is
 * `authority=*`: the PDS mints for any space ref asked of it, because
 * membership is the authority's determination and not the PDS's.
 *
 * So an `/explore/{attacker-did}/space/{type}/{key}` link, opened and nothing
 * more, would tell a server of the attacker's choosing who the visitor is,
 * where their PDS is, and that they hold whole-space access in this app. No
 * click is involved and nothing about it is visible afterwards.
 *
 * The remedy is consent per authority: the first credential for an authority is
 * minted only once the visitor has been shown which host is about to receive
 * the token and has said yes. Consent covers every space that authority runs,
 * so following links inside a space already unlocked never re-asks, and it is
 * held in memory exactly as conservatively as the credentials themselves.
 */
const unlockedAuthorities = new Set<string>();
const unlockListeners = new Set<() => void>();

function notifyUnlockListeners(): void {
  for (const listener of [...unlockListeners]) listener();
}

/** The unlocked authority DIDs, as a snapshot a React store can compare. */
export function snapshotUnlockedAuthorities(): ReadonlySet<string> {
  return new Set(unlockedAuthorities);
}

/** Record that the visitor agreed to mint credentials from this authority. */
export function unlockSpaceAuthority(did: string): void {
  if (unlockedAuthorities.has(did)) return;
  unlockedAuthorities.add(did);
  notifyUnlockListeners();
}

/** Subscribe to unlock changes. Returns the unsubscribe. */
export function subscribeSpaceAuthorityUnlocks(listener: () => void): () => void {
  unlockListeners.add(listener);
  return () => {
    unlockListeners.delete(listener);
  };
}

/* -------------------------------------------------------------------------- *
 * Using a credential
 * -------------------------------------------------------------------------- */

/**
 * Credential-bearing fetch: `Authorization: DPoP <credential>` plus a fresh
 * proof naming this exact method and URL and carrying `ath` over the credential
 * itself. One proof per request — a proof is never reused, including across a
 * retry.
 */
export async function spaceFetch(
  cred: SpaceCredential,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('authorization', `DPoP ${cred.token}`);
  const method = (init?.method ?? 'GET').toUpperCase();

  return fetchWithDpop(url, { ...init, method, headers }, (nonce) =>
    createDpopProof(cred.key, { htm: method, htu: url, credential: cred.token, nonce }),
  );
}

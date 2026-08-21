/**
 * The `com.atproto.space` / `com.atproto.simplespace` read methods.
 *
 * Two things about these calls are easy to get wrong and expensive to debug,
 * so both are encoded here rather than left to call sites:
 *
 * **Which host.** A space is served by two different roles. The *space host* is
 * the authority's own service and answers for the space as a whole
 * (`listRepos`, `getSpace`, `listMembers`). A *repo host* is each member's own
 * PDS and answers for that member's permissioned repo (`getRecord`,
 * `listRecords`, `getLatestCommit`, `listRepoOps`). Sending a repo read to the
 * space host reaches a service with no such repo. `listSpaces` is a third case
 * again: it only ever reads the caller's own PDS.
 *
 * **Which credential.** An OAuth token reaches only the signed-in user's own
 * repo — `assertSpaceRead` compares the token's DID against the requested repo
 * *first* and throws `RepoNotFound` when they differ, which is deliberately the
 * same error an absent repo gets. Reading another member's repo always goes
 * through a space credential, never through a broader OAuth grant. Conversely
 * `listRepos` accepts *only* a credential, and `listMembers` accepts *only*
 * OAuth from the authority itself.
 *
 * Everything is raw fetch. `@atproto/api`'s `XrpcClient.call` resolves the
 * lexicon before it touches the network, and no released `@atproto/api` has
 * `com.atproto.space.*` registered, so an agent call throws before it can even
 * be wrong — which is also why this needs no new dependency.
 */

import {
  forgetSpaceCredential,
  joinXrpcUrl,
  readSpaceXrpcError,
  spaceFetch,
  type SpaceCredential,
  type SpaceXrpcError,
} from './spaceCredential';

export type { SpaceXrpcError };

/* -------------------------------------------------------------------------- *
 * Wire types
 * -------------------------------------------------------------------------- */

/**
 * `spaceView` carries a URI and nothing else — no name, no counts, no
 * timestamps. Everything a listing shows about a space is either parsed back
 * out of the URI or resolved separately from the space type declaration.
 */
export type SpaceView = { uri: string };

export type SpaceRecordRow = {
  collection: string;
  rkey: string;
  cid: string;
  /** Inlined by default; absent when `excludeValues` was set. */
  value?: Record<string, unknown>;
};

export type SpaceRepoEntry = {
  did: string;
  rev: string;
  /** `bytes` on the wire, i.e. `{ $bytes: '<base64>' }`. */
  hash: unknown;
};

export type SpaceOpEntry = {
  rev: string;
  collection: string;
  rkey: string;
  /** null ⇒ delete */
  cid: string | null;
  /** null ⇒ create */
  prev: string | null;
  value?: Record<string, unknown>;
};

/** `hash`, `mac`, `ikm` and `sig` are `bytes`, i.e. `{ $bytes: '<base64>' }`. */
export type SpaceSignedCommit = {
  ver: number;
  hash: unknown;
  mac: unknown;
  ikm: unknown;
  sig: unknown;
  rev: string;
};

export type SimpleSpaceConfig = {
  uri: string;
  policy: { $type: string; managingApp?: string };
  appAccess: { $type: string; allowed?: string[] };
};

/**
 * The `$type` literals a simplespace config's open unions carry. Anything not
 * listed is an implementation this client does not know, and must be treated as
 * "unknown policy" rather than as the permissive case.
 */
export const SIMPLESPACE_POLICY = {
  public: 'com.atproto.simplespace.defs#publicPolicy',
  memberList: 'com.atproto.simplespace.defs#memberListPolicy',
  managingApp: 'com.atproto.simplespace.defs#managingAppPolicy',
} as const;

export const SIMPLESPACE_APP_ACCESS = {
  open: 'com.atproto.simplespace.defs#open',
  allowList: 'com.atproto.simplespace.defs#allowList',
} as const;

/* -------------------------------------------------------------------------- *
 * Transports
 * -------------------------------------------------------------------------- */

/**
 * Where a space call is sent and what authenticates it.
 *  - 'oauth'      : the signed-in user's OWN PDS, OAuth DPoP token. `host` ignored.
 *  - 'credential' : any host in the space, space credential + per-request proof.
 */
export type SpaceTransport = {
  kind: 'oauth' | 'credential';
  call: (host: string, path: string, init?: RequestInit) => Promise<Response>;
  /**
   * Present only on a credential transport that knows how to re-mint. Used for
   * the single reactive retry when a credential goes stale mid-page; see
   * {@link isCredentialStaleError}.
   */
  renew?: () => Promise<SpaceTransport>;
};

export function oauthTransport(session: {
  fetchHandler(path: string, init?: RequestInit): Promise<Response>;
}): SpaceTransport {
  return {
    kind: 'oauth',
    // The OAuth session resolves paths against the token's own audience, so the
    // host argument is meaningless here and is deliberately dropped.
    call: (_host, path, init) => session.fetchHandler(path, init),
  };
}

/**
 * A credential transport addresses whichever host each method names. Pass
 * `renew` — typically a bound `acquireSpaceCredential(..., { forceRefresh: true })`
 * — to enable the one reactive re-mint; without it a stale credential surfaces
 * as an error for the caller to handle.
 *
 * The credential lives in a mutable cell rather than being closed over, and
 * `renew` swaps it in place and hands the *same* transport back. That is what
 * makes one re-mint enough: the component holding this transport keeps holding
 * it, so the next request goes out with the fresh credential instead of
 * re-failing on the stale one and minting again. Closing over an immutable
 * credential turns a two-hour page into one delegation token and one credential
 * per request, all of them charged to the user's PDS and the authority.
 *
 * Concurrent re-mints collapse onto one promise for the same reason: a page
 * that fires three reads at once gets three 401s at once.
 */
export function credentialTransport(
  cred: SpaceCredential,
  renew?: () => Promise<SpaceCredential>,
): SpaceTransport {
  let current = cred;
  let renewing: Promise<SpaceCredential> | null = null;

  const startRenew = (mint: () => Promise<SpaceCredential>): Promise<SpaceCredential> => {
    // Drop the stale entry here rather than trusting the caller's `renew` to
    // have asked for a forced refresh — otherwise a plain
    // `acquireSpaceCredential` would hand back the very credential the host
    // just rejected.
    forgetSpaceCredential(current.space);
    const pending = mint().finally(() => {
      if (renewing === pending) renewing = null;
    });
    renewing = pending;
    return pending;
  };

  const transport: SpaceTransport = {
    kind: 'credential',
    call: (host, path, init) => spaceFetch(current, joinXrpcUrl(host, path), init),
    renew: renew
      ? async () => {
          current = await (renewing ?? startRenew(renew));
          return transport;
        }
      : undefined,
  };
  return transport;
}

/* -------------------------------------------------------------------------- *
 * Errors
 * -------------------------------------------------------------------------- */

/**
 * The machine-readable XRPC `error` string, or null. Branch on this, never on
 * the HTTP status: the same `RepoNotFound` arrives as a 400 from one code path
 * and the same `NotAuthorized` may stand in for either of the two more specific
 * refusals, and neither distinction is visible in the status line.
 */
export function spaceErrorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as SpaceXrpcError).xrpcError;
  return typeof code === 'string' && code ? code : null;
}

function spaceErrorStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const status = (err as SpaceXrpcError).status;
  return typeof status === 'number' ? status : null;
}

/**
 * True for the 403 an authorization server's scope check raises when the
 * session was never granted a covering `space:` scope. It is not an XRPC
 * lexicon error and carries no `error` code of its own, so it is matched on the
 * message the scope checker builds.
 */
export function isScopeMissingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (spaceErrorStatus(err) !== 403) return false;
  return err.message.includes('Missing required scope');
}

/**
 * Credential-staleness codes. Every one of these means "the credential or its
 * proof is no longer acceptable", which a fresh credential fixes; none of them
 * means "you may not read this", which a fresh credential does not.
 */
const CREDENTIAL_STALE_CODES = new Set([
  'JwtExpired',
  'BadDpopProof',
  'DpopProofExpired',
  'DpopKeyMismatch',
  'BadJwtCnf',
]);

export function isCredentialStaleError(err: unknown): boolean {
  const code = spaceErrorCode(err);
  return code !== null && CREDENTIAL_STALE_CODES.has(code);
}

/**
 * A space read failure, reduced to the cases a UI actually distinguishes.
 *
 * Two of these are worth reading twice:
 *
 *   - `repo-not-found` is overloaded by design. A member who has never written
 *     to the space, a member whose repo you may not read, and an account that
 *     is not in the space at all are all this one error. It never means "this
 *     account has no data" and must not be rendered as such.
 *   - `not-authorized` is a policy verdict, never a transient failure. An
 *     authority may collapse `UserNotAuthorized` and `AppNotAuthorized` into a
 *     bare `NotAuthorized` precisely so a caller cannot tell which perimeter it
 *     failed, so `reason` is a hint and never a thing to retry against.
 */
export type SpaceReadFailure =
  | { kind: 'space-not-found' }
  | { kind: 'space-deleted' }
  | { kind: 'repo-not-found' }
  | { kind: 'repo-unavailable'; state: 'takendown' | 'suspended' | 'deactivated' }
  | { kind: 'record-not-found' }
  | { kind: 'not-authorized'; reason: 'user' | 'app' | 'unknown' }
  | { kind: 'invalid-credential' }
  | { kind: 'credential-stale' }
  | { kind: 'scope-missing' }
  | { kind: 'other'; code: string | null };

/**
 * Map a thrown error onto the declared lexicon errors. `RepoSuspended` is
 * declared by every repo-scoped method but is never thrown by the reference
 * implementation; it is handled here defensively and no UI should be built
 * around it specifically.
 */
export function classifySpaceError(err: unknown): SpaceReadFailure {
  if (isScopeMissingError(err)) return { kind: 'scope-missing' };

  switch (spaceErrorCode(err)) {
    case 'SpaceNotFound':
      return { kind: 'space-not-found' };
    case 'SpaceDeleted':
      return { kind: 'space-deleted' };
    case 'RepoNotFound':
      return { kind: 'repo-not-found' };
    case 'RepoTakendown':
      return { kind: 'repo-unavailable', state: 'takendown' };
    case 'RepoSuspended':
      return { kind: 'repo-unavailable', state: 'suspended' };
    case 'RepoDeactivated':
      return { kind: 'repo-unavailable', state: 'deactivated' };
    case 'RecordNotFound':
      return { kind: 'record-not-found' };
    case 'UserNotAuthorized':
      return { kind: 'not-authorized', reason: 'user' };
    case 'AppNotAuthorized':
      return { kind: 'not-authorized', reason: 'app' };
    case 'NotAuthorized':
      return { kind: 'not-authorized', reason: 'unknown' };
    case 'InvalidCredential':
    case 'InvalidDelegationToken':
      return { kind: 'invalid-credential' };
    default:
      break;
  }

  if (isCredentialStaleError(err)) return { kind: 'credential-stale' };
  return { kind: 'other', code: spaceErrorCode(err) };
}

/* -------------------------------------------------------------------------- *
 * Request plumbing
 * -------------------------------------------------------------------------- */

type QueryParams = Record<string, string | number | boolean | undefined>;

/**
 * A space ref carries `:` and `/`, and a record key may carry `:` and `~`, so
 * every parameter goes through URLSearchParams rather than template
 * interpolation. Undefined values are dropped so a method can pass its optional
 * parameters through unconditionally.
 */
function buildQuery(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  return search.toString();
}

async function query<T>(
  t: SpaceTransport,
  host: string,
  nsid: string,
  params: QueryParams,
  retried = false,
): Promise<T> {
  const search = buildQuery(params);
  const path = `/xrpc/${nsid}${search ? `?${search}` : ''}`;
  const res = await t.call(host, path, { headers: { accept: 'application/json' } });

  if (!res.ok) {
    const err = await readSpaceXrpcError(res, res.url || path);
    // Exactly one reactive re-mint, and only for a credential the host has told
    // us is no longer good. Never a loop, and never for a policy verdict.
    if (!retried && t.renew && isCredentialStaleError(err)) {
      const renewed = await t.renew();
      return query<T>(renewed, host, nsid, params, true);
    }
    throw err;
  }

  return (await res.json()) as T;
}

function assertTransport(t: SpaceTransport, kind: SpaceTransport['kind'], nsid: string): void {
  if (t.kind !== kind) {
    throw new Error(`${nsid} requires a ${kind} transport, got ${t.kind}`);
  }
}

/* -------------------------------------------------------------------------- *
 * Methods
 * -------------------------------------------------------------------------- */

/**
 * Caller's OWN PDS only — this reads the caller's local record of which spaces
 * it has written to, so there is no host to address and no credential path.
 *
 * The name understates the narrowness: it lists spaces the account has *written
 * to*, not spaces it belongs to. A member who has never posted does not appear.
 *
 * An unfiltered listing asserts against the wildcard target `type: '*'` and
 * `authority: '*'`, so it needs a grant with both wildcards; a `self`-pinned
 * grant satisfies only a filtered call.
 */
export function listSpaces(
  t: SpaceTransport,
  params: { type?: string; did?: string; limit?: number; cursor?: string } = {},
): Promise<{ cursor?: string; spaces: SpaceView[] }> {
  assertTransport(t, 'oauth', 'com.atproto.space.listSpaces');
  return query(t, '', 'com.atproto.space.listSpaces', {
    type: params.type,
    did: params.did,
    limit: params.limit,
    cursor: params.cursor,
  });
}

/** REPO HOST — the member's own PDS, not the space host. */
export function listSpaceRecords(
  t: SpaceTransport,
  host: string,
  params: {
    space: string;
    repo: string;
    collection?: string;
    limit?: number;
    cursor?: string;
    reverse?: boolean;
    excludeValues?: boolean;
  },
): Promise<{ cursor?: string; records: SpaceRecordRow[] }> {
  return query(t, host, 'com.atproto.space.listRecords', {
    space: params.space,
    repo: params.repo,
    collection: params.collection,
    limit: params.limit,
    cursor: params.cursor,
    reverse: params.reverse,
    excludeValues: params.excludeValues,
  });
}

/** REPO HOST. */
export function getSpaceRecord(
  t: SpaceTransport,
  host: string,
  params: { space: string; repo: string; collection: string; rkey: string },
): Promise<{ uri: string; cid: string; value: Record<string, unknown> }> {
  return query(t, host, 'com.atproto.space.getRecord', {
    space: params.space,
    repo: params.repo,
    collection: params.collection,
    rkey: params.rkey,
  });
}

/**
 * REPO HOST. Throws `RepoNotFound` for a member who has never written to the
 * space — that is the absence of a commit, not the absence of a member.
 */
export function getSpaceLatestCommit(
  t: SpaceTransport,
  host: string,
  params: { space: string; repo: string },
): Promise<{ commit: SpaceSignedCommit }> {
  return query(t, host, 'com.atproto.space.getLatestCommit', {
    space: params.space,
    repo: params.repo,
  });
}

/**
 * SPACE HOST. Credential transport ONLY — there is no OAuth path at all, so
 * this is how any non-authority visitor enumerates a space's members.
 *
 * What it returns is the *writer set*, maintained by the authority from write
 * notifications: the sync boundary, not an access-control list. It enumerates
 * writers, never readers, and the authority's copy may lag each repo's host.
 */
export function listSpaceRepos(
  t: SpaceTransport,
  host: string,
  params: { space: string; limit?: number; cursor?: string },
): Promise<{ cursor?: string; repos: SpaceRepoEntry[] }> {
  assertTransport(t, 'credential', 'com.atproto.space.listRepos');
  return query(t, host, 'com.atproto.space.listRepos', {
    space: params.space,
    limit: params.limit,
    cursor: params.cursor,
  });
}

/**
 * REPO HOST. `commit` present ⟺ the response reached the head of the oplog ⟺
 * `cursor` absent. The oplog is a transport optimization with no history
 * guarantee — a host may compact or drop it — so omitting `since` returns
 * whatever window is retained, not the repo's full history.
 */
export function listSpaceRepoOps(
  t: SpaceTransport,
  host: string,
  params: {
    space: string;
    repo: string;
    since?: string;
    limit?: number;
    cursor?: string;
    excludeValues?: boolean;
  },
): Promise<{ ops: SpaceOpEntry[]; commit?: SpaceSignedCommit; cursor?: string }> {
  return query(t, host, 'com.atproto.space.listRepoOps', {
    space: params.space,
    repo: params.repo,
    since: params.since,
    limit: params.limit,
    cursor: params.cursor,
    excludeValues: params.excludeValues,
  });
}

/**
 * SPACE HOST. Either transport is accepted by the wire, but the OAuth path
 * additionally asserts that the caller *is* the authority, so for anyone else a
 * credential is the only way in.
 */
export function getSimpleSpace(
  t: SpaceTransport,
  host: string,
  params: { space: string },
): Promise<SimpleSpaceConfig> {
  return query(t, host, 'com.atproto.simplespace.getSpace', { space: params.space });
}

/**
 * SPACE HOST. OAuth ONLY, and authority-only: a space credential is explicitly
 * refused because the member list is the authority's own state rather than
 * anything the protocol exposes. Member enumeration for everyone else is
 * {@link listSpaceRepos}.
 */
export function listSimpleSpaceMembers(
  t: SpaceTransport,
  host: string,
  params: { space: string; limit?: number; cursor?: string },
): Promise<{ cursor?: string; members: { did: string }[] }> {
  assertTransport(t, 'oauth', 'com.atproto.simplespace.listMembers');
  return query(t, host, 'com.atproto.simplespace.listMembers', {
    space: params.space,
    limit: params.limit,
    cursor: params.cursor,
  });
}

/* -------------------------------------------------------------------------- *
 * Pagination
 * -------------------------------------------------------------------------- */

/**
 * Walk a paginated space listing to the end.
 *
 * A short page is the primary terminator, and that is not merely belt-and-braces:
 * `listMembers` returns the last member's DID as a cursor even on a short final
 * page, so a cursor-only loop against it never terminates. Every other method
 * drops the cursor on a short page, so the short-page rule is correct for all of
 * them and sufficient for the one that misbehaves.
 *
 * `max` bounds the total pulled so a page can't be walked into a space with a
 * million writers.
 */
export async function collectSpacePages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ cursor?: string; items: T[] }>,
  opts: { limit: number; max?: number },
): Promise<{ items: T[]; complete: boolean }> {
  const { limit, max = 1000 } = opts;
  const items: T[] = [];
  let cursor: string | undefined;

  while (items.length < max) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    if (page.items.length < limit || !page.cursor) {
      return { items, complete: true };
    }
    cursor = page.cursor;
  }

  return { items, complete: false };
}

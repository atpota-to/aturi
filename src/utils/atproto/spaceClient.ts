/**
 * The `com.atproto.space` / `com.atproto.simplespace` methods: the reads, the
 * three record writes, and the five administrative procedures at the bottom of
 * the file.
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

/**
 * The two config unions as a *writer* names them, which is narrower than the
 * reader's shape above.
 *
 * Reading has to survive a `$type` this build has never seen — an authority may
 * run a policy it invented — so {@link SimpleSpaceConfig} keeps `$type` as a
 * bare string. Writing may not: `createSpace` and `updateSpace` declare closed
 * unions, and a host rejects an unlisted variant with `UnsupportedPolicy`
 * rather than storing a rule it cannot enforce. Sending only the variants the
 * lexicon names turns that into a compile error here instead.
 */
export type SimpleSpacePolicyInput =
  | { $type: typeof SIMPLESPACE_POLICY.public }
  | { $type: typeof SIMPLESPACE_POLICY.memberList }
  | { $type: typeof SIMPLESPACE_POLICY.managingApp; managingApp: string };

export type SimpleSpaceAppAccessInput =
  | { $type: typeof SIMPLESPACE_APP_ACCESS.open }
  | { $type: typeof SIMPLESPACE_APP_ACCESS.allowList; allowed: string[] };

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

/**
 * The text to show a person: the host's own `message` where there was one, the
 * error's message otherwise, and null for anything that isn't an Error at all.
 *
 * Never `Error.message` first. That string is built for a console — status,
 * URL, and the first 200 bytes of the body — and putting it in front of a user
 * reads as a crash rather than as the sentence the host actually wrote.
 */
export function spaceErrorMessage(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const message = (err as SpaceXrpcError).xrpcMessage;
  if (typeof message === 'string' && message) return message;
  return err instanceof Error ? err.message : null;
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
 * Writes
 * -------------------------------------------------------------------------- */

/**
 * The write half of the space methods.
 *
 * Three properties separate these from every read above, and all three come
 * from the same fact: a write is attributed to its author.
 *
 * **OAuth only, and no host.** A space credential is an authority-signed
 * capability to *read* a space; it never authorizes a write, and the write
 * methods refuse it. An OAuth token addresses its own audience, which is the
 * caller's PDS, which is where their permissioned repo lives — so unlike the
 * reads there is no host to choose and none is taken.
 *
 * **Own repo only.** `repo` is required and must be the authenticated member.
 * It is still passed rather than inferred because the lexicon requires it, but
 * a DID other than the token's own earns the same answer a foreign read does.
 *
 * **Collection-scoped grant.** Reads are authorized per space; writes are
 * authorized per collection *within* a space. A grant that covers reading
 * everything in a space can still refuse a write to one collection in it. See
 * `spaceWriteActionsFor` in `@/lib/oauth/scopes` for reading that back.
 *
 * The authority is not called here. A member's PDS notifies it after the fact
 * (`notifyWrite`), so nothing on this path waits on the space host, and a
 * write that lands is durable whether or not that notification is.
 */
async function post(
  t: SpaceTransport,
  nsid: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const res = await t.call('', `/xrpc/${nsid}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });

  // No stale-credential retry, unlike `query`: that retry re-mints a space
  // credential, and these methods never carry one. An OAuth token that needs
  // refreshing is the session layer's job and happens under `call`.
  if (!res.ok) throw await readSpaceXrpcError(res, res.url || `/xrpc/${nsid}`);
  return res;
}

async function procedure<T>(
  t: SpaceTransport,
  nsid: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await post(t, nsid, body);

  // `deleteRecord` answers with an empty object, so this is not always useful —
  // but it is always JSON.
  return (await res.json()) as T;
}

/**
 * A procedure whose lexicon declares no output. The server answers 200 with an
 * empty body and no content type, so the response is never read — parsing it
 * as JSON would throw on the success path, which is the failure mode this
 * exists to avoid.
 */
async function procedureVoid(
  t: SpaceTransport,
  nsid: string,
  body: Record<string, unknown>,
): Promise<void> {
  await post(t, nsid, body);
}

export type SpaceWriteResult = {
  uri: string;
  cid: string;
  validationStatus?: 'valid' | 'unknown';
};

/**
 * Create or update one record. `rkey` is required — this is the method the
 * editor saves through, and it is always editing a record that has one.
 *
 * `validate` is left unset deliberately: the PDS then validates against a
 * lexicon when it knows one and accepts the record when it doesn't, which is
 * what an explorer wants. Forcing `true` would reject records whose lexicon
 * this alpha's PDS has never seen; forcing `false` would let a typo through
 * for a lexicon it does know.
 */
export function putSpaceRecord(
  t: SpaceTransport,
  params: {
    space: string;
    repo: string;
    collection: string;
    rkey: string;
    record: Record<string, unknown>;
  },
): Promise<SpaceWriteResult> {
  assertTransport(t, 'oauth', 'com.atproto.space.putRecord');
  return procedure(t, 'com.atproto.space.putRecord', {
    space: params.space,
    repo: params.repo,
    collection: params.collection,
    rkey: params.rkey,
    record: params.record,
  });
}

/**
 * Create one record, letting the PDS assign the key when none is given.
 * Refuses with `RecordAlreadyExists` when a key is given and taken, which is
 * the difference from {@link putSpaceRecord}.
 */
export function createSpaceRecord(
  t: SpaceTransport,
  params: {
    space: string;
    repo: string;
    collection: string;
    rkey?: string;
    record: Record<string, unknown>;
  },
): Promise<SpaceWriteResult> {
  assertTransport(t, 'oauth', 'com.atproto.space.createRecord');
  return procedure(t, 'com.atproto.space.createRecord', {
    space: params.space,
    repo: params.repo,
    collection: params.collection,
    ...(params.rkey ? { rkey: params.rkey } : {}),
    record: params.record,
  });
}

/**
 * Delete one record. Succeeds whether or not it was there, so a double-submit
 * is not an error and the caller needs no existence check first.
 */
export function deleteSpaceRecord(
  t: SpaceTransport,
  params: { space: string; repo: string; collection: string; rkey: string },
): Promise<Record<string, never>> {
  assertTransport(t, 'oauth', 'com.atproto.space.deleteRecord');
  return procedure(t, 'com.atproto.space.deleteRecord', {
    space: params.space,
    repo: params.repo,
    collection: params.collection,
    rkey: params.rkey,
  });
}

/* -------------------------------------------------------------------------- *
 * Space administration
 * -------------------------------------------------------------------------- */

/**
 * The simplespace lifecycle: create a space, change its two rules, delete it,
 * and maintain the member list the member-list policy consults.
 *
 * These differ from every method above in what they are governed by. A read is
 * authorized per space and a record write per collection *within* a space;
 * administration is authorized by a `manage` op on the `space:` scope, which is
 * a separate axis entirely — a grant covering every read and write in a space
 * still cannot create, reconfigure or delete one. See `spaceManageOpsFor` in
 * `@/lib/oauth/scopes` for reading that half of a token back.
 *
 * All five are OAuth-only and take no host. Only the space's own authority may
 * call them, the authority is always an account rather than a service here, and
 * an account's OAuth token addresses its own PDS — which is that authority. A
 * space credential is refused: it is a capability to *read* a space, issued by
 * the very authority these methods reconfigure.
 *
 * Four of the five declare no output and return nothing. Only `createSpace`
 * answers with a body, because only it knows something the caller doesn't: the
 * space key, when the caller let the host generate one.
 */

/**
 * Create a space under the signed-in account, which becomes its authority.
 *
 * There is no `did` parameter and there is no way to ask for one under someone
 * else's authority: the host builds the space ref from the token's own DID.
 *
 * Omitting `skey` has the host mint a TID, which is what the space type's
 * declaration usually recommends. Passing one is for the space types whose key
 * is meaningful — `literal:self`, or a name a companion app expects to find —
 * and collides with `SpaceAlreadyExists` if that (type, key) pair is taken.
 *
 * A space that already has data is not necessarily a space that has a config:
 * writing to an address materializes a permissioned repo without creating a
 * simplespace, and `getSpace` answers `SpaceNotFound` until this is called for
 * it. Creating over such an address adopts it rather than starting a new one.
 */
export function createSimpleSpace(
  t: SpaceTransport,
  params: {
    type: string;
    skey?: string;
    policy: SimpleSpacePolicyInput;
    appAccess: SimpleSpaceAppAccessInput;
  },
): Promise<{ uri: string }> {
  assertTransport(t, 'oauth', 'com.atproto.simplespace.createSpace');
  return procedure(t, 'com.atproto.simplespace.createSpace', {
    type: params.type,
    ...(params.skey ? { skey: params.skey } : {}),
    policy: params.policy,
    appAccess: params.appAccess,
  });
}

/**
 * Replace one or both of a space's rules. An omitted field is left alone; a
 * supplied one replaces that rule wholesale, since both are unions rather than
 * partial objects — there is no way to add a single client to an existing allow
 * list without sending the whole list back.
 */
export function updateSimpleSpace(
  t: SpaceTransport,
  params: {
    space: string;
    policy?: SimpleSpacePolicyInput;
    appAccess?: SimpleSpaceAppAccessInput;
  },
): Promise<void> {
  assertTransport(t, 'oauth', 'com.atproto.simplespace.updateSpace');
  return procedureVoid(t, 'com.atproto.simplespace.updateSpace', {
    space: params.space,
    ...(params.policy ? { policy: params.policy } : {}),
    ...(params.appAccess ? { appAccess: params.appAccess } : {}),
  });
}

/**
 * Delete a space. Idempotent, and not undoable by re-creating: every read and
 * write against the address fails with `SpaceNotFound` afterwards, and a
 * syncer that missed the notification learns from `SpaceDeleted` at its next
 * credential mint.
 *
 * What is destroyed is asymmetric and worth saying out loud in any UI that
 * offers this. The authority's own repo in the space goes with it, because the
 * space host and that repo's host are the same service. Other members' repos
 * live on their own PDSes and are flagged as belonging to a deleted space
 * rather than erased — so this ends the space without erasing what its members
 * wrote.
 */
export function deleteSimpleSpace(
  t: SpaceTransport,
  params: { space: string },
): Promise<void> {
  assertTransport(t, 'oauth', 'com.atproto.simplespace.deleteSpace');
  return procedureVoid(t, 'com.atproto.simplespace.deleteSpace', { space: params.space });
}

/**
 * Add a DID to the space's member list.
 *
 * The member list is host-internal state, consulted when the space's policy is
 * `memberListPolicy` and inert under either of the other two — adding someone
 * to a `publicPolicy` space changes nothing, since everyone already qualifies.
 * It is never synced to the network and never enumerated to anyone but the
 * authority.
 *
 * Nobody is notified. Membership is a permission to mint a credential, not an
 * invitation, and the member's own PDS materializes their repo the first time
 * they write.
 */
export function addSimpleSpaceMember(
  t: SpaceTransport,
  params: { space: string; did: string },
): Promise<void> {
  assertTransport(t, 'oauth', 'com.atproto.simplespace.addMember');
  return procedureVoid(t, 'com.atproto.simplespace.addMember', {
    space: params.space,
    did: params.did,
  });
}

/**
 * Drop a DID from the space's member list.
 *
 * This governs future credential mints and nothing else. A credential already
 * in someone's hands stays valid until it expires, and the records they have
 * written stay in their own repo — removing a member ends their access, it does
 * not retract their data.
 */
export function removeSimpleSpaceMember(
  t: SpaceTransport,
  params: { space: string; did: string },
): Promise<void> {
  assertTransport(t, 'oauth', 'com.atproto.simplespace.removeMember');
  return procedureVoid(t, 'com.atproto.simplespace.removeMember', {
    space: params.space,
    did: params.did,
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

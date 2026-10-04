'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import {
  spaceManageOpsFor,
  spaceWriteActionsFor,
  type SpaceManageOp,
  type SpaceWriteAction,
} from '@/lib/oauth/scopes';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import { parseSpaceAtUri } from '@/utils/atproto/spaceUri';
import { resolveSpaceAuthority, type SpaceAuthority } from '@/utils/atproto/spaceIdentity';
import {
  acquireSpaceCredential,
  snapshotUnlockedAuthorities,
  subscribeSpaceAuthorityUnlocks,
  unlockSpaceAuthority,
  type OwnPdsFetch,
  type SpaceCredential,
} from '@/utils/atproto/spaceCredential';
import {
  classifySpaceError,
  collectSpacePages,
  credentialTransport,
  listSpaceRepos,
  listSpaces,
  oauthTransport,
  spaceErrorCode,
  type SpaceTransport,
} from '@/utils/atproto/spaceClient';

/**
 * Everything a space view needs to know about what the current visitor may
 * read, in one value.
 *
 *   resolving  — the session (or its granted scope) hasn't settled yet
 *   anonymous  — signed out; only Tier 0 (public declaration) can render
 *   no-grant   — signed in, but no `space:` scope survived authorization
 *   self-only  — `read_self`: own permissioned repo, over OAuth, nothing else
 *   locked     — `read`, but this authority hasn't been consented to yet
 *   acquiring  — `read`: minting a space credential
 *   ready      — credential in hand; any member's repo in this space is readable
 *   denied     — the authority refused. A verdict, never retried.
 *   missing    — the space host has never heard of this address
 *   gone       — the space was deleted by its authority
 *   error      — anything else, with the machine-readable code when there was one
 */
export type SpaceAccessState =
  | { status: 'resolving' }
  | { status: 'anonymous' }
  | { status: 'no-grant' }
  | { status: 'self-only'; transport: SpaceTransport; did: string }
  | { status: 'locked'; authority: SpaceAuthority; did: string; unlock: () => void }
  | { status: 'acquiring'; did: string }
  | {
      status: 'ready';
      transport: SpaceTransport;
      credential: SpaceCredential;
      authority: SpaceAuthority;
      did: string;
    }
  | { status: 'denied'; reason: 'user' | 'app' | 'unknown'; message: string }
  | { status: 'missing' }
  | { status: 'gone' }
  | { status: 'error'; message: string; code: string | null };

/**
 * How long a signed-in session is given to report its granted scope before an
 * unreported one is read as "not granted".
 *
 * The session provider reads the scope off the cached token asynchronously and
 * reports `null` both while that read is in flight and when it fails, so the
 * two are indistinguishable from out here. Treating the in-flight window as
 * "no grant" would flash "your sign-in didn't include space access" at every
 * member on every page load; waiting forever would strand a session whose
 * token can't be read at all. The read is a local store lookup with no network
 * hop, so a second is generous in both directions.
 */
const SCOPE_SETTLE_MS = 1000;

const RESOLVING: SpaceAccessState = { status: 'resolving' };
const ANONYMOUS: SpaceAccessState = { status: 'anonymous' };
const NO_GRANT: SpaceAccessState = { status: 'no-grant' };

/**
 * Turn a credential-acquisition failure into the state the UI renders.
 *
 * `denied` and `gone` are terminal by construction: the authority has answered,
 * and asking again with the same account and the same app gets the same answer.
 * Only `error` is worth a reload.
 */
function failureState(err: unknown): SpaceAccessState {
  const failure = classifySpaceError(err);
  switch (failure.kind) {
    case 'not-authorized':
      return {
        status: 'denied',
        reason: failure.reason,
        message: err instanceof Error ? err.message : String(err),
      };
    case 'space-deleted':
      return { status: 'gone' };
    case 'space-not-found':
      // Terminal like the two above: the host answered, and it answered that
      // there is nothing at this address. Retrying a typo gets the same answer.
      return { status: 'missing' };
    case 'scope-missing':
      // The authorization server granted a space scope that doesn't cover this
      // space after all. Same remedy as never having had one: re-authorize.
      return { status: 'no-grant' };
    default:
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
        code: spaceErrorCode(err),
      };
  }
}

/**
 * The visitor's permissioned-data grant, as a settled value.
 *
 * `unknown` is a real state and not a placeholder: there is no pre-flight
 * capability signal in atproto OAuth, so the only way to learn whether a
 * `space:` scope survived authorization is to read it back off the granted
 * token, which happens asynchronously after the session lands.
 */
export type SpaceGrantState = 'unknown' | 'anonymous' | 'none' | 'read_self' | 'read';

export function useSpaceGrant(): SpaceGrantState {
  const { session, spaceGrant, grantedScope, loading } = useAtprotoSession();
  const [scopeSettled, setScopeSettled] = useState(false);

  useEffect(() => {
    setScopeSettled(false);
    if (!session) return undefined;
    const timer = window.setTimeout(() => setScopeSettled(true), SCOPE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [session]);

  if (loading) return 'unknown';
  if (!session) return 'anonymous';
  if (grantedScope === null && !scopeSettled) return 'unknown';
  if (spaceGrant === null) return 'none';
  return spaceGrant;
}

/**
 * Which write actions the visitor's grant authorizes for one collection, or
 * `null` while that can't be answered yet.
 *
 * Split from {@link useSpaceGrant} rather than folded into it because the two
 * answer different questions with different shapes: reading a space is one
 * level per space, writing is a set of verbs per *collection*. A grant can
 * cover reading a whole space and still refuse a write to one collection in
 * it, and vice versa — a `read_self` reader may hold every write verb.
 *
 * `null` versus the empty set is the same distinction the read grant draws
 * between `unknown` and `none`: null means don't decide yet, so a member
 * doesn't watch the edit button appear a beat after the page.
 */
export function useSpaceWriteActions(
  collection: string | null,
): ReadonlySet<SpaceWriteAction> | null {
  const { session, grantedScope, loading } = useAtprotoSession();
  const [scopeSettled, setScopeSettled] = useState(false);

  useEffect(() => {
    setScopeSettled(false);
    if (!session) return undefined;
    const timer = window.setTimeout(() => setScopeSettled(true), SCOPE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [session]);

  return useMemo(() => {
    if (loading || !collection) return null;
    if (!session) return EMPTY_WRITE_ACTIONS;
    if (grantedScope === null && !scopeSettled) return null;
    return spaceWriteActionsFor(grantedScope, collection);
  }, [loading, session, grantedScope, scopeSettled, collection]);
}

const EMPTY_WRITE_ACTIONS: ReadonlySet<SpaceWriteAction> = new Set();

/**
 * Which administrative ops the visitor's grant authorizes, or `null` while that
 * can't be answered yet — the same three-state shape as
 * {@link useSpaceWriteActions}, and null for the same reason.
 *
 * Unlike write actions this takes no argument. Administration is authorized per
 * space and not per collection, and every method behind it is refused for
 * anyone but the space's own authority, so the answer is the same for every
 * space on a page. Whether the visitor *is* that authority is a separate
 * question the caller already knows the answer to.
 */
export function useSpaceManageOps(): ReadonlySet<SpaceManageOp> | null {
  const { session, grantedScope, loading } = useAtprotoSession();
  const [scopeSettled, setScopeSettled] = useState(false);

  useEffect(() => {
    setScopeSettled(false);
    if (!session) return undefined;
    const timer = window.setTimeout(() => setScopeSettled(true), SCOPE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [session]);

  return useMemo(() => {
    if (loading) return null;
    if (!session) return EMPTY_MANAGE_OPS;
    if (grantedScope === null && !scopeSettled) return null;
    return spaceManageOpsFor(grantedScope);
  }, [loading, session, grantedScope, scopeSettled]);
}

const EMPTY_MANAGE_OPS: ReadonlySet<SpaceManageOp> = new Set();

/**
 * Resolve a handle / DID to `{ did, handle, pds }`, in the shape every explore
 * view already uses: null identity while in flight, a message on failure.
 * Space pages need it twice over — once for the authority in the address, and
 * again for the member whose own PDS is the repo host.
 */
export function useResolvedIdentity(input: string): {
  identity: IdentityBundle | null;
  error: string | null;
} {
  const [identity, setIdentity] = useState<IdentityBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIdentity(null);
    setError(null);
    resolveIdentifier(input)
      .then((resolved) => {
        if (!cancelled) setIdentity(resolved);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [input]);

  return { identity, error };
}

/**
 * Whether the visitor already holds a repo in some space under this authority.
 *
 * Reads only the visitor's own PDS — `listSpaces` takes an authority filter and
 * answers from what that PDS recorded about its own account — so the check
 * itself discloses nothing to the authority. One matching space is enough, so
 * it asks for one.
 *
 * A false answer is the safe answer: any failure reads as "not known", which
 * means the visitor gets the prompt rather than a silent mint.
 */
async function holdsRepoUnderAuthority(
  ownPdsFetch: OwnPdsFetch,
  authorityDid: string,
): Promise<boolean> {
  try {
    const page = await listSpaces(oauthTransport({ fetchHandler: ownPdsFetch }), {
      did: authorityDid,
      limit: 1,
    });
    return page.spaces.length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolve what the signed-in visitor may read in `space` (a canonical space
 * ref from `formatSpaceRef`), minting a space credential when the grant allows
 * one. Pass `null` while the ref isn't known yet.
 */
export function useSpaceAccess(space: string | null): SpaceAccessState {
  const { session } = useAtprotoSession();
  const grant = useSpaceGrant();
  const [credentialState, setCredentialState] = useState<SpaceAccessState | null>(null);
  // Which authorities the visitor has agreed to hand a delegation token to,
  // mirrored out of the credential module so unlocking one re-runs the effect
  // below instead of needing a reload.
  const [unlockedAuthorities, setUnlockedAuthorities] = useState<ReadonlySet<string>>(
    snapshotUnlockedAuthorities,
  );
  useEffect(
    () => subscribeSpaceAuthorityUnlocks(() => setUnlockedAuthorities(snapshotUnlockedAuthorities())),
    [],
  );

  // `session.fetchHandler` is the one capability the credential layer needs: a
  // fetch against the user's own PDS carrying the OAuth token. Bound here so
  // the effect below doesn't re-run on every render.
  const ownPdsFetch = useMemo<OwnPdsFetch | null>(
    () => (session ? (path, init) => session.fetchHandler(path, init) : null),
    [session],
  );

  useEffect(() => {
    let cancelled = false;
    setCredentialState(null);
    if (!space || !session || !ownPdsFetch) return undefined;
    // read_self needs no credential at all, and every other grant level has
    // nothing to mint one with.
    if (grant !== 'read') return undefined;

    const parts = parseSpaceAtUri(space);
    if (!parts) {
      setCredentialState({
        status: 'error',
        message: `"${space}" is not a valid space address.`,
        code: null,
      });
      return undefined;
    }

    const signedInDid = session.sub;
    setCredentialState({ status: 'acquiring', did: signedInDid });

    (async () => {
      const authority = await resolveSpaceAuthority(parts.authority);
      if (cancelled) return;
      if (!authority) {
        setCredentialState({
          status: 'error',
          message: `Couldn't resolve a space host for ${parts.authority}.`,
          code: null,
        });
        return;
      }
      // Minting is the first thing that leaves the browser on this visitor's
      // behalf, and where it goes is named by the address. See the note on the
      // unlock store in spaceCredential.ts for what that risks.
      //
      // The prompt is for *first contact* with an authority, though, not for
      // every authority. A prompt that fires on spaces you already belong to
      // is one you learn to click through, which is precisely the habit the
      // crafted-link case relies on. So an authority you already have a
      // relationship with is cleared without asking, on either of two grounds
      // that can both be checked against your own PDS alone:
      //
      //   - it is your own DID, so the token would go to your own host
      //   - you already hold a repo in one of its spaces, meaning you have
      //     written there and it already knows your DID — the disclosure the
      //     prompt exists to prevent has already happened, by your own hand
      //
      // `listSpaces` answers the second with its `did` filter, reading only
      // your own PDS. An authority that fails both still prompts.
      if (!unlockedAuthorities.has(authority.did)) {
        const known =
          authority.did === signedInDid ||
          (await holdsRepoUnderAuthority(ownPdsFetch, authority.did));
        if (cancelled) return;
        if (!known) {
          setCredentialState({
            status: 'locked',
            authority,
            did: signedInDid,
            unlock: () => unlockSpaceAuthority(authority.did),
          });
          return;
        }
        // Recorded so the rest of the session skips the check, and so the
        // effect re-runs once and falls through to the mint below.
        unlockSpaceAuthority(authority.did);
        return;
      }
      // Handed to the transport so one stale-credential response mid-page
      // re-mints and retries instead of surfacing as a read failure.
      const renew = () =>
        acquireSpaceCredential(ownPdsFetch, space, authority, { forceRefresh: true });
      try {
        const credential = await acquireSpaceCredential(ownPdsFetch, space, authority);
        if (cancelled) return;
        setCredentialState({
          status: 'ready',
          transport: credentialTransport(credential, renew),
          credential,
          authority,
          did: signedInDid,
        });
      } catch (err) {
        if (cancelled) return;
        setCredentialState(failureState(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [space, session, ownPdsFetch, grant, unlockedAuthorities]);

  return useMemo<SpaceAccessState>(() => {
    if (grant === 'anonymous') return ANONYMOUS;
    // `!session` is unreachable once the grant has settled to anything else,
    // but it is what narrows the type for the two branches below.
    if (grant === 'unknown' || !session) return RESOLVING;
    if (grant === 'none') return NO_GRANT;
    if (grant === 'read_self') {
      return { status: 'self-only', transport: oauthTransport(session), did: session.sub };
    }
    return credentialState ?? { status: 'acquiring', did: session.sub };
  }, [grant, session, credentialState]);
}

/**
 * A transport aimed at the signed-in user's own PDS. `listSpaces` and
 * `listMembers` have no credential path at all, so they need this even when a
 * credential is in hand. Null when signed out.
 */
export function useOwnPdsTransport(): SpaceTransport | null {
  const { session } = useAtprotoSession();
  return useMemo(() => (session ? oauthTransport(session) : null), [session]);
}

/**
 * Which transport may read `repoDid`'s permissioned repo without asking the
 * space anything first, or null when that question has to be asked.
 *
 * Two cases qualify. A whole-space OAuth grant is deliberately *not* one of
 * them: the repo host compares the OAuth token's DID against the requested repo
 * first and answers `RepoNotFound` when they differ, so a `read_self` transport
 * only ever addresses its own owner. And a credential aimed at its holder's own
 * repo goes to their own PDS, which already holds their OAuth token — nothing
 * reaches a third party.
 *
 * Every other repo is a DID out of the address bar, resolving to a host of
 * whoever wrote the link. See {@link useSpaceRepoAccess}.
 */
function directTransportForRepo(
  access: SpaceAccessState,
  repoDid: string,
): SpaceTransport | null {
  if (access.status === 'self-only' && access.did === repoDid) return access.transport;
  if (access.status === 'ready' && access.did === repoDid) return access.transport;
  return null;
}

/** Writer-set page size, and how far the vouching walk will go before giving up. */
const REPOS_PER_PAGE = 100;
const MAX_VOUCHED_REPOS = 2000;

/**
 * Whether, and with what, `repoDid`'s repo in this space may be read.
 *
 *   none      — no transport at all; the access panel explains why
 *   checking  — confirming the space vouches for this DID
 *   unlisted  — the space host doesn't list this DID as having written here
 *   error     — the writer set couldn't be read
 *   ready     — go ahead
 */
export type SpaceRepoAccess =
  | { status: 'none'; transport: null }
  | { status: 'checking'; transport: null }
  | { status: 'unlisted'; transport: null }
  | { status: 'error'; transport: null; error: unknown }
  | { status: 'ready'; transport: SpaceTransport };

/**
 * A member DID in a space URL is attacker-supplied like every other segment,
 * and the repo host it resolves to comes from *that DID's* document. Aiming a
 * credential transport at it on sight would present an authority-signed
 * whole-space capability, plus a live DPoP proof naming that host, to a server
 * the authority never vouched for — an exfiltration that needs no click beyond
 * opening the link.
 *
 * So the space is asked first. `listSpaceRepos` is the space host's own writer
 * set, is already credential-gated, and answers exactly the right question: is
 * this DID one the space itself knows about? A DID that isn't in it has nothing
 * readable anyway — a member who has never written has no commit and no
 * records — so refusing costs the visitor nothing real.
 *
 * The walk is bounded. An unlisted DID in a space too large to enumerate is
 * refused rather than trusted, because the whole point is not to address a host
 * on an unverified DID's say-so.
 */
export function useSpaceRepoAccess(
  access: SpaceAccessState,
  space: string,
  repoDid: string,
): SpaceRepoAccess {
  const direct = directTransportForRepo(access, repoDid);
  const credential = access.status === 'ready' ? access.transport : null;
  const spaceHost = access.status === 'ready' ? access.authority.spaceHost : null;

  const [vouched, setVouched] = useState<SpaceRepoAccess>({ status: 'checking', transport: null });

  useEffect(() => {
    let cancelled = false;
    setVouched({ status: 'checking', transport: null });
    if (!credential || !spaceHost) return undefined;

    collectSpacePages<string>(
      async (cursor) => {
        const page = await listSpaceRepos(credential, spaceHost, {
          space,
          limit: REPOS_PER_PAGE,
          cursor,
        });
        return { cursor: page.cursor, items: page.repos.map((entry) => entry.did) };
      },
      { limit: REPOS_PER_PAGE, max: MAX_VOUCHED_REPOS },
    )
      .then((result) => {
        if (cancelled) return;
        setVouched(
          result.items.includes(repoDid)
            ? { status: 'ready', transport: credential }
            : { status: 'unlisted', transport: null },
        );
      })
      .catch((err) => {
        if (!cancelled) setVouched({ status: 'error', transport: null, error: err });
      });

    return () => {
      cancelled = true;
    };
  }, [credential, spaceHost, space, repoDid]);

  if (direct) return { status: 'ready', transport: direct };
  if (!credential) return { status: 'none', transport: null };
  return vouched;
}

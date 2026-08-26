'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import NotFoundPanel from '@/components/NotFoundPanel';
import { encodeRepo, shortDid, spaceExplorePath } from '@/utils/atproto/urls';
import { parseSpaceAtUri } from '@/utils/atproto/spaceUri';
import { collectSpacePages, listSpaces } from '@/utils/atproto/spaceClient';
import { resolveDidHandle, type IdentityBundle } from '@/utils/atproto/identity';
import AppearIn from '../AppearIn';
import Breadcrumb from '../Breadcrumb';
import SkeletonSwap from '../skeletons/SkeletonSwap';
import { SpaceListSkeleton } from '../skeletons/pages';
import { SkeletonRowList } from '../skeletons/primitives';
import { CHROME_RESULTS_ID, useChromeBarField } from '../ChromeBarContext';
import { formatCount } from '../collectionListHelpers';
import CreateSpaceButton from './CreateSpaceButton';
import SpaceAccessPanel from './SpaceAccessPanel';
import SpaceGlance from './SpaceGlance';
import { SpaceTreeList, useSpaceTree } from './SpaceTree';
import {
  useOwnPdsTransport,
  useResolvedIdentity,
  useSpaceGrant,
  useSpaceManageOps,
} from './useSpaceAccess';

/** `listSpaces`' page size. Walked to the end, so this is a round-trip count. */
const SPACES_PER_PAGE = 100;

/**
 * L1 — `/explore/{authority}/space`.
 *
 * An account's own spaces, and nothing else: stats over them, then the tree.
 * None of it is public and none of it is general — `listSpaces` reads the
 * caller's *own* PDS and nothing else — so the whole page has something to
 * show only when the visitor is signed in as the account in the address.
 */
export default function SpaceListExplorer({ repo }: { repo: string }) {
  const { identity, error } = useResolvedIdentity(repo);

  if (error) {
    return (
      <NotFoundPanel
        eyebrow="Couldn't resolve"
        headline="That handle didn't resolve."
        body={`We tried to resolve "${repo}" and the AT Protocol resolver returned: ${error}. Try another handle, DID, or AT URI below.`}
        initialQuery={repo}
      />
    );
  }

  return (
    <SkeletonSwap loading={!identity} skeleton={<SpaceListSkeleton />}>
      {identity && <SpaceListView identity={identity} />}
    </SkeletonSwap>
  );
}

/**
 * The page proper. Split from the resolver above so the skeleton and the loaded
 * page are two states of one <SkeletonSwap> rather than two returns that cut
 * between each other.
 */
function SpaceListView({ identity }: { identity: IdentityBundle }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <AppearIn rise>
        <Breadcrumb
          handle={identity.handle}
          did={identity.did}
          pds={identity.pds}
          spaceRoot
          shareUrl={`/explore/${encodeRepo(identity.handle || identity.did)}/space`}
        />
      </AppearIn>
      {/* No authority card here. This page is the account's own spaces, and
          what it can say about the authority — that it is this same account,
          and which host answers for it — is fixed for every space on the page
          and is not why anyone opened it. It still runs at the foot of a
          space's own page, where it describes that particular space. */}
      <OwnSpacesPanel identity={identity} />
    </div>
  );
}

/** Spaces listed on the dedicated page. Higher than the repo page's, since
 *  this page exists for exactly this. */
const OWN_SPACES_LIMIT = 50;

/**
 * The dedicated spaces page's main content: the same shape as a repo page —
 * stats, then the things you can click into — but over permissioned data.
 *
 * Like everything that reads a permissioned repo, it only works for the
 * account itself: `listSpaces` reads the caller's own PDS and takes no subject
 * parameter. The states below say which of the reasons applies rather than
 * rendering an empty page.
 */
function OwnSpacesPanel({ identity }: { identity: IdentityBundle }) {
  const { did: signedInDid } = useAtprotoSession();
  const grant = useSpaceGrant();
  const transport = useOwnPdsTransport();
  const manageOps = useSpaceManageOps();

  const isSelf = Boolean(signedInDid && signedInDid === identity.did);
  const canList = isSelf && (grant === 'read' || grant === 'read_self');
  // A space is always anchored on the caller's own DID, so this belongs on the
  // account's own page and nowhere else. It is offered independently of
  // `canList`: the create grant carries `read_self`, so someone who granted
  // only management can still make a space and be taken to it — the listing
  // above just stays empty until the read they didn't grant is granted.
  const canCreate = isSelf && transport !== null && Boolean(manageOps?.has('create'));
  const tree = useSpaceTree({ enabled: canList, limit: OWN_SPACES_LIMIT });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontSize: '1rem',
            color: 'var(--text-primary)',
          }}
        >
          Spaces this account has written to
        </h2>
        {canCreate && transport && (
          <span style={{ marginLeft: 'auto' }}>
            <CreateSpaceButton
              transport={transport}
              authority={identity.handle || identity.did}
            />
          </span>
        )}
      </div>

      {grant === 'anonymous' && (
        <SpaceAccessPanel
          state={{ status: 'anonymous' }}
          what="the spaces this account writes to"
          defaultAccount={identity.handle || identity.did}
        />
      )}
      {grant !== 'anonymous' && !isSelf && grant !== 'unknown' && (
        <p style={noteStyle}>
          Only the account itself can list this. A PDS keeps the record of which
          spaces it has written to for its own account and no one else’s, so
          there is no way to ask it about somebody else, not even with a
          whole-space credential.
          {signedInDid && (
            <>
              {' '}
              <Link href={`/explore/${encodeRepo(signedInDid)}/space`} className="explore-json-link">
                See your own spaces
              </Link>
              .
            </>
          )}
        </p>
      )}

      {isSelf && grant === 'unknown' && (
        <p className="explore-placeholder">Checking your access…</p>
      )}
      {isSelf && grant === 'none' && <SpaceAccessPanel state={{ status: 'no-grant' }} />}

      {canList && (
        <>
          {tree.error && <p className="explore-error">{tree.error}</p>}
          {!tree.error && tree.loading && tree.uris.length === 0 && (
            <SkeletonRowList rows={4} trailingWidth="5rem" />
          )}
          {!tree.error && !tree.loading && tree.uris.length === 0 && (
            <p className="explore-placeholder">
              This account hasn’t written to any spaces yet.
            </p>
          )}
          {tree.uris.length > 0 && (
            <>
              <SpaceGlance tree={tree} myDid={signedInDid ?? ''} />
              <SpaceTreeList tree={tree} memberDid={signedInDid ?? ''} />
            </>
          )}
          {tree.more && (
            <p style={noteStyle}>
              Showing the first {OWN_SPACES_LIMIT} spaces; the listing was cut
              off before the end.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The "spaces this account has written to" listing, shared by L1 and by the
 * type-filtered view at L2.
 *
 * The label is deliberate and the method's name is not: `listSpaces` returns
 * the spaces the account has *written to*, which is what its own PDS happens
 * to know. A member who has been invited but never posted does not appear, so
 * calling this "spaces you belong to" would be a lie in a predictable case.
 */
export function SpaceWrittenList({
  authorityDid,
  accountLabel,
  type,
}: {
  authorityDid: string;
  /** Handle or DID to prefill a sign-in form with. */
  accountLabel: string;
  /** Space type NSID to narrow to. Omit for every space. */
  type?: string;
}) {
  const { did: signedInDid } = useAtprotoSession();
  const grant = useSpaceGrant();
  const transport = useOwnPdsTransport();

  const [uris, setUris] = useState<string[]>([]);
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  // `listSpaces` has no `did` semantics that would let it read someone else's
  // PDS, so there is nothing to fetch unless the visitor *is* the account in
  // the address. Any space grant carries it: `read_self` is enough.
  const isSelf = Boolean(signedInDid && signedInDid === authorityDid);
  const canList = isSelf && transport !== null && (grant === 'read' || grant === 'read_self');

  useEffect(() => {
    let cancelled = false;
    setUris([]);
    setComplete(false);
    setError(null);
    if (!canList || !transport) return undefined;

    setLoading(true);
    collectSpacePages(
      async (cursor) => {
        const page = await listSpaces(transport, { type, limit: SPACES_PER_PAGE, cursor });
        return { cursor: page.cursor, items: page.spaces.map((space) => space.uri) };
      },
      { limit: SPACES_PER_PAGE },
    )
      .then((result) => {
        if (cancelled) return;
        setUris(result.items);
        setComplete(result.complete);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canList, transport, type]);

  const query = filter.trim().toLowerCase();
  const visible = useMemo(
    () => (query ? uris.filter((uri) => uri.toLowerCase().includes(query)) : uris),
    [uris, query],
  );

  useChromeBarField({
    placeholder: 'Filter spaces…',
    label: 'Filter the spaces in this list',
    value: filter,
    onChange: setFilter,
    resultsId: CHROME_RESULTS_ID,
    status: uris.length === 0 ? null : `${formatCount(visible.length)}/${formatCount(uris.length)}`,
  });

  return (
    <AppearIn delay={0.1} id={CHROME_RESULTS_ID}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontSize: '1rem',
            color: 'var(--text-primary)',
          }}
        >
          Spaces this account has written to
        </h2>

        {grant === 'anonymous' && (
          <SpaceAccessPanel
            state={{ status: 'anonymous' }}
            what="the spaces this account writes to"
            defaultAccount={accountLabel}
          />
        )}
        {grant !== 'anonymous' && !isSelf && grant !== 'unknown' && (
          <p style={noteStyle}>
            Only the account itself can list this. A PDS keeps the record of
            which spaces it has written to for its own account and no one
            else’s, so there is no way to ask it about somebody else, not even
            with a whole-space credential.
            {signedInDid && (
              <>
                {' '}
                <Link href={`/explore/${encodeRepo(signedInDid)}/space`} className="explore-json-link">
                  See your own spaces
                </Link>
                .
              </>
            )}
          </p>
        )}

        {isSelf && grant === 'unknown' && (
          <p className="explore-placeholder">Checking your access…</p>
        )}
        {isSelf && grant === 'none' && <SpaceAccessPanel state={{ status: 'no-grant' }} />}

        {canList && (
          <>
            {error && <p className="explore-error">{error}</p>}
            {!error && loading && uris.length === 0 && (
              <SkeletonRowList rows={4} trailingWidth="5rem" />
            )}
            {!error && !loading && uris.length === 0 && (
              <p className="explore-placeholder">
                {type
                  ? 'No spaces of this type have been written to from this account.'
                  : 'This account hasn’t written to any spaces yet.'}
              </p>
            )}
            {uris.length > 0 && visible.length === 0 && (
              <p className="explore-placeholder">
                No spaces match <code>{filter.trim()}</code>.
              </p>
            )}
            {visible.length > 0 && <SpaceRows uris={visible} selfDid={signedInDid} />}
            {!complete && uris.length > 0 && (
              <p style={noteStyle}>
                Showing the first {formatCount(uris.length)} spaces; the listing
                was cut off before the end.
              </p>
            )}
          </>
        )}
      </section>
    </AppearIn>
  );
}

/**
 * Authority handles for a list of space URIs, resolved once per distinct DID.
 *
 * Keyed off a joined string rather than a parsed array so the effect has one
 * primitive dependency: callers hand us a fresh array on most renders, and a
 * memo over that array would be re-created just as often.
 */
function useAuthorityHandles(uris: string[]): Map<string, string> {
  const [handles, setHandles] = useState<Map<string, string>>(new Map());
  const uriKey = uris.join('\n');

  useEffect(() => {
    const dids = new Set<string>();
    for (const uri of uriKey ? uriKey.split('\n') : []) {
      const parts = parseSpaceAtUri(uri);
      if (parts) dids.add(parts.authority);
    }
    if (dids.size === 0) return undefined;

    let cancelled = false;
    Promise.all(
      [...dids].map(async (did) => [did, await resolveDidHandle(did)] as const),
    ).then((pairs) => {
      if (cancelled) return;
      const next = new Map<string, string>();
      for (const [did, handle] of pairs) if (handle) next.set(did, handle);
      setHandles(next);
    });

    return () => {
      cancelled = true;
    };
  }, [uriKey]);

  return handles;
}

/**
 * A `spaceView` is a URI and nothing else — no name, no member count, no
 * timestamp — so every column here is parsed back out of the address itself.
 * A URI this app cannot parse still gets a row, as text: it is a real space
 * that simply has no page here, and hiding it would be worse than showing it.
 *
 * The authority is a column and not a detail. `listSpaces` returns every space
 * the account writes to, which spans spaces anchored on other people's DIDs —
 * so type and key alone collide constantly (everyone's bulletin board is
 * `my.bulletin.board/self`), and rows for genuinely different spaces would
 * otherwise be indistinguishable.
 */
export function SpaceRows({ uris, selfDid }: { uris: string[]; selfDid?: string | null }) {
  const handles = useAuthorityHandles(uris);
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
      }}
    >
      {uris.map((uri) => {
        const parts = parseSpaceAtUri(uri);
        return (
          <li key={uri} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {parts ? (
              <Link href={spaceExplorePath(parts)} style={spaceRowStyle}>
                <code style={{ background: 'transparent', padding: 0, color: 'var(--text-primary)' }}>
                  {parts.spaceType}
                </code>
                <span style={{ color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>
                  {parts.skey}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    display: 'inline-flex',
                    alignItems: 'baseline',
                    gap: '0.5rem',
                    color: 'var(--text-tertiary)',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {/* Falls back to the DID until the handle resolves, and stays
                      on the DID if it never does — an authority with no
                      bidirectionally valid handle is still a real authority. */}
                  {handles.get(parts.authority)
                    ? `@${handles.get(parts.authority)}`
                    : shortDid(parts.authority)}
                  {selfDid === parts.authority && (
                    <span
                      style={{
                        fontSize: '0.7rem',
                        padding: '0.05rem 0.35rem',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      yours
                    </span>
                  )}
                </span>
              </Link>
            ) : (
              <div style={{ ...spaceRowStyle, color: 'var(--text-tertiary)' }}>
                <code style={{ background: 'transparent', padding: 0 }}>{uri}</code>
                <span>unrecognised address</span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export const spaceRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '0.75rem',
  padding: '0.625rem 1rem',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.85rem',
  color: 'var(--text-primary)',
  textDecoration: 'none',
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-tertiary)',
  maxWidth: '46rem',
};

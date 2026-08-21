'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import NotFoundPanel from '@/components/NotFoundPanel';
import { encodeRepo, shortDid } from '@/utils/atproto/urls';
import { formatSpaceRef, isValidNsid, isValidRecordKey } from '@/utils/atproto/spaceUri';
import { resolveDidHandle, type IdentityBundle } from '@/utils/atproto/identity';
import { resolveSpaceAuthority, type SpaceAuthority } from '@/utils/atproto/spaceIdentity';
import {
  collectSpacePages,
  getSimpleSpace,
  listSimpleSpaceMembers,
  listSpaceRepos,
  SIMPLESPACE_APP_ACCESS,
  SIMPLESPACE_POLICY,
  type SimpleSpaceConfig,
  type SpaceTransport,
} from '@/utils/atproto/spaceClient';
import AppearIn from '../AppearIn';
import Breadcrumb from '../Breadcrumb';
import CopyButton from '../CopyButton';
import { CHROME_RESULTS_ID, useChromeBarField } from '../ChromeBarContext';
import { formatCount } from '../collectionListHelpers';
import SpaceAccessPanel, { SpaceReadErrorPanel } from './SpaceAccessPanel';
import SpaceAuthorityCard from './SpaceAuthorityCard';
import SpaceTypeCard from './SpaceTypeCard';
import YourSpaceRecordsSection from './YourSpaceRecordsSection';
import {
  useOwnPdsTransport,
  useResolvedIdentity,
  useSpaceAccess,
  type SpaceAccessState,
} from './useSpaceAccess';

const MEMBERS_PER_PAGE = 100;

/**
 * L3 — `/explore/{authority}/space/{spaceType}/{skey}` — the space itself.
 *
 * Everything above the fold is Tier 0 and renders for anyone: the address, the
 * authority's DID document, the type declaration. Everything below it needs a
 * space credential, and which of the two member-enumeration methods is even
 * available depends on who is asking — see MembersSection.
 */
export default function SpaceExplorer({
  repo,
  spaceType,
  skey,
}: {
  repo: string;
  spaceType: string;
  skey: string;
}) {
  const { identity, error } = useResolvedIdentity(repo);

  if (!isValidNsid(spaceType) || !isValidRecordKey(skey)) {
    return (
      <NotFoundPanel
        eyebrow="Not a space address"
        headline="That isn't a space address."
        body={`A space is addressed as at://{did}/space/{type}/{key}, where the type is a lexicon NSID and the key is a record key. "${spaceType}/${skey}" isn't one.`}
        initialQuery={spaceType}
      />
    );
  }
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
  if (!identity) {
    return (
      <p className="explore-placeholder">
        Resolving <code>{repo}</code>…
      </p>
    );
  }

  return <SpaceView identity={identity} spaceType={spaceType} skey={skey} />;
}

function SpaceView({
  identity,
  spaceType,
  skey,
}: {
  identity: IdentityBundle;
  spaceType: string;
  skey: string;
}) {
  const { did: signedInDid } = useAtprotoSession();
  // The canonical spelling, built through formatSpaceRef rather than
  // concatenated: a space credential's `sub` is compared against this string
  // byte for byte, so a stray slash or a re-encoded key is a hard failure.
  const space = useMemo(
    () => formatSpaceRef({ authority: identity.did, spaceType, skey }),
    [identity.did, spaceType, skey],
  );
  const access = useSpaceAccess(space);
  const ownTransport = useOwnPdsTransport();
  const isAuthority = Boolean(signedInDid && signedInDid === identity.did);

  const [authority, setAuthority] = useState<SpaceAuthority | null>(null);
  useEffect(() => {
    let cancelled = false;
    setAuthority(null);
    resolveSpaceAuthority(identity.did).then((resolved) => {
      if (!cancelled) setAuthority(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [identity.did]);

  const repoSeg = encodeRepo(identity.handle || identity.did);
  const spacePath = `/explore/${repoSeg}/space/${spaceType}/${encodeURIComponent(skey)}`;

  // Every access state that got as far as identifying the visitor carries
  // their DID; the rest (anonymous, no-grant, resolving, the terminal
  // failures) have no repo of their own to show and the section is skipped.
  const viewerDid = 'did' in access ? access.did : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <AppearIn rise>
        <Breadcrumb
          handle={identity.handle}
          did={identity.did}
          pds={identity.pds}
          spaceRoot
          spaceType={spaceType}
          skey={skey}
          shareUrl={spacePath}
        />
      </AppearIn>

      <AppearIn delay={0.04}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            border: '1px solid var(--border-medium)',
            background: 'var(--bg-secondary)',
          }}
        >
          <code
            style={{
              background: 'transparent',
              padding: 0,
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              overflowWrap: 'anywhere',
              minWidth: 0,
            }}
          >
            {space}
          </code>
          <span style={{ marginLeft: 'auto' }}>
            <CopyButton value={space} label="Space address" compact variant="subtle" />
          </span>
        </div>
      </AppearIn>

      {/* What you can click into comes first — the same order the public
          explorer uses, where a repo page opens on its collections and the
          descriptive material sits underneath. */}
      {viewerDid && (
        <AppearIn delay={0.08}>
          <YourSpaceRecordsSection
            space={space}
            spacePath={spacePath}
            myDid={viewerDid}
          />
        </AppearIn>
      )}

      <MembersSection
        space={space}
        spaceHost={authority?.spaceHost ?? null}
        access={access}
        isAuthority={isAuthority}
        ownTransport={ownTransport}
        spacePath={spacePath}
      />

      {access.status !== 'ready' && access.status !== 'self-only' && (
        <AppearIn delay={0.24}>
          <SpaceAccessPanel state={access} what="this space" />
        </AppearIn>
      )}
      {/* The "open your own records" link this block used to carry is now the
          section above, which shows the collections instead of pointing at
          them. What's left is the part that still needs saying: the rest of
          the space is out of reach. */}
      {access.status === 'self-only' && (
        <AppearIn delay={0.24}>
          <SpaceAccessPanel state={access} what="other members’ records" />
        </AppearIn>
      )}

      {/* Reference material, grouped and last. Everything here describes the
          space rather than offering a way into it. */}
      <AppearIn delay={0.28}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h2 style={sectionHeadingStyle}>About this space</h2>
          <SpaceAuthorityCard did={identity.did} handle={identity.handle} />
          <SpaceTypeCard nsid={spaceType} />
          <ConfigSection
            space={space}
            spaceHost={authority?.spaceHost ?? null}
            access={access}
            isAuthority={isAuthority}
            ownTransport={ownTransport}
          />
        </div>
      </AppearIn>
    </div>
  );
}

/**
 * The space's own configuration, when the visitor can see it.
 *
 * `getSpace` is a simplespace method: an authority running some other space
 * implementation answers it with an error, which is not a failure of the page.
 * The section says as much rather than presenting a missing config as a broken
 * space.
 */
function ConfigSection({
  space,
  spaceHost,
  access,
  isAuthority,
  ownTransport,
}: {
  space: string;
  spaceHost: string | null;
  access: SpaceAccessState;
  isAuthority: boolean;
  ownTransport: SpaceTransport | null;
}) {
  const [config, setConfig] = useState<SimpleSpaceConfig | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  // The OAuth path exists but asserts the caller *is* the authority, so it is
  // only worth trying for them; everyone else needs the credential.
  const transport =
    access.status === 'ready'
      ? access.transport
      : isAuthority && ownTransport
        ? ownTransport
        : null;

  useEffect(() => {
    let cancelled = false;
    setConfig(null);
    setError(null);
    if (!transport || !spaceHost) return undefined;
    setLoading(true);
    getSimpleSpace(transport, spaceHost, { space })
      .then((result) => {
        if (!cancelled) setConfig(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [transport, spaceHost, space]);

  if (!transport) return null;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <h2 style={sectionHeadingStyle}>Space configuration</h2>
      {loading && <p className="explore-placeholder">Reading the space configuration…</p>}
      {!loading && error != null && (
        <p style={noteStyle}>
          This space host didn’t return a <code>com.atproto.simplespace</code>{' '}
          configuration. Spaces are not required to be simplespaces; the
          authority may run a different implementation with its own rules.
        </p>
      )}
      {config && (
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
            gap: '1rem',
            margin: 0,
            padding: '1rem',
            border: '1px solid var(--border-medium)',
            background: 'var(--bg-secondary)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <dt className="explore-small-caps" style={{ marginBottom: '0.25rem' }}>
              membership policy
            </dt>
            <dd style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {describePolicy(config.policy)}
            </dd>
          </div>
          <div style={{ minWidth: 0 }}>
            <dt className="explore-small-caps" style={{ marginBottom: '0.25rem' }}>
              application access
            </dt>
            <dd style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {describeAppAccess(config.appAccess)}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

/**
 * An unrecognised `$type` is an implementation this build doesn't know, and the
 * safe reading of an unknown rule is "unknown" — never the permissive one.
 */
function describePolicy(policy: SimpleSpaceConfig['policy']): string {
  switch (policy?.$type) {
    case SIMPLESPACE_POLICY.public:
      return 'Public: any account may join and write.';
    case SIMPLESPACE_POLICY.memberList:
      return 'Member list: the authority keeps an explicit list of who belongs.';
    case SIMPLESPACE_POLICY.managingApp:
      return policy.managingApp
        ? `Managed by an application (${policy.managingApp}), which decides membership.`
        : 'Managed by an application, which decides membership.';
    default:
      return `Unknown policy${policy?.$type ? ` (${policy.$type})` : ''}. This build doesn’t recognise it and makes no assumption about what it allows.`;
  }
}

function describeAppAccess(appAccess: SimpleSpaceConfig['appAccess']): string {
  switch (appAccess?.$type) {
    case SIMPLESPACE_APP_ACCESS.open:
      return 'Open: any application a member authorizes may read the space.';
    case SIMPLESPACE_APP_ACCESS.allowList:
      return `Allow list: only named applications may read${
        appAccess.allowed?.length ? ` (${appAccess.allowed.length} listed)` : ''
      }. A public client like aturi.to can never be one of them.`;
    default:
      return `Unknown application-access rule${appAccess?.$type ? ` (${appAccess.$type})` : ''}. This build doesn’t recognise it and makes no assumption about what it allows.`;
  }
}

type MemberRowData = { did: string; rev?: string };

/**
 * Who is in the space, by whichever of the two methods the visitor can reach.
 *
 * They are not interchangeable and neither is a general-purpose member list:
 *
 *   - `listMembers` is the authority's own membership state. It takes OAuth and
 *     refuses a space credential outright, and the wire additionally requires
 *     the caller to *be* the authority. Nobody else can call it, ever.
 *   - `listRepos` is the space host's writer set, reachable only with a
 *     credential. It enumerates accounts that have written, so a member who has
 *     never posted is missing from it.
 *
 * So the authority sees membership and everyone else sees writers, and the
 * section says which of the two it is showing.
 */
function MembersSection({
  space,
  spaceHost,
  access,
  isAuthority,
  ownTransport,
  spacePath,
}: {
  space: string;
  spaceHost: string | null;
  access: SpaceAccessState;
  isAuthority: boolean;
  ownTransport: SpaceTransport | null;
  spacePath: string;
}) {
  const [rows, setRows] = useState<MemberRowData[]>([]);
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState('');

  const useAuthorityList = isAuthority && ownTransport !== null;
  const credentialTransportForSpace = access.status === 'ready' ? access.transport : null;

  useEffect(() => {
    let cancelled = false;
    setRows([]);
    setComplete(false);
    setError(null);
    if (!spaceHost) return undefined;
    const transport = useAuthorityList ? ownTransport : credentialTransportForSpace;
    if (!transport) return undefined;

    setLoading(true);
    collectSpacePages<MemberRowData>(
      async (cursor) => {
        if (useAuthorityList) {
          const page = await listSimpleSpaceMembers(transport, spaceHost, {
            space,
            limit: MEMBERS_PER_PAGE,
            cursor,
          });
          return { cursor: page.cursor, items: page.members.map((m) => ({ did: m.did })) };
        }
        const page = await listSpaceRepos(transport, spaceHost, {
          space,
          limit: MEMBERS_PER_PAGE,
          cursor,
        });
        return {
          cursor: page.cursor,
          items: page.repos.map((entry) => ({ did: entry.did, rev: entry.rev })),
        };
      },
      { limit: MEMBERS_PER_PAGE },
    )
      .then((result) => {
        if (cancelled) return;
        setRows(result.items);
        setComplete(result.complete);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [space, spaceHost, useAuthorityList, ownTransport, credentialTransportForSpace]);

  const query = filter.trim().toLowerCase();
  const visible = useMemo(
    () => (query ? rows.filter((row) => row.did.toLowerCase().includes(query)) : rows),
    [rows, query],
  );

  useChromeBarField({
    placeholder: 'Filter members…',
    label: 'Filter the members of this space',
    value: filter,
    onChange: setFilter,
    resultsId: CHROME_RESULTS_ID,
    status: rows.length === 0 ? null : `${formatCount(visible.length)}/${formatCount(rows.length)}`,
  });

  const active = Boolean(spaceHost) && (useAuthorityList || credentialTransportForSpace !== null);

  return (
    <AppearIn delay={0.2} id={CHROME_RESULTS_ID}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h2 style={sectionHeadingStyle}>{useAuthorityList ? 'Members' : 'Repositories in this space'}</h2>
        <p style={noteStyle}>
          {useAuthorityList
            ? 'The authority’s own membership list. Only the authority can read it; a space credential is refused, whoever holds it.'
            : 'Accounts that have written to this space, as the space host tracks them. This is the sync boundary, not an access list: a member who has never written doesn’t appear here.'}
        </p>

        {!active && !error && (
          <p className="explore-placeholder">
            {access.status === 'acquiring' || access.status === 'resolving'
              ? 'Waiting on a space credential…'
              : access.status === 'locked'
                ? 'Unlock this space to read who is in it.'
                : 'Not readable without whole-space access.'}
          </p>
        )}

        {active && error != null && <SpaceReadErrorPanel err={error} what="this space" />}
        {active && error == null && (
          <>
            {loading && rows.length === 0 && <p className="explore-placeholder">Loading members…</p>}
            {!loading && rows.length === 0 && (
              <p className="explore-placeholder">
                {useAuthorityList
                  ? 'No members yet.'
                  : 'Nobody has written to this space yet.'}
              </p>
            )}
            {rows.length > 0 && visible.length === 0 && (
              <p className="explore-placeholder">
                No members match <code>{filter.trim()}</code>.
              </p>
            )}
            {visible.length > 0 && (
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  border: '1px solid var(--border-medium)',
                  background: 'var(--bg-secondary)',
                }}
              >
                {visible.map((row) => (
                  <MemberRow key={row.did} row={row} spacePath={spacePath} />
                ))}
              </ul>
            )}
            {!complete && rows.length > 0 && (
              <p style={noteStyle}>
                Showing the first {formatCount(rows.length)}; the listing was cut
                off before the end.
              </p>
            )}
          </>
        )}
      </section>
    </AppearIn>
  );
}

function MemberRow({ row, spacePath }: { row: MemberRowData; spacePath: string }) {
  const [handle, setHandle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHandle(null);
    resolveDidHandle(row.did).then((resolved) => {
      if (!cancelled) setHandle(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [row.did]);

  return (
    <li style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <Link
        href={`${spacePath}/${encodeRepo(row.did)}`}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: '0.75rem',
          padding: '0.625rem 1rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          color: 'var(--text-primary)',
          textDecoration: 'none',
        }}
      >
        <span>{handle ? `@${handle}` : shortDid(row.did)}</span>
        {handle && <span style={{ color: 'var(--text-tertiary)' }}>{shortDid(row.did)}</span>}
        {row.rev && (
          <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
            rev {row.rev}
          </span>
        )}
      </Link>
    </li>
  );
}

const sectionHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-serif)',
  fontWeight: 400,
  fontSize: '1rem',
  color: 'var(--text-primary)',
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-tertiary)',
  maxWidth: '46rem',
};

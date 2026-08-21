'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import NotFoundPanel from '@/components/NotFoundPanel';
import { encodeRepo, spaceExplorePath } from '@/utils/atproto/urls';
import { parseSpaceAtUri } from '@/utils/atproto/spaceUri';
import { collectSpacePages, listSpaces } from '@/utils/atproto/spaceClient';
import AppearIn from '../AppearIn';
import Breadcrumb from '../Breadcrumb';
import { CHROME_RESULTS_ID, useChromeBarField } from '../ChromeBarContext';
import { formatCount } from '../collectionListHelpers';
import SpaceAccessPanel from './SpaceAccessPanel';
import SpaceAuthorityCard from './SpaceAuthorityCard';
import { useOwnPdsTransport, useResolvedIdentity, useSpaceGrant } from './useSpaceAccess';

/** `listSpaces`' page size. Walked to the end, so this is a round-trip count. */
const SPACES_PER_PAGE = 100;

/**
 * L1 — `/explore/{authority}/space`.
 *
 * The public half is the authority card: who this account is and where its
 * space host lives, all from the DID document. The listing underneath is not
 * public and not general — `listSpaces` reads the caller's *own* PDS and
 * nothing else — so it only appears when the visitor is signed in as the
 * account in the address.
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
  if (!identity) {
    return (
      <p className="explore-placeholder">
        Resolving <code>{repo}</code>…
      </p>
    );
  }

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
      <AppearIn delay={0.05}>
        <SpaceAuthorityCard did={identity.did} handle={identity.handle} />
      </AppearIn>
      <SpaceWrittenList
        authorityDid={identity.did}
        accountLabel={identity.handle || identity.did}
      />
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
            else’s, so there is no way to ask it about somebody else — not even
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
              <p className="explore-placeholder">Loading spaces…</p>
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
            {visible.length > 0 && <SpaceRows uris={visible} />}
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
 * A `spaceView` is a URI and nothing else — no name, no member count, no
 * timestamp — so every column here is parsed back out of the address itself.
 * A URI this app cannot parse still gets a row, as text: it is a real space
 * that simply has no page here, and hiding it would be worse than showing it.
 */
export function SpaceRows({ uris }: { uris: string[] }) {
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

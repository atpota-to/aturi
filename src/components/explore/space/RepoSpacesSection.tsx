'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { encodeRepo } from '@/utils/atproto/urls';
import { listSpaces } from '@/utils/atproto/spaceClient';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { SpaceRows } from './SpaceListExplorer';
import { useOwnPdsTransport, useSpaceGrant } from './useSpaceAccess';

/**
 * The permissioned-data footer of the repo page, below everything public.
 *
 * It renders only when you are signed in as the account in the address, and
 * that is a protocol limit rather than a product choice: `listSpaces` reads
 * the caller's own PDS and takes no subject parameter, so there is no request
 * that asks a server which spaces somebody *else* writes to. A whole-space
 * credential doesn't help either — it answers for one space you already know
 * the address of. So on anyone else's repo there is nothing to fetch, and a
 * permanent "you can't see this" panel on every profile would be noise.
 *
 * Deliberately not part of the configurable section list above: the sections
 * in `repoSections` are all views of public repo data, and permissioned data
 * is a different kind of thing that belongs after the public material rather
 * than shuffled in among it.
 */

/**
 * Rows shown inline. The full listing lives at `/explore/{repo}/space`, which
 * has the filter field and the paging; this is a doorway, not a copy of it.
 * One extra is fetched so "more" can be detected without a second request.
 */
const INLINE_LIMIT = 8;

export default function RepoSpacesSection({ identity }: { identity: IdentityBundle }) {
  const { did: signedInDid } = useAtprotoSession();
  const grant = useSpaceGrant();
  const transport = useOwnPdsTransport();

  const [uris, setUris] = useState<string[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSelf = Boolean(signedInDid && signedInDid === identity.did);
  // Any space grant carries listSpaces; the PDS treats it as a `read_self`
  // request, which a `read` grant also satisfies.
  const canList = isSelf && transport !== null && (grant === 'read' || grant === 'read_self');

  useEffect(() => {
    let cancelled = false;
    setUris([]);
    setMore(false);
    setError(null);
    if (!canList || !transport) return undefined;

    setLoading(true);
    listSpaces(transport, { limit: INLINE_LIMIT + 1 })
      .then((page) => {
        if (cancelled) return;
        const found = page.spaces.map((space) => space.uri);
        setUris(found.slice(0, INLINE_LIMIT));
        setMore(found.length > INLINE_LIMIT || Boolean(page.cursor));
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
  }, [canList, transport]);

  // Nothing to offer a visitor who isn't this account — see the note above.
  // `unknown` is the pre-settle state of the grant check, not a signed-out
  // one, so it stays rendered to avoid the section popping in late.
  if (!isSelf) return null;

  const repoSegment = encodeRepo(identity.handle || identity.did);

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        borderTop: '1px solid var(--border-medium)',
        paddingTop: '1.25rem',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.75rem' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontSize: '1rem',
            color: 'var(--text-primary)',
          }}
        >
          Permissioned spaces
        </h2>
        <Link href={`/explore/${repoSegment}/space`} className="explore-json-link">
          Open spaces explorer →
        </Link>
      </div>

      <p style={noteStyle}>
        Records you keep outside your public repo. Only you can see this list —
        a PDS tracks which spaces its own account has written to and won’t
        answer that question about anyone else.
      </p>

      {grant === 'unknown' && <p className="explore-placeholder">Checking your access…</p>}

      {grant === 'none' && (
        <p style={noteStyle}>
          Your session has no space permission, so there’s nothing to read.
          Sign in again and tick a permissioned-data row to grant one.
        </p>
      )}

      {canList && (
        <>
          {error && <p className="explore-error">{error}</p>}
          {!error && loading && uris.length === 0 && (
            <p className="explore-placeholder">Loading spaces…</p>
          )}
          {!error && !loading && uris.length === 0 && (
            <p className="explore-placeholder">
              You haven’t written to any spaces yet. Anything you write in a
              space app will show up here.
            </p>
          )}
          {uris.length > 0 && <SpaceRows uris={uris} />}
          {more && (
            <p style={noteStyle}>
              Showing the first {INLINE_LIMIT}.{' '}
              <Link href={`/explore/${repoSegment}/space`} className="explore-json-link">
                See all of them
              </Link>
              .
            </p>
          )}
        </>
      )}
    </section>
  );
}

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-tertiary)',
  maxWidth: '46rem',
};

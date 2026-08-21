'use client';

import Link from 'next/link';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { encodeRepo } from '@/utils/atproto/urls';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { SpaceTreeList, useSpaceTree } from './SpaceTree';
import { SkeletonRowList } from '../skeletons/primitives';
import { useSpaceGrant } from './useSpaceAccess';

/**
 * Your permissioned data on the repo page, below everything public.
 *
 * It renders only for the account itself, and that is a protocol limit rather
 * than a product choice: `listSpaces` reads the caller's own PDS and takes no
 * subject parameter, so no request exists that asks which spaces somebody else
 * writes to. On anyone else's repo there is nothing to fetch, so the section
 * disappears rather than explaining itself on every profile.
 *
 * Deliberately not part of the configurable section list above: those sections
 * are all views of public repo data, and permissioned data belongs after the
 * public material rather than shuffled in among it.
 */

/**
 * Spaces listed inline. Tighter than the dedicated page's, because every row
 * costs a request at page load — this caps what the repo page spends on a
 * section that isn't why most visitors came.
 */
const SPACE_LIMIT = 12;

export default function RepoSpacesSection({ identity }: { identity: IdentityBundle }) {
  const { did: signedInDid } = useAtprotoSession();
  const grant = useSpaceGrant();

  const isSelf = Boolean(signedInDid && signedInDid === identity.did);
  // Any space grant carries listSpaces; the PDS treats it as a `read_self`
  // request, which a `read` grant also satisfies.
  const canList = isSelf && (grant === 'read' || grant === 'read_self');
  const tree = useSpaceTree({ enabled: canList, limit: SPACE_LIMIT });

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
        Records you keep outside your public repo. Only you can see this list
        when logged in.
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
          {tree.error && <p className="explore-error">{tree.error}</p>}
          {!tree.error && tree.loading && tree.uris.length === 0 && (
            <SkeletonRowList rows={3} trailingWidth="5rem" />
          )}
          {!tree.error && !tree.loading && tree.uris.length === 0 && (
            <p className="explore-placeholder">
              You haven’t written to any spaces yet. Anything you write in a
              space app will show up here.
            </p>
          )}

          {tree.uris.length > 0 && (
            <SpaceTreeList tree={tree} memberDid={signedInDid ?? ''} />
          )}

          {tree.more && (
            <p style={noteStyle}>
              Showing the first {SPACE_LIMIT}.{' '}
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

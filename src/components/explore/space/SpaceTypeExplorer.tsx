'use client';

import NotFoundPanel from '@/components/NotFoundPanel';
import { encodeRepo } from '@/utils/atproto/urls';
import { isValidNsid } from '@/utils/atproto/spaceUri';
import AppearIn from '../AppearIn';
import Breadcrumb from '../Breadcrumb';
import { SpaceWrittenList } from './SpaceListExplorer';
import SpaceTypeCard from './SpaceTypeCard';
import { useResolvedIdentity } from './useSpaceAccess';

/**
 * L2 — `/explore/{authority}/space/{spaceType}`.
 *
 * The space type declaration is the whole of the public surface of a space, so
 * this level renders in full for a signed-out visitor: what the type is called,
 * what key shape it expects, and which collections its members write. The
 * listing below it is the same own-PDS-only view as L1, narrowed to this type.
 */
export default function SpaceTypeExplorer({
  repo,
  spaceType,
}: {
  repo: string;
  spaceType: string;
}) {
  const { identity, error } = useResolvedIdentity(repo);

  // A space type is always a full NSID. Anything else can't name a declaration
  // and can't appear in a space ref, so it is a dead address rather than an
  // empty page.
  if (!isValidNsid(spaceType)) {
    return (
      <NotFoundPanel
        eyebrow="Not a space type"
        headline="That isn't a space type."
        body={`A space type is a lexicon NSID like "com.example.forum". "${spaceType}" isn't one, so there is no space it could name.`}
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

  const repoSeg = encodeRepo(identity.handle || identity.did);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <AppearIn rise>
        <Breadcrumb
          handle={identity.handle}
          did={identity.did}
          pds={identity.pds}
          spaceRoot
          spaceType={spaceType}
          shareUrl={`/explore/${repoSeg}/space/${spaceType}`}
        />
      </AppearIn>
      <AppearIn delay={0.05}>
        <SpaceTypeCard nsid={spaceType} />
      </AppearIn>
      <SpaceWrittenList
        authorityDid={identity.did}
        accountLabel={identity.handle || identity.did}
        type={spaceType}
      />
    </div>
  );
}

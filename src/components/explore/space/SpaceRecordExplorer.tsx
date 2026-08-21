'use client';

import { useEffect, useMemo, useState } from 'react';
import NotFoundPanel from '@/components/NotFoundPanel';
import { encodeRepo, shortDid } from '@/utils/atproto/urls';
import {
  formatSpaceAtUri,
  formatSpaceRef,
  isValidDid,
  isValidNsid,
  isValidRecordKey,
} from '@/utils/atproto/spaceUri';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { getSpaceRecord } from '@/utils/atproto/spaceClient';
import AppearIn from '../AppearIn';
import Breadcrumb from '../Breadcrumb';
import CopyButton from '../CopyButton';
import LinkifiedJson from '../LinkifiedJson';
import { SpaceReadErrorPanel, SpaceRepoAccessPanel } from './SpaceAccessPanel';
import { useResolvedIdentity, useSpaceAccess, useSpaceRepoAccess } from './useSpaceAccess';

type SpaceRecord = { uri: string; cid: string; value: Record<string, unknown> };

/**
 * L6 — one permissioned record.
 *
 * Read-only on purpose: writing into a space needs the write half of the space
 * scopes and a signing path this app doesn't have, so there is no edit
 * affordance here and offering a disabled one would only be confusing.
 */
export default function SpaceRecordExplorer({
  repo,
  spaceType,
  skey,
  author,
  collection,
  rkey,
}: {
  repo: string;
  spaceType: string;
  skey: string;
  author: string;
  collection: string;
  rkey: string;
}) {
  const { identity, error } = useResolvedIdentity(repo);
  const { identity: authorIdentity, error: authorError } = useResolvedIdentity(author);

  if (
    !isValidNsid(spaceType) ||
    !isValidRecordKey(skey) ||
    !isValidDid(author) ||
    !isValidNsid(collection) ||
    !isValidRecordKey(rkey)
  ) {
    return (
      <NotFoundPanel
        eyebrow="Not a space address"
        headline="That isn't a space address."
        body="A permissioned record is addressed as at://{authority}/space/{type}/{key}/{did}/{collection}/{rkey}. One of those parts isn't valid here, so there is no record it could name."
        initialQuery={rkey}
      />
    );
  }
  if (error || authorError) {
    const failed = error ? repo : author;
    return (
      <NotFoundPanel
        eyebrow="Couldn't resolve"
        headline="That identifier didn't resolve."
        body={`We tried to resolve "${failed}" and the AT Protocol resolver returned: ${error || authorError}. Try another handle, DID, or AT URI below.`}
        initialQuery={failed}
      />
    );
  }
  if (!identity || !authorIdentity) {
    return <p className="explore-placeholder">Resolving identities…</p>;
  }

  return (
    <SpaceRecordView
      identity={identity}
      authorIdentity={authorIdentity}
      spaceType={spaceType}
      skey={skey}
      collection={collection}
      rkey={rkey}
    />
  );
}

function SpaceRecordView({
  identity,
  authorIdentity,
  spaceType,
  skey,
  collection,
  rkey,
}: {
  identity: IdentityBundle;
  authorIdentity: IdentityBundle;
  spaceType: string;
  skey: string;
  collection: string;
  rkey: string;
}) {
  const space = useMemo(
    () => formatSpaceRef({ authority: identity.did, spaceType, skey }),
    [identity.did, spaceType, skey],
  );
  const access = useSpaceAccess(space);
  // Never `access.transport` directly: the member DID came out of the URL,
  // and so does the host it resolves to. See useSpaceRepoAccess.
  const repoAccess = useSpaceRepoAccess(access, space, authorIdentity.did);
  const transport = repoAccess.transport;
  const repoHost = authorIdentity.pds;

  const [record, setRecord] = useState<SpaceRecord | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    setError(null);
    if (!transport) return undefined;
    getSpaceRecord(transport, repoHost, {
      space,
      repo: authorIdentity.did,
      collection,
      rkey,
    })
      .then((result) => {
        if (!cancelled) setRecord(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [transport, repoHost, space, authorIdentity.did, collection, rkey]);

  // The full permissioned address, built through the formatter so it matches
  // what a space-aware client would produce byte for byte.
  const atUri = formatSpaceAtUri({
    authority: identity.did,
    spaceType,
    skey,
    author: authorIdentity.did,
    collection,
    rkey,
  });
  const repoSeg = encodeRepo(identity.handle || identity.did);
  const recordPath = `/explore/${repoSeg}/space/${spaceType}/${encodeURIComponent(skey)}/${encodeRepo(authorIdentity.did)}/${collection}/${encodeURIComponent(rkey)}`;
  const memberLabel = authorIdentity.handle ? `@${authorIdentity.handle}` : shortDid(authorIdentity.did);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <AppearIn rise>
        <Breadcrumb
          handle={identity.handle}
          did={identity.did}
          pds={identity.pds}
          spaceRoot
          spaceType={spaceType}
          skey={skey}
          author={authorIdentity.did}
          collection={collection}
          rkey={rkey}
          shareUrl={recordPath}
        />
      </AppearIn>

      {!transport && (
        <AppearIn delay={0.05}>
          <SpaceRepoAccessPanel access={access} repo={repoAccess} what={`this record in ${memberLabel}’s repository`} />
        </AppearIn>
      )}

      {transport && error != null && (
        <AppearIn delay={0.05}>
          <SpaceReadErrorPanel err={error} what="this record" />
        </AppearIn>
      )}

      {transport && error == null && !record && (
        <p className="explore-placeholder">Loading record…</p>
      )}

      {record && (
        <AppearIn delay={0.05}>
          {/* LinkifiedJson tokenises the seven-segment space address the same
              way it tokenises a public one, and the explorer's AT URI mapper
              already routes those tokens back into this tree — so a record
              that references another permissioned record links straight to it,
              with no special casing here. */}
          <LinkifiedJson value={record} className="explore-json" />
        </AppearIn>
      )}

      <AppearIn delay={0.09}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1rem',
            border: '1px solid var(--border-medium)',
            background: 'var(--bg-secondary)',
          }}
        >
          <CopyButton value={atUri} label="AT URI" compact variant="subtle" />
          <CopyButton value={space} label="Space address" compact variant="subtle" />
          <CopyButton value={authorIdentity.did} label="Member DID" compact variant="subtle" />
          {record && (
            <CopyButton
              value={JSON.stringify(record, null, 2)}
              label="JSON"
              compact
              variant="subtle"
            />
          )}
        </div>
      </AppearIn>
    </div>
  );
}

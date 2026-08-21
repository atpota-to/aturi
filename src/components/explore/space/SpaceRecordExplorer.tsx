'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FilePenLine } from 'lucide-react';
import NotFoundPanel from '@/components/NotFoundPanel';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
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
import SkeletonSwap from '../skeletons/SkeletonSwap';
import { SpaceRecordBodySkeleton, SpaceRecordSkeleton } from '../skeletons/pages';
import CopyButton from '../CopyButton';
import LinkifiedJson from '../LinkifiedJson';
import RecordEditor from '../RecordEditor';
import { spaceRecordBackend } from '../recordBackend';
import SpaceRecordFields from './SpaceRecordFields';
import { SpaceReadErrorPanel, SpaceRepoAccessPanel } from './SpaceAccessPanel';
import {
  useOwnPdsTransport,
  useResolvedIdentity,
  useSpaceAccess,
  useSpaceRepoAccess,
  useSpaceWriteActions,
} from './useSpaceAccess';

type SpaceRecord = { uri: string; cid: string; value: Record<string, unknown> };

/**
 * L6 — one permissioned record.
 *
 * Editable on the same terms as a public record, and only then: the space
 * write methods take an OAuth token and nothing else, so what you can edit
 * here is your own records and nothing else, however much of the space you can
 * read. A visitor holding a whole-space credential reads every member's
 * records through it and still gets no edit button on any of them.
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

  return (
    <SkeletonSwap
      loading={!identity || !authorIdentity}
      skeleton={<SpaceRecordSkeleton />}
    >
      {identity && authorIdentity && (
        <SpaceRecordView
          identity={identity}
          authorIdentity={authorIdentity}
          spaceType={spaceType}
          skey={skey}
          collection={collection}
          rkey={rkey}
        />
      )}
    </SkeletonSwap>
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
  const [showRaw, setShowRaw] = useState(false);
  const [editing, setEditing] = useState(false);

  const router = useRouter();
  const { did: signedInDid } = useAtprotoSession();
  // Writes are OAuth-only, so this is deliberately not `repoAccess.transport`:
  // that one may be a space credential, which authorizes reading a space and
  // never authorizes a write.
  const ownTransport = useOwnPdsTransport();
  const writeActions = useSpaceWriteActions(collection);

  const isOwnRecord = Boolean(signedInDid && signedInDid === authorIdentity.did);
  const canEdit = Boolean(isOwnRecord && ownTransport && writeActions?.has('update'));
  const canDelete = Boolean(writeActions?.has('delete'));

  // Memoised because <RecordEditor> keys its read effect on the backend's
  // identity: a fresh object each render would re-read the record forever.
  const backend = useMemo(
    () =>
      ownTransport
        ? spaceRecordBackend(ownTransport, space, authorIdentity.did, repoHost)
        : null,
    [ownTransport, space, authorIdentity.did, repoHost],
  );

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
  const collectionPath = `/explore/${repoSeg}/space/${spaceType}/${encodeURIComponent(skey)}/${encodeRepo(authorIdentity.did)}/${collection}`;
  const recordPath = `${collectionPath}/${encodeURIComponent(rkey)}`;
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
          authorHandle={authorIdentity.handle}
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

      {transport && error == null && !record && !editing && <SpaceRecordBodySkeleton />}

      {editing && canEdit && backend && (
        <AppearIn delay={0.05}>
          <RecordEditor
            backend={backend}
            collection={collection}
            rkey={rkey}
            canDelete={canDelete}
            onSaved={(next) => {
              setRecord((prev) => (prev ? { ...prev, value: next } : prev));
            }}
            onDeleted={() => {
              setEditing(false);
              router.push(collectionPath);
            }}
            onCancel={() => setEditing(false)}
          />
        </AppearIn>
      )}

      {record && !editing && (
        <AppearIn delay={0.05}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {showRaw ? (
              /* LinkifiedJson tokenises the seven-segment space address the
                 same way it tokenises a public one, and the explorer's AT URI
                 mapper already routes those tokens back into this tree — so a
                 record that references another permissioned record links
                 straight to it, with no special casing here. */
              <LinkifiedJson value={record} className="explore-json" />
            ) : (
              <SpaceRecordFields value={record.value} />
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                style={{
                  alignSelf: 'flex-start',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.4rem 0.75rem',
                  background: 'var(--accent-moss)',
                  color: 'var(--text-on-accent)',
                  border: '1px solid var(--accent-moss)',
                  fontFamily: 'var(--font-serif)',
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                }}
              >
                <FilePenLine size={12} aria-hidden /> Edit record
              </button>
            )}
            {/* Your own record, and the grant covers reading it but not
                writing it. Said once, here, rather than left as an edit button
                that isn't there — the reason is a box that wasn't ticked at
                sign-in, which is not something to work out from an absence. */}
            {isOwnRecord && writeActions !== null && !canEdit && (
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                Editing your permissioned records needs a sign-in that asked for
                it. Sign in again and tick “Edit your permissioned records”.
              </p>
            )}
            {/* Session-only, unlike the public record page's equivalent: that
                one persists a per-view preference, and those preference keys
                describe the public record sections. Not worth widening the
                stored schema for one toggle. */}
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              style={{
                alignSelf: 'flex-start',
                padding: 0,
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
                fontFamily: 'var(--font-serif)',
                fontSize: '0.75rem',
                letterSpacing: '0.04em',
                color: 'var(--text-tertiary)',
                transition: 'color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-tertiary)';
              }}
            >
              {showRaw ? 'Show fields' : 'Show raw JSON'}
            </button>
          </div>
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

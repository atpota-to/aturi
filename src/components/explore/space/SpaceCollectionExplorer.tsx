'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Loader2, Plus, User } from 'lucide-react';
import NotFoundPanel from '@/components/NotFoundPanel';
import { encodeRepo, shortDid } from '@/utils/atproto/urls';
import { formatSpaceRef, isValidDid, isValidNsid, isValidRecordKey } from '@/utils/atproto/spaceUri';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { previewFor } from '@/utils/atproto/previewExtractors';
import { listSpaceRecords, type SpaceRecordRow } from '@/utils/atproto/spaceClient';
import AppearIn from '../AppearIn';
import Breadcrumb from '../Breadcrumb';
import SkeletonSwap from '../skeletons/SkeletonSwap';
import { SpaceCollectionSkeleton } from '../skeletons/pages';
import { SkeletonRecordRows } from '../skeletons/primitives';
import { CHROME_RESULTS_ID, useChromeBarField } from '../ChromeBarContext';
import { formatCount } from '../collectionListHelpers';
import { SpaceReadErrorPanel, SpaceRepoAccessPanel } from './SpaceAccessPanel';
import SpaceTitleBar from './SpaceTitleBar';
import { useResolvedIdentity, useSpaceAccess, useSpaceRepoAccess } from './useSpaceAccess';

const RECORDS_PER_PAGE = 100;

/**
 * L5 — one collection inside one member's permissioned repository.
 */
export default function SpaceCollectionExplorer({
  repo,
  spaceType,
  skey,
  author,
  collection,
}: {
  repo: string;
  spaceType: string;
  skey: string;
  author: string;
  collection: string;
}) {
  const { identity, error } = useResolvedIdentity(repo);
  const { identity: authorIdentity, error: authorError } = useResolvedIdentity(author);

  if (
    !isValidNsid(spaceType) ||
    !isValidRecordKey(skey) ||
    !isValidDid(author) ||
    !isValidNsid(collection)
  ) {
    return (
      <NotFoundPanel
        eyebrow="Not a space address"
        headline="That isn’t a space address."
        body="A permissioned record is addressed as at://{authority}/space/{type}/{key}/{did}/{collection}/{rkey}, with a lexicon NSID for both the type and the collection and a DID for the member. One of those parts isn’t valid here."
        initialQuery={collection}
      />
    );
  }
  if (error || authorError) {
    const failed = error ? repo : author;
    return (
      <NotFoundPanel
        eyebrow="Couldn’t resolve"
        headline="That identifier didn’t resolve."
        body={`We couldn’t find an account for “${failed}”. Check the spelling, or try a DID or an at:// URI below.`}
        details={error || authorError}
        initialQuery={failed}
      />
    );
  }

  return (
    <SkeletonSwap
      loading={!identity || !authorIdentity}
      skeleton={<SpaceCollectionSkeleton />}
    >
      {identity && authorIdentity && (
        <SpaceCollectionList
          identity={identity}
          authorIdentity={authorIdentity}
          spaceType={spaceType}
          skey={skey}
          collection={collection}
        />
      )}
    </SkeletonSwap>
  );
}

function SpaceCollectionList({
  identity,
  authorIdentity,
  spaceType,
  skey,
  collection,
}: {
  identity: IdentityBundle;
  authorIdentity: IdentityBundle;
  spaceType: string;
  skey: string;
  collection: string;
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

  const [records, setRecords] = useState<SpaceRecordRow[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState('');
  // The wire default walks record keys downwards, newest-looking first for a
  // TID-keyed collection. The toggle asks the host to walk the other way rather
  // than reversing what has already been fetched, so paging stays coherent.
  const [ascending, setAscending] = useState(false);

  const loadPage = useCallback(
    async (after: string | undefined) => {
      if (!transport) return;
      setLoading(true);
      setError(null);
      try {
        const page = await listSpaceRecords(transport, repoHost, {
          space,
          repo: authorIdentity.did,
          collection,
          limit: RECORDS_PER_PAGE,
          cursor: after || undefined,
          reverse: ascending || undefined,
        });
        const batch = page.records || [];
        setRecords((prev) => (after ? [...prev, ...batch] : batch));
        setCursor(page.cursor);
        // A short page means the host has nothing more, whatever the cursor
        // says — the same rule the public collection listing uses.
        if (!page.cursor || batch.length < RECORDS_PER_PAGE) setDone(true);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [transport, repoHost, space, authorIdentity.did, collection, ascending],
  );

  useEffect(() => {
    setRecords([]);
    setCursor(undefined);
    setDone(false);
    setFilter('');
    setError(null);
    void loadPage(undefined);
  }, [loadPage]);

  // rkey plus the whole record body, so a search finds records by what they
  // say and not only by their key. Only over what has been fetched — there is
  // no server-side query on this method.
  const haystacks = useMemo(
    () =>
      records.map((record) => {
        let body = '';
        try {
          body = JSON.stringify(record.value) ?? '';
        } catch {
          // An unserializable value would otherwise take the whole list down.
        }
        return `${record.rkey}\n${body}`.toLowerCase();
      }),
    [records],
  );

  const query = filter.trim().toLowerCase();
  const visible = useMemo(
    () => (query ? records.filter((_, i) => haystacks[i].includes(query)) : records),
    [records, haystacks, query],
  );

  useChromeBarField({
    placeholder: 'Search records…',
    label: 'Search records in this collection',
    value: filter,
    onChange: setFilter,
    resultsId: CHROME_RESULTS_ID,
    status:
      records.length === 0
        ? null
        : query
          ? `${formatCount(visible.length)}/${formatCount(records.length)}`
          : `${formatCount(records.length)}${done ? '' : '+'}`,
  });

  const repoSeg = encodeRepo(identity.handle || identity.did);
  const collectionPath = `/explore/${repoSeg}/space/${spaceType}/${encodeURIComponent(skey)}/${encodeRepo(authorIdentity.did)}/${collection}`;
  const memberLabel = authorIdentity.handle ? `@${authorIdentity.handle}` : shortDid(authorIdentity.did);

  return (
    <div className="fx-explorer" data-page="space-collection" data-cols="1">
      <div className="fx-head">
        <AppearIn rise>
          <SpaceTitleBar
            crumbs={
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
                titled
              />
            }
            title={collection}
            pill={
              <span className="fx-pill">
                <User size={12} aria-hidden />
                {memberLabel}
              </span>
            }
            shareUrl={collectionPath}
          />
        </AppearIn>
      </div>

      <div className="fx-main">
        {!transport && (
          <AppearIn delay={0.05}>
            <SpaceRepoAccessPanel access={access} repo={repoAccess} what={`${memberLabel}’s ${collection} records`} />
          </AppearIn>
        )}

        {transport && (
          <AppearIn delay={0.05} id={CHROME_RESULTS_ID}>
            <section className="fx-card fx-records">
              <div className="fx-records-tools fx-sp-recs-tools">
                <button
                  type="button"
                  onClick={() => setAscending((v) => !v)}
                  className="fx-btn fx-btn-sm"
                  title={
                    ascending
                      ? 'Listing lowest record key first; switch back'
                      : 'Listing highest record key first; switch'
                  }
                >
                  {ascending ? (
                    <ArrowUpNarrowWide size={13} />
                  ) : (
                    <ArrowDownWideNarrow size={13} />
                  )}
                  {ascending ? 'Oldest first' : 'Newest first'}
                </button>
                {!done && records.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void loadPage(cursor)}
                    disabled={loading}
                    data-wait={loading || undefined}
                    className="fx-btn fx-btn-sm"
                    title={`Fetch the next ${RECORDS_PER_PAGE} records`}
                  >
                    {loading ? <Loader2 size={13} className="explore-spin" /> : <Plus size={13} />}
                    Fetch
                  </button>
                )}
                <span className="fx-records-tools-meta">
                  {records.length === 0 && !done
                    ? 'Loading…'
                    : query
                      ? `${formatCount(visible.length)} of ${formatCount(records.length)}`
                      : `${formatCount(records.length)} record${records.length === 1 ? '' : 's'}`}
                </span>
              </div>

              {error != null && (
                <div className="fx-sp-body">
                  <SpaceReadErrorPanel err={error} what={`${memberLabel}’s records`} />
                </div>
              )}
              {/* Only claim the collection is empty once the host has actually
                  run out; an in-flight first page is not an empty collection. */}
              {error == null && records.length === 0 && done && (
                <p className="fx-records-msg">No records in this collection.</p>
              )}
              {error == null && records.length === 0 && !done && (
                <SkeletonRecordRows rows={6} />
              )}
              {records.length > 0 && visible.length === 0 && (
                <p className="fx-records-msg">
                  No loaded records match <code>{filter.trim()}</code>.
                  {!done && ' Fetch more to search further.'}
                </p>
              )}

              {visible.length > 0 && (
                <ul className="fx-rec-list fx-sp-recs">
                  <li className="fx-rec-head" aria-hidden>
                    <span>Record key</span>
                    <span>Preview</span>
                  </li>
                  {visible.map((record) => (
                    <li key={record.rkey} className="fx-rec-item">
                      <Link
                        href={`${collectionPath}/${encodeURIComponent(record.rkey)}`}
                        prefetch={false}
                        className="fx-rec-row"
                      >
                        <code className="fx-rec-key">{record.rkey}</code>
                        <span className="fx-rec-text">{previewFor(record.value)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </AppearIn>
        )}
      </div>
    </div>
  );
}

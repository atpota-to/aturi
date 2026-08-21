'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Loader2, Plus } from 'lucide-react';
import NotFoundPanel from '@/components/NotFoundPanel';
import { encodeRepo, shortDid } from '@/utils/atproto/urls';
import { formatSpaceRef, isValidDid, isValidNsid, isValidRecordKey } from '@/utils/atproto/spaceUri';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { previewFor } from '@/utils/atproto/previewExtractors';
import { listSpaceRecords, type SpaceRecordRow } from '@/utils/atproto/spaceClient';
import AppearIn from '../AppearIn';
import Breadcrumb from '../Breadcrumb';
import { CHROME_RESULTS_ID, useChromeBarField } from '../ChromeBarContext';
import { formatCount, listColumns } from '../collectionListHelpers';
import { SpaceReadErrorPanel, SpaceRepoAccessPanel } from './SpaceAccessPanel';
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
        headline="That isn't a space address."
        body="A permissioned record is addressed as at://{authority}/space/{type}/{key}/{did}/{collection}/{rkey}, with a lexicon NSID for both the type and the collection and a DID for the member. One of those parts isn't valid here."
        initialQuery={collection}
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
    <SpaceCollectionList
      identity={identity}
      authorIdentity={authorIdentity}
      spaceType={spaceType}
      skey={skey}
      collection={collection}
    />
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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
          shareUrl={collectionPath}
        />
      </AppearIn>

      {!transport && (
        <AppearIn delay={0.05}>
          <SpaceRepoAccessPanel access={access} repo={repoAccess} what={`${memberLabel}’s ${collection} records`} />
        </AppearIn>
      )}

      {transport && (
        <>
          <AppearIn delay={0.05}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={() => setAscending((v) => !v)}
                style={controlStyle(false)}
                title={
                  ascending
                    ? 'Listing lowest record key first — switch back'
                    : 'Listing highest record key first — switch'
                }
              >
                {ascending ? (
                  <ArrowUpNarrowWide size={12} />
                ) : (
                  <ArrowDownWideNarrow size={12} />
                )}
                {ascending ? 'Oldest first' : 'Newest first'}
              </button>
              {!done && records.length > 0 && (
                <button
                  type="button"
                  onClick={() => void loadPage(cursor)}
                  disabled={loading}
                  style={controlStyle(loading)}
                  title={`Fetch the next ${RECORDS_PER_PAGE} records`}
                >
                  {loading ? <Loader2 size={12} className="explore-spin" /> : <Plus size={12} />}
                  Fetch
                </button>
              )}
              <span
                style={{
                  marginLeft: 'auto',
                  color: 'var(--text-tertiary)',
                  fontSize: '0.8125rem',
                  whiteSpace: 'nowrap',
                }}
              >
                {records.length === 0 && !done
                  ? 'Loading…'
                  : query
                    ? `${formatCount(visible.length)} of ${formatCount(records.length)}`
                    : `${formatCount(records.length)} record${records.length === 1 ? '' : 's'}`}
              </span>
            </div>
          </AppearIn>

          <AppearIn delay={0.1} id={CHROME_RESULTS_ID}>
            {error != null && <SpaceReadErrorPanel err={error} what={`${memberLabel}’s records`} />}
            {/* Only claim the collection is empty once the host has actually
                run out; an in-flight first page is not an empty collection. */}
            {error == null && records.length === 0 && done && (
              <p className="explore-placeholder">No records in this collection.</p>
            )}
            {error == null && records.length === 0 && !done && (
              <p className="explore-placeholder">Loading records…</p>
            )}
            {records.length > 0 && visible.length === 0 && (
              <p className="explore-placeholder">
                No loaded records match <code>{filter.trim()}</code>.
                {!done && ' Fetch more to search further.'}
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
                  display: 'grid',
                  gridTemplateColumns: listColumns(false),
                  columnGap: '1rem',
                }}
              >
                {visible.map((record) => (
                  <li
                    key={record.rkey}
                    style={{
                      gridColumn: '1 / -1',
                      display: 'grid',
                      gridTemplateColumns: 'subgrid',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <Link
                      href={`${collectionPath}/${encodeURIComponent(record.rkey)}`}
                      style={{
                        display: 'grid',
                        gridColumn: '1 / -1',
                        gridTemplateColumns: 'subgrid',
                        padding: '0.625rem 1rem',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.85rem',
                        color: 'var(--text-primary)',
                        textDecoration: 'none',
                      }}
                    >
                      <code
                        style={{
                          background: 'transparent',
                          padding: 0,
                          color: 'inherit',
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                        }}
                      >
                        {record.rkey}
                      </code>
                      <span
                        style={{
                          color: 'var(--text-tertiary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {previewFor(record.value)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </AppearIn>
        </>
      )}
    </div>
  );
}

function controlStyle(busy: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.4rem 0.75rem',
    background: 'var(--bg-tertiary)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-medium)',
    fontFamily: 'var(--font-serif)',
    fontSize: '0.8125rem',
    cursor: busy ? 'wait' : 'pointer',
  };
}

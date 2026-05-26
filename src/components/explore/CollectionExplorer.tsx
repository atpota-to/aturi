'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pause, Play } from 'lucide-react';
import { listRecordsPage, type AtRecord } from '@/utils/atproto/pdsClient';
import { encodeRepo, rkeyFromAtUri } from '@/utils/atproto/urls';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import { previewFor } from '@/utils/atproto/previewExtractors';
import {
  createJetstreamConnection,
  type JetstreamCommit,
} from '@/utils/atproto/jetstream';
import AppearIn from './AppearIn';
import Breadcrumb from './Breadcrumb';

type Props = {
  repo: string;
  collection: string;
};

export default function CollectionExplorer({ repo, collection }: Props) {
  const [identity, setIdentity] = useState<IdentityBundle | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIdentity(null);
    setIdentityError(null);
    resolveIdentifier(repo)
      .then((id) => {
        if (!cancelled) setIdentity(id);
      })
      .catch((err) => {
        if (!cancelled) setIdentityError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  if (identityError) {
    return <p className="explore-error">{identityError}</p>;
  }
  if (!identity) {
    return (
      <p className="explore-placeholder">
        Resolving <code>{repo}</code>…
      </p>
    );
  }

  return <CollectionList identity={identity} collection={collection} />;
}

// listRecords' XRPC max — request the full page on each call so users see
// as many records as possible per fetch.
const RECORDS_PER_PAGE = 100;

function CollectionList({
  identity,
  collection,
}: {
  identity: IdentityBundle;
  collection: string;
}) {
  const router = useRouter();
  const [records, setRecords] = useState<AtRecord[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const loadPage = useCallback(
    async (after: string | undefined) => {
      setLoading(true);
      setError(null);
      try {
        const res = await listRecordsPage(identity.pds, {
          repo: identity.did,
          collection,
          limit: RECORDS_PER_PAGE,
          cursor: after || undefined,
        });
        const batch = res.records || [];
        setRecords((prev) => (after ? [...prev, ...batch] : batch));
        setCursor(res.cursor);
        // A partial page (fewer rows than requested) is a strong signal
        // that the PDS has no more records — hide \"Load more\" in that
        // case even if the server still returned a cursor.
        if (!res.cursor || batch.length < RECORDS_PER_PAGE) setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [identity.pds, identity.did, collection],
  );

  useEffect(() => {
    setRecords([]);
    setCursor(undefined);
    setDone(false);
    loadPage(undefined);
  }, [loadPage]);

  // Live mode: jetstream subscription filtered to this collection+DID. New
  // commits are prepended to the list (capped to a sensible window).
  useEffect(() => {
    if (!live) return undefined;
    const dispose = createJetstreamConnection(
      { wantedCollections: [collection], wantedDids: [identity.did] },
      (evt: JetstreamCommit) => {
        if (evt.commit.collection !== collection) return;
        if (evt.did !== identity.did) return;
        const atUri = `at://${evt.did}/${evt.commit.collection}/${evt.commit.rkey}`;
        const cid = evt.commit.cid || '';
        const value = (evt.commit.record as Record<string, unknown>) || {};
        setRecords((prev) => {
          if (prev.some((r) => r.uri === atUri)) return prev;
          const next = [{ uri: atUri, cid, value }, ...prev];
          return next.slice(0, 200);
        });
      },
    );
    return () => {
      dispose();
    };
  }, [live, identity.did, collection]);

  const repoSeg = encodeRepo(identity.handle || identity.did);

  // Collections with exactly one record are usually singletons (actor.profile,
  // settings docs, etc.) — there's no list browsing to do, so jump straight
  // to the record page. router.replace so the back button skips this hop and
  // returns to whatever the visitor came from. Gated on `done` so we don't
  // redirect on a transient mid-load state where the page hasn't fully
  // settled yet, and on `!live` so a one-record collection stays browsable
  // when the visitor is intentionally streaming new commits.
  useEffect(() => {
    if (!done || loading || live) return;
    if (records.length !== 1) return;
    const rkey = rkeyFromAtUri(records[0].uri);
    if (!rkey) return;
    router.replace(`/explore/${repoSeg}/${collection}/${encodeURIComponent(rkey)}`);
  }, [done, loading, live, records, repoSeg, collection, router]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <AppearIn rise>
        <Breadcrumb
          handle={identity.handle}
          did={identity.did}
          pds={identity.pds}
          collection={collection}
          // No universal link route for collections — share the explorer URL.
          shareUrl={`/explore/${repoSeg}/${collection}`}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setLive((l) => !l)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.4rem 0.75rem',
            background: live ? 'var(--accent-moss)' : 'var(--bg-tertiary)',
            color: live ? 'var(--text-on-accent)' : 'var(--text-secondary)',
            border: `1px solid ${live ? 'var(--accent-moss)' : 'var(--border-medium)'}`,
            fontFamily: 'var(--font-serif)',
            fontSize: '0.8125rem',
            cursor: 'pointer',
          }}
          title={live ? 'Pause live stream' : 'Stream new records as they arrive'}
        >
          {live ? <Pause size={12} /> : <Play size={12} />}
          {live ? 'Live' : 'Go live'}
        </button>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8125rem' }}>
          {records.length} record{records.length === 1 ? '' : 's'}
        </span>
      </div>
      </AppearIn>

      <AppearIn delay={0.1}>
      {error && <p className="explore-error">{error}</p>}
      {records.length === 0 && !loading && !error && (
        <p className="explore-placeholder">No records in this collection.</p>
      )}
      {loading && records.length === 0 && (
        <p className="explore-placeholder">Loading records…</p>
      )}

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          border: records.length ? '1px solid var(--border-medium)' : 0,
          background: 'var(--bg-secondary)',
        }}
      >
        {records.map((rec) => {
          const rkey = rkeyFromAtUri(rec.uri) || '';
          return (
            <li
              key={rec.uri}
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <Link
                href={`/explore/${repoSeg}/${collection}/${encodeURIComponent(rkey)}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(10ch, 22ch) 1fr',
                  gap: '1rem',
                  padding: '0.625rem 1rem',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  color: 'var(--text-primary)',
                  textDecoration: 'none',
                  transition: 'background 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-tertiary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <code
                  style={{
                    background: 'transparent',
                    padding: 0,
                    color: 'var(--text-primary)',
                  }}
                >
                  {rkey}
                </code>
                <span
                  style={{
                    color: 'var(--text-tertiary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {previewFor(rec.value)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {!done && records.length > 0 && (
        <button
          type="button"
          onClick={() => loadPage(cursor)}
          disabled={loading}
          style={{
            alignSelf: 'flex-start',
            // The records list and this button live as siblings inside
            // the same AppearIn (not a flex container), so they don't get
            // the outer column gap. Push the button down explicitly.
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-serif)',
            fontSize: '0.875rem',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
      </AppearIn>
    </div>
  );
}

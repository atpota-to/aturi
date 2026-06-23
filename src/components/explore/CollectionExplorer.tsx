'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pause, Play, FilePenLine, Trash2, X } from 'lucide-react';
import { listRecordsPage, type AtRecord } from '@/utils/atproto/pdsClient';
import { encodeRepo, rkeyFromAtUri } from '@/utils/atproto/urls';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import { previewFor } from '@/utils/atproto/previewExtractors';
import { tidToDate, formatTidRelative } from '@/utils/atproto/tid';
import {
  createJetstreamConnection,
  type JetstreamCommit,
} from '@/utils/atproto/jetstream';
import AppearIn from './AppearIn';
import Breadcrumb from './Breadcrumb';
import NotFoundPanel from '@/components/NotFoundPanel';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';

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
    return (
      <NotFoundPanel
        eyebrow="Couldn't resolve"
        headline="That handle didn't resolve."
        body={`We tried to resolve "${repo}" and the AT Protocol resolver returned: ${identityError}. Try another handle, DID, or AT URI below.`}
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

  return <CollectionList identity={identity} collection={collection} />;
}

// listRecords' XRPC max — request the full page on each call so users see
// as many records as possible per fetch.
const RECORDS_PER_PAGE = 100;

// Shared look for the quiet "Select all" / "Deselect all" buttons in the
// bulk-edit toolbar — neutral chips that dim when their action is a no-op.
function selectionButtonStyle(disabled: boolean): CSSProperties {
  return {
    padding: '0.4rem 0.75rem',
    background: 'var(--bg-tertiary)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-medium)',
    fontFamily: 'var(--font-serif)',
    fontSize: '0.8125rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

function CollectionList({
  identity,
  collection,
}: {
  identity: IdentityBundle;
  collection: string;
}) {
  const router = useRouter();
  const { agent, did: signedInDid } = useAtprotoSession();
  const [records, setRecords] = useState<AtRecord[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  // Selection / bulk-delete mode. Records can only be deleted from your own
  // repository, so the whole affordance is gated on the signed-in user owning
  // this repo — mirrors how the single-record view gates its "Edit record".
  const canEdit = Boolean(agent && signedInDid && signedInDid === identity.did);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    // A fresh record set invalidates any pending selection.
    setSelected(new Set());
    setConfirmingDelete(false);
    setDeleteError(null);
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
    // Don't bounce to the single record while the visitor is mid-selection —
    // they may have just deleted the rest and still be working in the list.
    if (!done || loading || live || editing) return;
    if (records.length !== 1) return;
    const rkey = rkeyFromAtUri(records[0].uri);
    if (!rkey) return;
    router.replace(`/explore/${repoSeg}/${collection}/${encodeURIComponent(rkey)}`);
  }, [done, loading, live, editing, records, repoSeg, collection, router]);

  const allSelected = records.length > 0 && records.every((r) => selected.has(r.uri));

  const toggleSelect = useCallback((uri: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  }, []);

  const exitEditing = useCallback(() => {
    setEditing(false);
    setSelected(new Set());
    setConfirmingDelete(false);
    setDeleteError(null);
  }, []);

  async function handleBulkDelete() {
    if (!agent || selected.size === 0) return;
    const ag = agent;
    const targets = records.filter((r) => selected.has(r.uri)).map((r) => r.uri);
    setDeleting(true);
    setDeleteError(null);

    const failed = new Set<string>();
    let firstError: string | null = null;
    const queue = [...targets];
    // Bounded concurrency: clear a large selection quickly without firing one
    // request per record at the PDS all at once. JS is single-threaded between
    // awaits, so the shared `queue.shift()` hand-off is race-free.
    const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
      for (let uri = queue.shift(); uri; uri = queue.shift()) {
        const rkey = rkeyFromAtUri(uri);
        if (!rkey) {
          failed.add(uri);
          continue;
        }
        try {
          await ag.com.atproto.repo.deleteRecord({ repo: identity.did, collection, rkey });
        } catch (err) {
          failed.add(uri);
          if (!firstError) firstError = err instanceof Error ? err.message : String(err);
        }
      }
    });
    await Promise.all(workers);

    // Drop the records we deleted; keep any that failed so the visitor can see
    // what's left and retry.
    setRecords((prev) => prev.filter((r) => !selected.has(r.uri) || failed.has(r.uri)));
    setConfirmingDelete(false);
    setDeleting(false);
    if (failed.size > 0) {
      setSelected(failed);
      setDeleteError(
        `Couldn't delete ${failed.size} of ${targets.length} record${
          targets.length === 1 ? '' : 's'
        }.${firstError ? ` ${firstError}` : ''}`,
      );
    } else {
      exitEditing();
    }
  }

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {canEdit && (
            <button
              type="button"
              onClick={() => (editing ? exitEditing() : setEditing(true))}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.4rem 0.75rem',
                background: editing ? 'var(--accent-moss)' : 'var(--bg-tertiary)',
                color: editing ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                border: `1px solid ${editing ? 'var(--accent-moss)' : 'var(--border-medium)'}`,
                fontFamily: 'var(--font-serif)',
                fontSize: '0.8125rem',
                cursor: 'pointer',
              }}
              title={editing ? 'Exit selection mode' : 'Select records to delete'}
            >
              {editing ? <X size={12} /> : <FilePenLine size={12} />}
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
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

        {editing && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              flexWrap: 'wrap',
              padding: '0.625rem 0.75rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
            }}
          >
            <button
              type="button"
              onClick={() => setSelected(new Set(records.map((r) => r.uri)))}
              disabled={records.length === 0 || allSelected}
              style={selectionButtonStyle(records.length === 0 || allSelected)}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
              style={selectionButtonStyle(selected.size === 0)}
            >
              Deselect all
            </button>
            <span
              style={{
                color: 'var(--text-tertiary)',
                fontSize: '0.8125rem',
                marginLeft: '0.25rem',
              }}
            >
              {selected.size} selected
            </span>
            <span style={{ flex: 1 }} />
            {!confirmingDelete ? (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={selected.size === 0}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.4rem 0.75rem',
                  background: 'var(--danger-soft)',
                  color: 'var(--danger)',
                  border: '1px solid var(--danger-border)',
                  fontFamily: 'var(--font-serif)',
                  fontSize: '0.8125rem',
                  cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
                  opacity: selected.size === 0 ? 0.5 : 1,
                }}
              >
                <Trash2 size={12} /> Delete{selected.size ? ` (${selected.size})` : ''}
              </button>
            ) : (
              <>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  Delete {selected.size} record{selected.size === 1 ? '' : 's'}? This cannot be
                  undone.
                </span>
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={deleting}
                  style={{
                    padding: '0.4rem 0.75rem',
                    background: 'var(--danger)',
                    color: 'var(--text-on-accent)',
                    border: '1px solid var(--danger)',
                    fontFamily: 'var(--font-serif)',
                    fontSize: '0.8125rem',
                    cursor: deleting ? 'wait' : 'pointer',
                  }}
                >
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  style={{
                    padding: '0.4rem 0.75rem',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-medium)',
                    fontFamily: 'var(--font-serif)',
                    fontSize: '0.8125rem',
                    cursor: deleting ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        )}
        {editing && deleteError && (
          <p className="explore-error" style={{ margin: 0 }}>
            {deleteError}
          </p>
        )}
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
          // TID-derived timestamps are decoded client-side from the rkey
          // itself — no extra PDS call. Non-TID rkeys (custom strings,
          // singletons like "self") return null and we just hide the chip.
          const tidDate = tidToDate(rkey);
          const isSelected = selected.has(rec.uri);
          const rowInner = (
            <>
              <div style={{ minWidth: 0 }}>
                <code
                  style={{
                    background: 'transparent',
                    padding: 0,
                    color: 'var(--text-primary)',
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {rkey}
                </code>
                {tidDate && (
                  <time
                    dateTime={tidDate.toISOString()}
                    title={tidDate.toISOString()}
                    style={{
                      display: 'block',
                      marginTop: '0.125rem',
                      fontSize: '0.7rem',
                      color: 'var(--text-tertiary)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {formatTidRelative(tidDate)}
                  </time>
                )}
              </div>
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
            </>
          );
          return (
            <li
              key={rec.uri}
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              {editing ? (
                // Selection mode: the row becomes a checkbox label so clicking
                // anywhere toggles selection (native), and navigation is
                // suppressed while the visitor is choosing what to delete.
                <label
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto minmax(10ch, 22ch) 1fr',
                    gap: '1rem',
                    alignItems: 'center',
                    padding: '0.625rem 1rem',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.85rem',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
                    transition: 'background 0.2s ease',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(rec.uri)}
                    aria-label={`Select ${rkey}`}
                    style={{
                      width: '1rem',
                      height: '1rem',
                      cursor: 'pointer',
                      accentColor: 'var(--accent-moss)',
                    }}
                  />
                  {rowInner}
                </label>
              ) : (
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
                  {rowInner}
                </Link>
              )}
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


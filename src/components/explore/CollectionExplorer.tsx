'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
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
import SignInPanel from './SignInPanel';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { useEditBar } from './EditBarContext';

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

// Reveal/retract thresholds for dropping the condensed edit bar into the nav,
// matching the breadcrumb's behaviour: the top ~96px counts as occluded by the
// sticky nav, and a dead band keeps the reveal from strobing at the boundary
// (showing the bar grows the nav, which nudges the page back across the line).
const NAV_OFFSET_PX = 96;
const REVEAL_HYSTERESIS_PX = 72;

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
  const { agent, did: signedInDid, session, loading: sessionLoading } = useAtprotoSession();
  const [records, setRecords] = useState<AtRecord[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);

  // Records can only be deleted from your own repository, so selection mode is
  // gated on the signed-in user owning this repo. The Edit button itself is
  // also offered to logged-out visitors though: pressing it reveals a sign-in
  // prompt prefilled with this repo's handle (mirrors the record page) so the
  // owner can sign in and start managing in two clicks. We hide it only from
  // someone signed in as a *different* account — they can't edit here.
  const canEdit = Boolean(agent && signedInDid && signedInDid === identity.did);
  const loggedOut = !session && !sessionLoading;
  const showEditButton = canEdit || loggedOut;
  const editActive = editing || signInOpen;

  const { setBar, setScrolledPast } = useEditBar();
  // Latest selection + record set, read by the stable handlers below (and the
  // published snapshot) without making those callbacks change identity on
  // every toggle — which would otherwise thrash the publish effect.
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // In-page edit toolbar, watched so the condensed nav copy reveals once it
  // scrolls behind the nav.
  const editBarRef = useRef<HTMLDivElement>(null);

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

  // Stable selection actions (live state read via refs) so the in-page bar and
  // the condensed nav bar share one set of handlers, and publishing them to
  // context doesn't change their identity on every toggle.
  const selectAll = useCallback(() => {
    setSelected(new Set(recordsRef.current.map((r) => r.uri)));
  }, []);
  const deselectAll = useCallback(() => setSelected(new Set()), []);
  const requestDelete = useCallback(() => setConfirmingDelete(true), []);
  const cancelDelete = useCallback(() => setConfirmingDelete(false), []);

  const confirmDelete = useCallback(async () => {
    if (!agent) return;
    const ag = agent;
    const selectedNow = selectedRef.current;
    const targets = recordsRef.current
      .filter((r) => selectedNow.has(r.uri))
      .map((r) => r.uri);
    if (targets.length === 0) return;
    const targetSet = new Set(targets);
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
    setRecords((prev) => prev.filter((r) => !targetSet.has(r.uri) || failed.has(r.uri)));
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
  }, [agent, identity.did, collection, exitEditing]);

  // Reveal the condensed edit bar in the nav once the in-page one scrolls up
  // behind it — same rAF-throttled hysteresis dance as the breadcrumb. Only
  // wired while selection mode is on (the bar is in the DOM then).
  useEffect(() => {
    const node = editBarRef.current;
    if (!editing || !node) {
      setScrolledPast(false);
      return undefined;
    }
    let shown = false;
    let frame = 0;
    const evaluate = () => {
      frame = 0;
      const { bottom } = node.getBoundingClientRect();
      if (!shown && bottom <= NAV_OFFSET_PX) {
        shown = true;
        setScrolledPast(true);
      } else if (shown && bottom >= NAV_OFFSET_PX + REVEAL_HYSTERESIS_PX) {
        shown = false;
        setScrolledPast(false);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(evaluate);
    };
    evaluate();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
      setScrolledPast(false);
    };
  }, [editing, setScrolledPast]);

  // Publish the toolbar snapshot so the nav's <StickyEditBar> can mirror it.
  // Handlers are stable and the rest are primitives, so this only re-runs on
  // real changes — no feedback loop with the context-driven re-render.
  useEffect(() => {
    if (!editing) {
      setBar(null);
      return;
    }
    setBar({
      selectedCount: selected.size,
      totalCount: records.length,
      allSelected,
      confirming: confirmingDelete,
      deleting,
      onSelectAll: selectAll,
      onDeselectAll: deselectAll,
      onRequestDelete: requestDelete,
      onConfirmDelete: confirmDelete,
      onCancelDelete: cancelDelete,
    });
  }, [
    editing,
    selected.size,
    records.length,
    allSelected,
    confirmingDelete,
    deleting,
    selectAll,
    deselectAll,
    requestDelete,
    confirmDelete,
    cancelDelete,
    setBar,
  ]);

  // Clear the published snapshot when this list unmounts.
  useEffect(() => () => setBar(null), [setBar]);

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
          {showEditButton && (
            <button
              type="button"
              onClick={() => {
                if (canEdit) {
                  if (editing) exitEditing();
                  else setEditing(true);
                } else {
                  // Logged out — reveal the prefilled sign-in prompt instead.
                  setSignInOpen((v) => !v);
                }
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.4rem 0.75rem',
                background: editActive ? 'var(--accent-moss)' : 'var(--bg-tertiary)',
                color: editActive ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                border: `1px solid ${editActive ? 'var(--accent-moss)' : 'var(--border-medium)'}`,
                fontFamily: 'var(--font-serif)',
                fontSize: '0.8125rem',
                cursor: 'pointer',
              }}
              title={
                canEdit
                  ? editing
                    ? 'Exit selection mode'
                    : 'Select records to delete'
                  : 'Sign in to manage your records'
              }
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
            ref={editBarRef}
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
              onClick={selectAll}
              disabled={records.length === 0 || allSelected}
              style={selectionButtonStyle(records.length === 0 || allSelected)}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={deselectAll}
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
                onClick={requestDelete}
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
                  onClick={confirmDelete}
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
                  onClick={cancelDelete}
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
        {signInOpen && !session && (
          <div
            style={{
              padding: '0.875rem 1rem',
              border: '1px solid var(--border-medium)',
              background: 'var(--bg-secondary)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Sign in as{' '}
              <strong>{identity.handle ? `@${identity.handle}` : identity.did}</strong> to
              select and delete your own records.
            </p>
            <SignInPanel defaultInput={identity.handle || identity.did} />
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


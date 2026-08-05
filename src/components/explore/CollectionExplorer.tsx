'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play, FilePenLine, X, Plus, Loader2 } from 'lucide-react';
import { listRecordsPage, type AtRecord } from '@/utils/atproto/pdsClient';
import {
  msUntilBudget,
  recordSpend,
  pointsAvailable,
} from '@/utils/atproto/writeThrottle';
import { encodeRepo, rkeyFromAtUri } from '@/utils/atproto/urls';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import {
  createJetstreamConnection,
  type JetstreamCommit,
} from '@/utils/atproto/jetstream';
import AppearIn from './AppearIn';
import Breadcrumb from './Breadcrumb';
import CollectionEditBar from './CollectionEditBar';
import CollectionRecordRow from './CollectionRecordRow';
import NotFoundPanel from '@/components/NotFoundPanel';
import SignInPanel from './SignInPanel';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { useEditBar } from './EditBarContext';
import { useChromeBarAction, useChromeBarField } from './ChromeBarContext';
import { useOffscreen } from './useOffscreen';
import {
  RECORDS_PER_PAGE,
  APPLY_WRITES_MAX,
  THROTTLE_TICK_MS,
  sleep,
  listColumns,
  formatCount,
  rateLimitResetMinutes,
} from './collectionListHelpers';

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
  // Client-side search over the records fetched so far — listRecords has no
  // server-side query, so this narrows what's loaded rather than the whole
  // collection. Driven from the bottom chrome bar.
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Records settled (deleted or failed) / total, so the bar advances a chunk
  // at a time. Null when no delete run is in flight.
  const [deleteProgress, setDeleteProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  // Seconds until the throttle resumes, while a run is paced-paused. Null when
  // actively deleting (or idle).
  const [deleteWaitSec, setDeleteWaitSec] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  // Flipped by the Stop button so the in-flight delete loop bails after its
  // current batch; a ref so the running loop sees it without a re-render.
  const deleteCancelRef = useRef(false);

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

  const { setBar } = useEditBar();
  // Latest selection + record set, read by the stable handlers below (and the
  // published snapshot) without making those callbacks change identity on
  // every toggle — which would otherwise thrash the publish effect.
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // The in-page controls (Edit / Live / Fetch and the selection toolbar under
  // them), watched so the chrome bar picks up their duties exactly while they
  // aren't on screen.
  const [controlsNode, setControlsNode] = useState<HTMLDivElement | null>(null);
  const controlsOffscreen = useOffscreen(controlsNode);

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
    // A query typed against one collection means nothing in the next.
    setFilter('');
    // A fresh record set invalidates any pending selection.
    setSelected(new Set());
    setConfirmingDelete(false);
    setDeleteProgress(null);
    setDeleteWaitSec(null);
    setDeleteError(null);
    loadPage(undefined);
  }, [loadPage]);

  // If a delete empties the loaded set while the PDS still has more pages,
  // pull the next page automatically instead of flashing a false "No records"
  // / 0-count state when the collection isn't actually empty. The cursor sits
  // at the end of what we've fetched, so deleting earlier rows never
  // invalidates it. Guarded on `!error` so a failed fetch doesn't spin here,
  // and on `cursor` so it stays dormant during the initial load (cursor is
  // still undefined then — that first page is the other effect's job).
  useEffect(() => {
    if (loading || error) return;
    if (records.length > 0 || done) return;
    if (cursor === undefined) return;
    loadPage(cursor);
  }, [records.length, loading, error, done, cursor, loadPage]);

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

  // One lowercased haystack per record — its rkey plus its whole JSON body,
  // so a search finds records by content ("that post about mushrooms") and
  // not just by key. Memoized on the record set, so a keystroke only re-runs
  // the substring test.
  const haystacks = useMemo(
    () =>
      records.map((rec) => {
        const rkey = rkeyFromAtUri(rec.uri) || '';
        let body = '';
        try {
          body = JSON.stringify(rec.value) ?? '';
        } catch {
          // A cyclic / unserializable value is vanishingly unlikely from a
          // PDS, but throwing here would take the whole list down with it.
        }
        return `${rkey}\n${body}`.toLowerCase();
      }),
    [records],
  );

  const query = filter.trim().toLowerCase();
  const visibleRecords = useMemo(
    () => (query ? records.filter((_, i) => haystacks[i].includes(query)) : records),
    [records, haystacks, query],
  );

  // Select-all targets what you can see, so narrowing the list and then
  // selecting is a way to bulk-delete a subset. Deletes still resolve against
  // `recordsRef` (every loaded record), so a row that scrolls out of the
  // filter after you selected it is still deleted.
  const visibleRef = useRef(visibleRecords);
  visibleRef.current = visibleRecords;

  const allSelected =
    visibleRecords.length > 0 && visibleRecords.every((r) => selected.has(r.uri));

  // Whether confirming this delete will hit the throttle and pace partway —
  // i.e. the selection is bigger than the write budget left this hour. Drives
  // the heads-up in the confirm step so a big delete isn't a surprise.
  const willPace = useMemo(() => {
    if (!confirmingDelete || deleting) return false;
    return selected.size > pointsAvailable(identity.did);
  }, [confirmingDelete, deleting, selected.size, identity.did]);

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
    setDeleteProgress(null);
    setDeleteWaitSec(null);
    setDeleteError(null);
  }, []);

  // Stable selection actions (live state read via refs) so the in-page bar and
  // the condensed nav bar share one set of handlers, and publishing them to
  // context doesn't change their identity on every toggle.
  const selectAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of visibleRef.current) next.add(r.uri);
      return next;
    });
  }, []);
  const deselectAll = useCallback(() => setSelected(new Set()), []);
  const requestDelete = useCallback(() => setConfirmingDelete(true), []);
  const cancelDelete = useCallback(() => setConfirmingDelete(false), []);

  // Stop an in-flight delete after the current batch. The loop reads this ref
  // (set synchronously) between batches and bails; whatever hasn't been
  // deleted stays selected.
  const stopDelete = useCallback(() => {
    deleteCancelRef.current = true;
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!agent) return;
    const ag = agent;
    const did = identity.did;
    const selectedNow = selectedRef.current;
    const targets = recordsRef.current
      .filter((r) => selectedNow.has(r.uri))
      .map((r) => r.uri);
    if (targets.length === 0) return;
    const targetSet = new Set(targets);

    // Resolve each URI to its rkey up front. A URI with no decodable rkey
    // can't be deleted, so it's counted as failed without spending a request.
    const failed = new Set<string>();
    const deletable: { uri: string; rkey: string }[] = [];
    for (const uri of targets) {
      const rkey = rkeyFromAtUri(uri);
      if (rkey) deletable.push({ uri, rkey });
      else failed.add(uri);
    }

    // Split the deletable rows into ≤200-op batches; each batch lands as one
    // atomic applyWrites commit rather than one deleteRecord per record.
    const chunks: { uri: string; rkey: string }[][] = [];
    for (let i = 0; i < deletable.length; i += APPLY_WRITES_MAX) {
      chunks.push(deletable.slice(i, i + APPLY_WRITES_MAX));
    }

    deleteCancelRef.current = false;
    setDeleting(true);
    setDeleteError(null);
    setDeleteWaitSec(null);
    // Undecodable rows are already settled, so seed the bar with them.
    let processed = failed.size;
    setDeleteProgress({ done: processed, total: targets.length });

    let firstError: string | null = null;
    // Set once a 429 halts the run; minutes until the write budget resets (or
    // null if unknown). Staying undefined means no rate limit was hit.
    let rateLimitResetMin: number | null | undefined;
    // First chunk we did NOT attempt (a Stop or a 429), so the rest can be
    // swept back into the selection.
    let stopIdx = chunks.length;

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];

      // Pace against the write budget so we never trip the PDS limit: wait
      // until spending this batch stays under it, ticking the countdown and
      // watching for Stop. A fresh hourly budget means no wait at all.
      let paused = false;
      for (;;) {
        if (deleteCancelRef.current) break;
        const wait = msUntilBudget(did, chunk.length);
        if (wait <= 0) break;
        paused = true;
        setDeleteWaitSec(Math.ceil(wait / 1000));
        await sleep(Math.min(wait, THROTTLE_TICK_MS));
      }
      if (paused) setDeleteWaitSec(null);

      if (deleteCancelRef.current) {
        stopIdx = ci;
        break;
      }

      // Reserve the points before sending; on failure we keep the reservation
      // (staying conservative) rather than risk under-counting.
      recordSpend(did, chunk.length);
      try {
        await ag.com.atproto.repo.applyWrites({
          repo: did,
          writes: chunk.map((job) => ({
            $type: 'com.atproto.repo.applyWrites#delete' as const,
            collection,
            rkey: job.rkey,
          })),
        });
      } catch (err) {
        // A batch is atomic: a failed commit deleted none of its records, so
        // keep the whole chunk selected for retry.
        for (const job of chunk) failed.add(job.uri);
        if ((err as { status?: number } | null)?.status === 429) {
          // 429 despite pacing — usually writes from elsewhere spent the
          // budget. Stop cleanly and leave the rest selected to resume later.
          rateLimitResetMin = rateLimitResetMinutes(err);
          processed += chunk.length;
          setDeleteProgress({ done: processed, total: targets.length });
          stopIdx = ci + 1;
          break;
        }
        if (!firstError) firstError = err instanceof Error ? err.message : String(err);
      }
      processed += chunk.length;
      setDeleteProgress({ done: processed, total: targets.length });
    }

    // Sweep any chunks we didn't attempt (Stop or 429) back into the selection.
    for (let ci = stopIdx; ci < chunks.length; ci++) {
      for (const job of chunks[ci]) failed.add(job.uri);
    }
    const cancelled = deleteCancelRef.current;

    // Drop the records we deleted; keep any that failed so the visitor can see
    // what's left and retry.
    setRecords((prev) => prev.filter((r) => !targetSet.has(r.uri) || failed.has(r.uri)));
    setConfirmingDelete(false);
    setDeleting(false);
    setDeleteProgress(null);
    setDeleteWaitSec(null);
    if (failed.size > 0) {
      setSelected(failed);
      const deleted = targets.length - failed.size;
      if (rateLimitResetMin !== undefined) {
        const when = rateLimitResetMin
          ? `Resets in ~${rateLimitResetMin} min. Retry then.`
          : 'Try again in a bit.';
        setDeleteError(
          `Hit your PDS's write rate limit after ${deleted} of ${targets.length}. ` +
            `${failed.size} still selected. ${when}`,
        );
      } else if (cancelled) {
        setDeleteError(
          `Stopped after ${deleted} of ${targets.length}. ${failed.size} still selected.`,
        );
      } else {
        setDeleteError(
          `Couldn't delete ${failed.size} of ${targets.length} record${
            targets.length === 1 ? '' : 's'
          }.${firstError ? ` ${firstError}` : ''}`,
        );
      }
    } else {
      exitEditing();
    }
  }, [agent, identity.did, collection, exitEditing]);

  // Publish the toolbar snapshot so the chrome bar can mirror it, but only
  // while the in-page toolbar is off screen — otherwise the same Delete
  // button would be sitting in two places at once. Handlers are stable and
  // the rest are primitives, so this only re-runs on real changes.
  useEffect(() => {
    if (!editing || !controlsOffscreen) {
      setBar(null);
      return;
    }
    setBar({
      selectedCount: selected.size,
      // What "Select" would take, which is the filtered view when one's up.
      totalCount: visibleRecords.length,
      allSelected,
      confirming: confirmingDelete,
      deleting,
      progress: deleteProgress,
      waitingSec: deleteWaitSec,
      onSelectAll: selectAll,
      onDeselectAll: deselectAll,
      onRequestDelete: requestDelete,
      onConfirmDelete: confirmDelete,
      onCancelDelete: cancelDelete,
      onStop: stopDelete,
      onDone: exitEditing,
    });
  }, [
    editing,
    controlsOffscreen,
    selected.size,
    visibleRecords.length,
    allSelected,
    confirmingDelete,
    deleting,
    deleteProgress,
    deleteWaitSec,
    selectAll,
    deselectAll,
    requestDelete,
    confirmDelete,
    cancelDelete,
    stopDelete,
    exitEditing,
    setBar,
  ]);

  // Clear the published snapshot when this list unmounts.
  useEffect(() => () => setBar(null), [setBar]);

  // The way *into* selection mode, for when the in-page Edit button has
  // scrolled away. Only for the repo's owner: a logged-out visitor's Edit
  // reveals an in-page sign-in prompt, which is no use from down here.
  useChromeBarAction(
    canEdit && !editing && controlsOffscreen
      ? {
          label: 'Edit',
          title: 'Select records to delete',
          onClick: () => setEditing(true),
        }
      : null,
  );

  // The collection page's find action: search the records you've fetched.
  useChromeBarField({
    placeholder: 'Search records…',
    label: 'Search records in this collection',
    value: filter,
    onChange: setFilter,
    status:
      records.length === 0
        ? null
        : query
          ? `${formatCount(visibleRecords.length)}/${formatCount(records.length)}`
          : `${formatCount(records.length)}${done ? '' : '+'}`,
  });

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
      {/* The page's own controls. Watched as one block — Edit/Live/Fetch and
          the selection toolbar that appears under them — so the chrome bar
          takes over exactly when this whole cluster is off screen. */}
      <div
        ref={setControlsNode}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
      >
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
            Live
          </button>
          {!done && records.length > 0 && (
            <button
              type="button"
              onClick={() => loadPage(cursor)}
              disabled={loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.4rem 0.75rem',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-medium)',
                fontFamily: 'var(--font-serif)',
                fontSize: '0.8125rem',
                cursor: loading ? 'wait' : 'pointer',
              }}
              title={`Fetch the next ${RECORDS_PER_PAGE} records`}
            >
              {/* Keep the label fixed at "Fetch" and only swap the icon for a
                  spinner while loading — both icons are 12px, so the button
                  never changes width when tapped. */}
              {loading ? (
                <Loader2 size={12} className="explore-spin" />
              ) : (
                <Plus size={12} />
              )}
              Fetch
            </button>
          )}
          <span
            style={{
              color: 'var(--text-tertiary)',
              fontSize: '0.8125rem',
              // Pin the count to the right edge so the Fetch→Fetching… width
              // change is absorbed by the flexible gap on its left instead of
              // shoving the count sideways on every tap.
              marginLeft: 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            {records.length === 0 && !done
              ? 'Loading…'
              : query
                ? `${formatCount(visibleRecords.length)} of ${formatCount(records.length)}`
                : `${formatCount(records.length)} record${records.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {editing && (
          <CollectionEditBar
            // The visible set, so "Select" greys out when a search has
            // narrowed the list to nothing — same rule as its condensed twin.
            recordsLength={visibleRecords.length}
            selectedSize={selected.size}
            allSelected={allSelected}
            deleting={deleting}
            confirmingDelete={confirmingDelete}
            deleteProgress={deleteProgress}
            deleteWaitSec={deleteWaitSec}
            willPace={willPace}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
            onRequestDelete={requestDelete}
            onConfirmDelete={confirmDelete}
            onCancelDelete={cancelDelete}
            onStop={stopDelete}
          />
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
      {/* Only claim the collection is empty once we've actually exhausted it
          (done). While records is empty but more pages remain — the initial
          load, or the gap after a delete clears the page before the auto-fetch
          refills it — keep showing "Loading" so we never flash a false empty
          state. */}
      {records.length === 0 && done && !error && (
        <p className="explore-placeholder">No records in this collection.</p>
      )}
      {records.length === 0 && !done && !error && (
        <p className="explore-placeholder">Loading records…</p>
      )}
      {/* A search only sees what's been fetched, so when it comes up empty
          and the collection still has pages left, say so — otherwise "no
          match" reads as "not in this collection". */}
      {records.length > 0 && visibleRecords.length === 0 && (
        <p className="explore-placeholder">
          No loaded records match <code>{filter.trim()}</code>.
          {!done && ' Fetch more to search further.'}
        </p>
      )}

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          border: visibleRecords.length ? '1px solid var(--border-medium)' : 0,
          background: 'var(--bg-secondary)',
          // One grid for the whole list so the rkey/preview columns align
          // across rows; each row re-adopts these tracks via subgrid.
          display: 'grid',
          gridTemplateColumns: listColumns(editing),
          columnGap: '1rem',
        }}
      >
        {visibleRecords.map((rec) => (
          <CollectionRecordRow
            key={rec.uri}
            rec={rec}
            editing={editing}
            isSelected={selected.has(rec.uri)}
            repoSeg={repoSeg}
            collection={collection}
            onToggleSelect={toggleSelect}
          />
        ))}
      </ul>
      </AppearIn>
    </div>
  );
}


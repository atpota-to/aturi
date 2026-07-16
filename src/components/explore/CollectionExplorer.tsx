'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pause, Play, FilePenLine, Trash2, X, Plus } from 'lucide-react';
import { listRecordsPage, type AtRecord } from '@/utils/atproto/pdsClient';
import {
  msUntilBudget,
  recordSpend,
  pointsAvailable,
  HOURLY_POINT_BUDGET,
} from '@/utils/atproto/writeThrottle';
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
import DeleteProgressBar from './DeleteProgressBar';
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

// Keep the record-count stat compact once a repo has paged in a lot of rows:
// 1000 -> "1k", 1400 -> "1.4k", 12300 -> "12.3k", 1_000_000 -> "1m". Counts
// under 1k render verbatim. Lowercased to sit with the explorer's quiet,
// terminal-flavoured typography.
const compactCountFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
function formatCount(n: number): string {
  return n < 1000 ? String(n) : compactCountFormatter.format(n).toLowerCase();
}

// com.atproto.repo.applyWrites caps a batch at 200 operations (lexicon
// maxLength), so a larger selection is split into chunks. Each chunk lands as
// one atomic repo commit instead of one commit per record.
const APPLY_WRITES_MAX = 200;

// Deletes run one batch at a time. Throughput is dominated by the write-rate
// throttle (below) once a selection is large, and sequential batches keep the
// pacing accounting and the "resuming in Ns" countdown simple and exact.
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// While paused for the throttle, re-check the budget on this cadence so the
// countdown ticks and a Stop press is picked up within a second.
const THROTTLE_TICK_MS = 1000;

// Pull minutes-until-reset out of a PDS 429 so the delete UI can say when the
// write budget frees up. Bluesky sends `ratelimit-reset` as an absolute
// unix-seconds timestamp; `retry-after` (seconds from now) is the fallback.
// Returns null when neither header is present or parseable.
function rateLimitResetMinutes(err: unknown): number | null {
  const headers = (err as { headers?: Record<string, string | undefined> } | null)?.headers;
  if (!headers) return null;
  const reset = headers['ratelimit-reset'];
  if (reset) {
    const ms = Number(reset) * 1000 - Date.now();
    if (Number.isFinite(ms) && ms > 0) return Math.max(1, Math.ceil(ms / 60000));
  }
  const retryAfter = headers['retry-after'];
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) return Math.max(1, Math.ceil(secs / 60));
  }
  return null;
}

// Reveal/retract thresholds for dropping the condensed edit bar into the nav,
// matching the breadcrumb's behaviour: the top ~96px counts as occluded by the
// sticky nav, and a dead band keeps the reveal from strobing at the boundary
// (showing the bar grows the nav, which nudges the page back across the line).
const NAV_OFFSET_PX = 96;
const REVEAL_HYSTERESIS_PX = 72;

// Row layout. The whole list is one CSS grid so the rkey and data-preview
// columns line up across every row: the <ul> defines the columns and each row
// re-adopts them with `grid-template-columns: subgrid`. The rkey track hugs its
// content but is capped at 30ch — a shared column is only as wide as its widest
// member, so this bounds how far one long rkey can push every preview in — past
// which a long rkey wraps onto a second line (see the <code> wrap rule below)
// rather than shoving the preview off-screen; the `1fr` preview takes the rest.
//
// Sizing to content is the point: a fixed `minmax(_, 30ch)` always *reserves*
// its 30ch max (grid grows fixed tracks to their limit and skips the flexible
// `1fr`), which on a narrow phone viewport left the preview squeezed into a
// sliver on the right. Selection mode prepends a checkbox, adding a leading
// `auto` track.
const RKEY_COLUMN = 'fit-content(30ch)';
const listColumns = (editing: boolean) =>
  editing ? `auto ${RKEY_COLUMN} 1fr` : `${RKEY_COLUMN} 1fr`;

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

  const allSelected = records.length > 0 && records.every((r) => selected.has(r.uri));

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
    setSelected(new Set(recordsRef.current.map((r) => r.uri)));
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
          ? `Resets in ~${rateLimitResetMin} min — retry then.`
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
      progress: deleteProgress,
      waitingSec: deleteWaitSec,
      onSelectAll: selectAll,
      onDeselectAll: deselectAll,
      onRequestDelete: requestDelete,
      onConfirmDelete: confirmDelete,
      onCancelDelete: cancelDelete,
      onStop: stopDelete,
    });
  }, [
    editing,
    selected.size,
    records.length,
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
              <Plus size={12} />
              {loading ? 'Fetching…' : 'Fetch'}
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
              : `${formatCount(records.length)} record${records.length === 1 ? '' : 's'}`}
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
              disabled={records.length === 0 || allSelected || deleting}
              style={selectionButtonStyle(records.length === 0 || allSelected || deleting)}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={deselectAll}
              disabled={selected.size === 0 || deleting}
              style={selectionButtonStyle(selected.size === 0 || deleting)}
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
            ) : deleting && deleteProgress ? (
              <>
                <span
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {deleteWaitSec != null
                    ? `Paced under the rate limit — resuming in ${deleteWaitSec}s`
                    : 'Deleting…'}
                </span>
                <DeleteProgressBar done={deleteProgress.done} total={deleteProgress.total} />
                <button
                  type="button"
                  onClick={stopDelete}
                  style={{
                    padding: '0.4rem 0.75rem',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-medium)',
                    fontFamily: 'var(--font-serif)',
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Stop
                </button>
              </>
            ) : (
              <>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  Delete {selected.size} record{selected.size === 1 ? '' : 's'}? This cannot be
                  undone.
                  {willPace &&
                    ` Aturi will pace this under Bluesky's ~${HOURLY_POINT_BUDGET.toLocaleString()}/hour write limit, so it may pause partway.`}
                </span>
                <button
                  type="button"
                  onClick={confirmDelete}
                  style={{
                    padding: '0.4rem 0.75rem',
                    background: 'var(--danger)',
                    color: 'var(--text-on-accent)',
                    border: '1px solid var(--danger)',
                    fontFamily: 'var(--font-serif)',
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                  }}
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  onClick={cancelDelete}
                  style={{
                    padding: '0.4rem 0.75rem',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-medium)',
                    fontFamily: 'var(--font-serif)',
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
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

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          border: records.length ? '1px solid var(--border-medium)' : 0,
          background: 'var(--bg-secondary)',
          // One grid for the whole list so the rkey/preview columns align
          // across rows; each row re-adopts these tracks via subgrid.
          display: 'grid',
          gridTemplateColumns: listColumns(editing),
          columnGap: '1rem',
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
                    // Long rkeys wrap within the column instead of being cut
                    // off — the rkey is the record's identity, so losing the
                    // tail to an ellipsis is worse than a two-line row.
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
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
              style={{
                // Span the full grid and hand the shared tracks down to the
                // row's link/label, which lays out the actual cells.
                gridColumn: '1 / -1',
                display: 'grid',
                gridTemplateColumns: 'subgrid',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              {editing ? (
                // Selection mode: the row becomes a checkbox label so clicking
                // anywhere toggles selection (native), and navigation is
                // suppressed while the visitor is choosing what to delete.
                <label
                  style={{
                    display: 'grid',
                    gridColumn: '1 / -1',
                    gridTemplateColumns: 'subgrid',
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
                    gridColumn: '1 / -1',
                    gridTemplateColumns: 'subgrid',
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
      </AppearIn>
    </div>
  );
}


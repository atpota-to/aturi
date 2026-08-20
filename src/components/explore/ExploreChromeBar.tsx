'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Check, ChevronUp, FilePenLine, Link2, Search, Trash2, X } from 'lucide-react';
import { resolveSearchPathAsync } from '@/utils/atproto/searchRouting';
import { getReduceMotionSnapshot } from '@/lib/a11y';
import { useChromeBar, type ChromeBarAction } from './ChromeBarContext';
import { useEditBar, type EditBarSnapshot } from './EditBarContext';
import { useIsNarrow } from './useIsNarrow';
import { CHROME_OCCLUSION_PX, NAV_OCCLUSION_PX } from './useOffscreen';
import DeleteProgressBar from './DeleteProgressBar';

/**
 * Routes under /explore that are entry points rather than explorer views:
 * the section landings, whose whole job is one big search box and some
 * recommendations. There's nothing on them to filter, nothing to copy a
 * deep link to, and their own search is the first thing you see — a second
 * one floating over the bottom of the page is noise. Everything below these
 * (a repo, a collection, a record, a lexicon, a namespace, a PDS) is
 * somewhere you've navigated *to*, and gets the bar.
 */
const LANDING_PATHS = new Set(['/explore', '/explore/lexicons']);

/** True on the landing routes above. Tolerates a trailing slash. */
function isLandingPath(pathname: string): boolean {
  const normalized =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return LANDING_PATHS.has(normalized);
}

/**
 * How many bars are currently mounted. Normally one, but <PageTransition>'s
 * AnimatePresence keeps the outgoing route alive through the crossfade, so
 * during a navigation there are two — and React runs the departing one's
 * cleanup *after* the arriving one's effect. Counting them is what keeps
 * that cleanup from stripping the body's height reservation off a page that
 * still has a bar, which would drop the footer under it until the next
 * reload.
 */
let mountedBars = 0;

/**
 * Thin bar pinned to the bottom of the viewport on every explorer route, so
 * the two things you always want are one reach away instead of a scroll away:
 *
 *   - Left: the find action for wherever you are. Routes publish it through
 *     <ChromeBarProvider> — "Filter lexicons…" on a repo, "Search records…"
 *     in a collection, "Search repos…" on a PDS — and it stays in lockstep
 *     with the in-page control when there is one. Routes with nothing to
 *     filter (a single record, a lexicon page) fall back to the global jump
 *     search, which resolves a handle / DID / at:// URI / URL the same way
 *     the header's search does.
 *   - Middle: whatever the page can do to itself — the "Edit" affordance, and
 *     on a collection the whole bulk-selection toolbar (select, deselect,
 *     delete, and the confirm / in-flight steps that follow). These appear
 *     only while the in-page originals are off screen, so the same button is
 *     never on screen twice.
 *   - Right: copy the link to the page you're on.
 *
 * A phone can't fit a toolbar and a search field on one line, so there the
 * selection controls expand upward out of the bar as a panel — the mirror of
 * the nav's menu expanding downward out of the header.
 *
 * The bar reserves its own height as padding on <body> (see
 * `.has-explore-chrome` in globals.css), so it never covers the end of a
 * list or the site footer. The panel is deliberately left out of that
 * measurement: like the nav's, it floats over the page rather than pushing
 * it around.
 */
export default function ExploreChromeBar() {
  const { field, action } = useChromeBar();
  const { bar } = useEditBar();
  const narrow = useIsNarrow();
  const pathname = usePathname();
  const [panelOpen, setPanelOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // The layout wraps every /explore route, so the landing pages opt out from
  // here rather than by not rendering the bar.
  const hidden = isLandingPath(pathname);

  // Reserve the bar's real height at the bottom of the document — measured,
  // not assumed, since the row wraps to two lines on narrow screens. The CSS
  // fallback covers first paint (and any browser without ResizeObserver).
  // Keyed on `hidden` so the reservation follows the bar on and off the
  // landing routes.
  useEffect(() => {
    const node = barRef.current;
    if (!node) return undefined;
    const root = document.documentElement;
    mountedBars += 1;
    document.body.classList.add('has-explore-chrome');
    const apply = () => {
      root.style.setProperty('--explore-chrome-h', `${node.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => {
      observer.disconnect();
      mountedBars -= 1;
      // Hand the space back only when the last bar goes.
      if (mountedBars === 0) {
        document.body.classList.remove('has-explore-chrome');
        root.style.removeProperty('--explore-chrome-h');
      }
    };
  }, [hidden]);

  // Where the selection controls live: inline on a roomy viewport, in the
  // expanding panel on a phone.
  const inPanel = narrow && !!bar;

  // Nothing left to show (selection mode ended, or the viewport grew and the
  // controls went back inline) — don't leave an empty panel hanging open.
  useEffect(() => {
    if (!inPanel) setPanelOpen(false);
  }, [inPanel]);

  // A confirm prompt or a running delete must never sit behind a closed
  // toggle, so the panel opens itself for them.
  const midStep = !!bar && (bar.confirming || bar.deleting);
  useEffect(() => {
    if (inPanel && midStep) setPanelOpen(true);
  }, [inPanel, midStep]);

  // Click-outside and Escape dismiss the panel, matching the nav's menu.
  // Mid-step it stays put: Cancel and Stop are the ways out of those, and
  // losing the prompt to a stray tap would be worse than a sticky panel.
  useEffect(() => {
    if (!panelOpen || midStep) return undefined;
    const onPointerDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [panelOpen, midStep]);

  // On a roomy viewport a confirm prompt or an in-flight delete owns the
  // whole row: it's a moment that needs the words, and searching mid-delete
  // isn't a thing anyone does.
  const takeover = !narrow && midStep;

  // Below every hook above, which all have to run either way.
  if (hidden) return null;

  return (
    // Structured to mirror the compact header: a container-narrow shell, a
    // relative anchor for the panel, and the card itself — so the two ends of
    // the screen are the same object, one stuck to the top and one to the
    // bottom.
    <div ref={barRef} className="explore-chrome-bar">
      <div className="container-narrow explore-chrome-shell">
        <div className="explore-chrome-anchor">
          {inPanel && bar && <ChromePanel open={panelOpen} bar={bar} />}
          <div className="explore-chrome-card">
            <div className="explore-chrome-inner">
              {takeover && bar ? (
                <DeleteSteps bar={bar} />
              ) : (
                <>
                  {field ? <RouteField key="route" /> : <JumpField key="jump" />}
                  {bar && !inPanel && <SelectionControls bar={bar} />}
                  {inPanel && bar && (
                    <PanelToggle
                      open={panelOpen}
                      bar={bar}
                      onClick={() => setPanelOpen((v) => !v)}
                    />
                  )}
                  {action && <ActionButton action={action} />}
                  <CopyLinkButton />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The phone-width entry point to the selection controls. Carries the count on
 * its face so leaving the panel closed doesn't mean losing track of what's
 * selected.
 */
function PanelToggle({
  open,
  bar,
  onClick,
}: {
  open: boolean;
  bar: EditBarSnapshot;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} selection controls, ${bar.selectedCount} selected`}
      title="Selection controls"
      className="explore-chrome-button explore-chrome-toggle"
      data-open={open || undefined}
    >
      <ChevronUp size={13} aria-hidden />
      <span aria-hidden>{bar.selectedCount}</span>
    </button>
  );
}

/**
 * The selection controls, expanding up out of the bar the way the nav's menu
 * expands down out of the header. One row where it can be: the safe controls
 * share the width, and delete is deliberately the smallest target of the four
 * and set apart from them — it's the one control here a thumb should have to
 * mean. `inert` while closed so the collapsed rows stay out of the tab order
 * and the a11y tree.
 */
function ChromePanel({ open, bar }: { open: boolean; bar: EditBarSnapshot }) {
  const selectAllDisabled = bar.totalCount === 0 || bar.allSelected;
  const nothingSelected = bar.selectedCount === 0;
  const plural = bar.selectedCount === 1 ? '' : 's';

  return (
    <div className="explore-chrome-panel" data-open={open || undefined} inert={!open}>
      {bar.deleting && bar.progress ? (
        <>
          <span className="explore-chrome-prompt">
            {bar.waitingSec != null
              ? `Paced under the rate limit, resuming in ${bar.waitingSec}s`
              : 'Deleting…'}
          </span>
          <div className="explore-chrome-panel-split">
            <DeleteProgressBar done={bar.progress.done} total={bar.progress.total} compact />
            <button
              type="button"
              onClick={bar.onStop}
              className="explore-chrome-panel-row explore-chrome-panel-row-fit"
            >
              Stop
            </button>
          </div>
        </>
      ) : bar.confirming ? (
        <>
          <span className="explore-chrome-prompt">
            Delete {bar.selectedCount} record{plural}? This can&rsquo;t be undone.
          </span>
          <div className="explore-chrome-panel-split">
            {/* Backing out takes the width; going through with it hugs its
                own label. Same principle as the delete chip below. */}
            <button
              type="button"
              onClick={bar.onCancelDelete}
              className="explore-chrome-panel-row"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={bar.onConfirmDelete}
              className="explore-chrome-panel-row explore-chrome-panel-row-fit explore-chrome-danger-solid"
            >
              Confirm delete
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="explore-chrome-panel-split">
            {/* Short labels so three fit across; the counts they'd otherwise
                carry are on the toggle and the delete row. */}
            <button
              type="button"
              onClick={bar.onSelectAll}
              disabled={selectAllDisabled}
              title={`Select all ${bar.totalCount} shown`}
              aria-label={`Select all ${bar.totalCount} shown`}
              className="explore-chrome-panel-row"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={bar.onDeselectAll}
              disabled={nothingSelected}
              title="Clear the selection"
              aria-label="Deselect all"
              className="explore-chrome-panel-row"
            >
              Deselect
            </button>
            <button
              type="button"
              onClick={bar.onDone}
              title="Leave selection mode"
              className="explore-chrome-panel-row"
            >
              <X size={13} aria-hidden />
              Done
            </button>
            {/* The smallest thing in the panel, held off from the rest. Its
                words live in the accessible name — the icon and the colour
                carry it on screen, and the confirm step spells it out before
                anything happens. */}
            <button
              type="button"
              onClick={bar.onRequestDelete}
              disabled={nothingSelected}
              title={
                nothingSelected
                  ? 'Delete selected records'
                  : `Delete ${bar.selectedCount} selected record${plural}`
              }
              aria-label={
                nothingSelected
                  ? 'Delete selected records'
                  : `Delete ${bar.selectedCount} selected record${plural}`
              }
              className="explore-chrome-panel-row explore-chrome-panel-row-tight explore-chrome-danger"
            >
              <Trash2 size={13} aria-hidden />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Distance from the nav to leave above the list once it's been scrolled to,
 * so its first row doesn't sit flush against the nav's lower edge.
 */
const REVEAL_GAP_PX = 12;

/**
 * A scroll that's already running has a moment before the page catches up
 * with it. Ignore reveals inside that window rather than restarting the
 * animation on every keystroke.
 */
const REVEAL_COOLDOWN_MS = 500;

/**
 * How long a reveal keeps its grip on the page. One scrollTo is not enough:
 * the keystroke that triggered it also re-renders the list, and a repo page
 * is often still streaming in its profile card and its stats — anything that
 * changes height above the list moves the place we were aiming for, and the
 * browser re-anchoring to the shift can throw the page back where it
 * started. So the reveal keeps checking until the page comes to rest on
 * target, and gives up after this long rather than hanging on to a page that
 * won't settle.
 */
const REVEAL_SETTLE_MS = 1200;

/** Off-by-this-much from the target is close enough to stop correcting. */
const REVEAL_TOLERANCE_PX = 4;

/**
 * How far you're allowed to have read into the list — a few rows — before the
 * next keystroke counts as typing blind and pulls you back to the top of it.
 * Without this the reveal fights you: it lands the list's first row just
 * under the nav, so scrolling a single row further and typing again would
 * snap you straight back.
 */
const REVEAL_SLACK_PX = 160;

/**
 * Where the sticky nav ends, measured rather than assumed: it grows by a row
 * when the condensed breadcrumb drops into it, and a list scrolled to the
 * constant alone would have its first line clipped. Falls back to the
 * constant on a route without that nav.
 */
function navBottom(): number {
  const nav = document.querySelector('.compact-header');
  const bottom = nav ? nav.getBoundingClientRect().bottom : 0;
  return Math.max(NAV_OCCLUSION_PX, Math.round(bottom));
}

/**
 * Scrolls `el` to just under the nav and holds it there while the page
 * settles, returning a function that lets go early.
 *
 * The holding is the point. Between the scroll starting and the page coming
 * to rest, the list re-renders under the new filter and any still-loading
 * block above it can arrive — so the target moves, and a single scroll lands
 * short or, when the browser re-anchors to the shift, snaps back where it
 * came from. Each frame the page is at rest, we re-measure and correct;
 * once it's at rest on target, we're done. A wheel, a touch, or a click is
 * the visitor taking the page back, and ends it immediately.
 */
function holdInView(el: HTMLElement): () => void {
  const behavior = getReduceMotionSnapshot() ? 'auto' : 'smooth';
  const deadline = Date.now() + REVEAL_SETTLE_MS;
  let frame = 0;
  let lastY = NaN;
  let atRest = 0;

  const release = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('wheel', release);
    window.removeEventListener('touchstart', release);
    window.removeEventListener('pointerdown', release);
  };

  const correct = () => {
    const off = el.getBoundingClientRect().top - navBottom() - REVEAL_GAP_PX;
    if (Math.abs(off) <= REVEAL_TOLERANCE_PX) return true;
    window.scrollTo({ top: Math.max(0, window.scrollY + off), behavior });
    return false;
  };

  const step = () => {
    // Only judge the position while the page is still: mid-animation it is
    // meant to be off target, and correcting then would restart the scroll
    // every frame and never arrive.
    const y = window.scrollY;
    atRest = y === lastY ? atRest + 1 : 0;
    lastY = y;
    if (atRest >= 2) {
      if (correct()) return release();
      atRest = 0;
    }
    if (Date.now() > deadline) return release();
    frame = requestAnimationFrame(step);
  };

  window.addEventListener('wheel', release, { passive: true });
  window.addEventListener('touchstart', release, { passive: true });
  window.addEventListener('pointerdown', release);
  correct();
  frame = requestAnimationFrame(step);
  return release;
}

/**
 * Brings the list a bar field narrows into view. Typing in a bar pinned to
 * the bottom of the screen otherwise means filtering results you can't see:
 * you'd be somewhere down a long collection, or at the foot of a repo's
 * lexicons, watching nothing change.
 *
 * Only moves when the start of the list is outside the band between the nav
 * and the bar — the same band <useOffscreen> calls "on screen", opened up at
 * the top by the slack above. So the first keystroke pulls the list under the
 * nav (up or down, whichever way you've drifted) and the rest of the query
 * leaves the page where you put it.
 */
function useRevealResults(resultsId: string | undefined) {
  const lastRevealRef = useRef(0);
  const releaseRef = useRef<(() => void) | null>(null);

  // A reveal outlives the keystroke that started it, so a bar that goes away
  // mid-flight — a route change, a tab switch — takes its listeners with it.
  useEffect(() => () => releaseRef.current?.(), []);

  return useCallback(() => {
    if (!resultsId) return;
    const el = document.getElementById(resultsId);
    if (!el) return;

    const now = Date.now();
    if (now - lastRevealRef.current < REVEAL_COOLDOWN_MS) return;

    const { top } = el.getBoundingClientRect();
    const floor = navBottom();
    const ceiling = window.innerHeight - CHROME_OCCLUSION_PX;
    if (top >= floor - REVEAL_SLACK_PX && top <= ceiling) return;

    lastRevealRef.current = now;
    releaseRef.current?.();
    releaseRef.current = holdInView(el);
  }, [resultsId]);
}

/**
 * The route's own filter/search, driven straight from the published snapshot
 * so typing here and typing in the in-page control are the same edit.
 */
function RouteField() {
  const { field } = useChromeBar();
  const inputRef = useRef<HTMLInputElement>(null);
  const revealResults = useRevealResults(field?.resultsId);
  if (!field) return null;

  return (
    <FieldForm
      inputRef={inputRef}
      label={field.label}
      placeholder={field.placeholder}
      value={field.value}
      status={field.status}
      onChange={(next) => {
        field.onChange(next);
        revealResults();
      }}
      onSubmit={() => field.onSubmit?.()}
      onClear={() => {
        field.onChange('');
        inputRef.current?.focus();
      }}
    />
  );
}

/**
 * Fallback for routes with no list to narrow — a single record, a lexicon,
 * the explorer landing. Same routing as the header search: handles, DIDs,
 * at:// URIs, and client URLs all resolve to their explorer page.
 */
function JumpField() {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards a second Enter while an unrecognized URL is being resolved
  // through /api/at-tags.
  const resolvingRef = useRef(false);

  // A landed navigation is the end of that query — don't leave it sitting in
  // the bar on the page it took you to.
  useEffect(() => {
    setValue('');
  }, [pathname]);

  async function submit() {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    try {
      const path = await resolveSearchPathAsync(value);
      if (path) router.push(path);
    } finally {
      resolvingRef.current = false;
    }
  }

  return (
    <FieldForm
      inputRef={inputRef}
      label="Go to a handle, DID, or at:// URI"
      placeholder="Go to handle, DID, at:// URI…"
      value={value}
      onChange={setValue}
      onSubmit={submit}
      onClear={() => {
        setValue('');
        inputRef.current?.focus();
      }}
    />
  );
}

function FieldForm({
  inputRef,
  label,
  placeholder,
  value,
  status,
  onChange,
  onSubmit,
  onClear,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  label: string;
  placeholder: string;
  value: string;
  status?: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  return (
    <form
      role="search"
      aria-label={label}
      className="explore-chrome-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Search size={13} aria-hidden className="explore-chrome-search-icon" />
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Escape clears rather than closes — the bar is permanent chrome,
          // so there's nothing to dismiss.
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onClear();
          }
        }}
        className="explore-chrome-input"
      />
      {status && (
        // Read as one unit so a mid-type update doesn't get announced
        // digit by digit.
        <span aria-live="polite" aria-atomic className="explore-chrome-status">
          {status}
        </span>
      )}
      {value && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear"
          title="Clear"
          className="explore-chrome-clear"
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </form>
  );
}

/**
 * A page-level affordance the route asked us to keep in reach — the "Edit"
 * button on a collection or a record, published while its in-page twin is
 * scrolled away.
 */
function ActionButton({ action }: { action: ChromeBarAction }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      title={action.title || action.label}
      aria-label={action.title || action.label}
      className="explore-chrome-button"
    >
      <FilePenLine size={13} aria-hidden />
      <span className="explore-chrome-button-label">{action.label}</span>
    </button>
  );
}

/**
 * The bulk-selection toolbar, condensed: what's selected, how to select more
 * or less of it, and the way out. Drives the same handlers as the in-page
 * bar — this is a second set of buttons on one piece of state, not a second
 * selection.
 */
function SelectionControls({ bar }: { bar: EditBarSnapshot }) {
  const selectAllDisabled = bar.totalCount === 0 || bar.allSelected;
  const nothingSelected = bar.selectedCount === 0;
  const countLabel = `${bar.selectedCount} selected`;

  return (
    <>
      <button
        type="button"
        onClick={bar.onSelectAll}
        disabled={selectAllDisabled}
        title={bar.totalCount ? `Select all ${bar.totalCount} shown` : 'Select all shown'}
        className="explore-chrome-button"
      >
        Select
      </button>
      <button
        type="button"
        onClick={bar.onDeselectAll}
        disabled={nothingSelected}
        title="Clear the selection"
        className="explore-chrome-button"
      >
        Deselect
      </button>
      {/* The count is the one thing here that isn't recoverable from the
          buttons, so it survives longest before the narrow-screen rules
          start hiding labels. */}
      <span className="explore-chrome-count" aria-live="polite" aria-atomic>
        {countLabel}
      </span>
      <button
        type="button"
        onClick={bar.onRequestDelete}
        disabled={nothingSelected}
        title={
          bar.selectedCount
            ? `Delete ${bar.selectedCount} selected record${bar.selectedCount === 1 ? '' : 's'}`
            : 'Delete selected records'
        }
        aria-label={
          bar.selectedCount
            ? `Delete ${bar.selectedCount} selected record${bar.selectedCount === 1 ? '' : 's'}`
            : 'Delete selected records'
        }
        className="explore-chrome-button explore-chrome-danger"
      >
        <Trash2 size={13} aria-hidden />
      </button>
      <button
        type="button"
        onClick={bar.onDone}
        title="Leave selection mode"
        className="explore-chrome-button"
      >
        <X size={13} aria-hidden />
        <span className="explore-chrome-button-label">Done</span>
      </button>
    </>
  );
}

/**
 * The two steps that follow a delete request — confirm, then the run itself
 * with its progress and a way to stop. Both take the full row.
 */
function DeleteSteps({ bar }: { bar: EditBarSnapshot }) {
  if (bar.deleting && bar.progress) {
    return (
      <>
        <span className="explore-chrome-prompt">
          {bar.waitingSec != null
            ? `Paced under the rate limit, resuming in ${bar.waitingSec}s`
            : 'Deleting…'}
        </span>
        <DeleteProgressBar done={bar.progress.done} total={bar.progress.total} compact />
        <button type="button" onClick={bar.onStop} className="explore-chrome-button">
          Stop
        </button>
      </>
    );
  }

  return (
    <>
      <span className="explore-chrome-prompt">
        Delete {bar.selectedCount} record{bar.selectedCount === 1 ? '' : 's'}? This
        can&rsquo;t be undone.
      </span>
      <button
        type="button"
        onClick={bar.onConfirmDelete}
        className="explore-chrome-button explore-chrome-danger-solid"
      >
        Confirm delete
      </button>
      <button type="button" onClick={bar.onCancelDelete} className="explore-chrome-button">
        Cancel
      </button>
    </>
  );
}

/** Copies the URL of the page you're looking at, query string and all. */
function CopyLinkButton() {
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Drop a stale "Copied" the moment you navigate somewhere else, so the
  // confirmation never reads as applying to the new page.
  useEffect(() => {
    setCopied(false);
  }, [pathname]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const onClick = useCallback(async () => {
    const href = window.location.href;
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      // Restricted clipboard contexts (older Safari, insecure origins) still
      // support the legacy selection-based copy.
      const ta = document.createElement('textarea');
      ta.value = href;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }, []);

  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? 'Copied!' : 'Copy link to this page'}
      aria-label={copied ? 'Page link copied' : 'Copy link to this page'}
      className="explore-chrome-button explore-chrome-copy"
      data-copied={copied || undefined}
    >
      {copied ? <Check size={13} aria-hidden /> : <Link2 size={13} aria-hidden />}
      <span className="explore-chrome-button-label">{copied ? 'Copied' : 'Copy link'}</span>
    </button>
  );
}

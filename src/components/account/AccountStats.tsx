'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Boxes,
  CalendarDays,
  Database,
  Download,
  Gauge,
  HardDrive,
  History,
  Link as LinkIcon,
} from 'lucide-react';
import {
  describeRepo,
  getLatestCommit,
  getRepoSize,
} from '@/utils/atproto/pdsClient';
import { tidToDate, formatTidRelative } from '@/utils/atproto/tid';
import { getPlcAuditLog, type PlcAuditEntry } from '@/utils/atproto/plc';
import { resolveIdentifier } from '@/utils/atproto/identity';
import {
  flattenSources,
  getBacklinkSources,
} from '@/utils/atproto/constellation';
import { fetchCachedCredBlueScore, type CredBlueScore } from '@/utils/credBlueScore';
import { CRED_BLUE_BASE } from '@/utils/atproto/config';

type Props = {
  did: string;
  /** Optional handle — when present, drives the cred.blue tile fetch + link. */
  handle?: string | null;
  /**
   * When false (the marketing/demo callers on the homepage strip),
   * the cred.blue tile is rendered as a non-clickable preview and
   * the per-tile `title` tooltips are suppressed. The real account
   * and explorer pages leave this at its default `true` so visitors
   * can still navigate to cred.blue and read the hint hover text.
   */
  interactive?: boolean;
};

type Stats = {
  namespaces: number;      // unique 2-segment NSID prefixes (e.g. "net.anisota")
  collections: number;     // total distinct NSIDs / record types
  auditOps: number | null; // PLC operations count — null for non-did:plc
  createdAt: string | null;
  backlinks: number | null; // inbound atproto references via Constellation
  headRev: string | null;  // repo head commit rev (TID) — drives "last active"
};

/**
 * High-level repo stats shown on the account page. Pulls from three public
 * sources in parallel:
 *
 *   - describeRepo → namespace + lexicon counts.
 *   - PLC audit log → operation count + create timestamp (did:plc only).
 *   - Constellation → total inbound backlink count.
 *
 * Each fetch is independent; one failure doesn't block the others. The repo
 * size tile is the exception — it downloads the full repo CAR and so is only
 * measured on an explicit button press, never on load (see `RepoSizeTile`).
 */
export default function AccountStats({ did, handle, interactive = true }: Props) {
  // Both stats and the cred.blue score are keyed by their inputs, so when
  // the account changes the derived values below reset on their own — no
  // synchronous reset-setState inside the effects.
  const [statsEntry, setStatsEntry] = useState<
    { did: string; stats: Stats | null; error: string | null } | null
  >(null);
  const [credBlueEntry, setCredBlueEntry] = useState<
    { id: string; score: CredBlueScore | null } | null
  >(null);

  const stats = statsEntry && statsEntry.did === did ? statsEntry.stats : null;
  const error = statsEntry && statsEntry.did === did ? statsEntry.error : null;
  const credBlueId = handle || did;
  const credBlue: { status: 'loading' } | { status: 'ready'; score: CredBlueScore | null } =
    credBlueEntry && credBlueEntry.id === credBlueId
      ? { status: 'ready', score: credBlueEntry.score }
      : { status: 'loading' };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // We need the user's PDS URL — resolve via the same path the
        // explorer uses (PLC → service endpoint).
        const identity = await resolveIdentifier(did);
        if (cancelled) return;

        // Kick off each request independently; failures degrade.
        const [describe, audit, backlinkSources, latestCommit] =
          await Promise.allSettled([
            describeRepo(identity.pds, identity.did),
            did.startsWith('did:plc:')
              ? getPlcAuditLog(did)
              : Promise.resolve<PlcAuditEntry[] | null>(null),
            getBacklinkSources(did),
            getLatestCommit(identity.pds, identity.did),
          ]);
        if (cancelled) return;

        const collections =
          describe.status === 'fulfilled' && Array.isArray(describe.value.collections)
            ? describe.value.collections
            : [];
        // Group by the first 2 NSID segments (the reverse-domain root) so the
        // count matches the Lexicons tab's major-group hierarchy: app.bsky,
        // net.anisota, is.dame, etc.
        const namespaces = new Set(
          collections.map((nsid) => {
            const segs = nsid.split('.');
            return segs.length >= 2 ? `${segs[0]}.${segs[1]}` : nsid;
          }),
        );

        const auditEntries =
          audit.status === 'fulfilled' && Array.isArray(audit.value) ? audit.value : null;

        const flat =
          backlinkSources.status === 'fulfilled'
            ? flattenSources(backlinkSources.value)
            : null;
        const backlinks = flat ? flat.reduce((acc, s) => acc + (s.count || 0), 0) : null;

        const headRev =
          latestCommit.status === 'fulfilled' && latestCommit.value.rev
            ? latestCommit.value.rev
            : null;

        setStatsEntry({
          did,
          error: null,
          stats: {
            namespaces: namespaces.size,
            collections: collections.length,
            auditOps: auditEntries ? auditEntries.length : null,
            createdAt:
              auditEntries && auditEntries.length > 0 ? auditEntries[0].createdAt : null,
            backlinks,
            headRev,
          },
        });
      } catch (err) {
        if (!cancelled)
          setStatsEntry({ did, stats: null, error: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [did]);

  useEffect(() => {
    let cancelled = false;
    const identifier = handle || did;
    fetchCachedCredBlueScore(identifier).then((score) => {
      if (!cancelled) setCredBlueEntry({ id: identifier, score });
    });
    return () => {
      cancelled = true;
    };
  }, [handle, did]);

  // Plain computation — the React Compiler memoizes these itself, and the
  // manual useMemo wrappers made it bail ("could not preserve existing
  // manual memoization") once `stats` became a derived value.
  // Month + year only ("Aug 2023"). The tile is narrow in the 2-column
  // mobile grid, and the relative age sublabel already carries the
  // finer-grained "how long ago" — a full day-level date just wrapped.
  let createdLabel: string | null = null;
  let createdRelative: string | null = null;
  if (stats?.createdAt) {
    try {
      const d = new Date(stats.createdAt);
      createdLabel = d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
      });
      createdRelative = relativeAge(d);
    } catch {
      // Unparseable timestamp — leave both labels empty.
    }
  }

  // Decode the head commit rev (a TID) into the account's last-active time.
  // Cheap pure call; no memo needed (and avoids the compiler bail the other
  // tile memos in this file already trip).
  const lastActiveDate = stats?.headRev ? tidToDate(stats.headRev) : null;

  if (error) {
    return (
      <p
        className="explore-muted"
        style={{ fontSize: '0.8125rem', margin: 0 }}
      >
        Couldn&rsquo;t load account stats: {error}
      </p>
    );
  }

  return (
    <section className="account-stats-grid">
      <StatTile
        icon={<Boxes size={16} />}
        label="Namespaces"
        hint="Unique top-level NSID prefixes (e.g. net.anisota, app.bsky)"
        value={stats?.namespaces}
        interactive={interactive}
      />
      <StatTile
        icon={<Database size={16} />}
        label="Lexicons"
        hint="Distinct record types / collections across all namespaces"
        value={stats?.collections}
        interactive={interactive}
      />
      <StatTile
        icon={<History size={16} />}
        label="Audit changes"
        hint="PLC operations recorded against this DID"
        value={stats?.auditOps ?? undefined}
        unavailable={stats !== null && stats.auditOps === null}
        interactive={interactive}
      />
      <StatTile
        icon={<LinkIcon size={16} />}
        label="Backlinks"
        hint="Records across the Atmosphere pointing at this DID"
        value={stats?.backlinks ?? undefined}
        unavailable={stats !== null && stats.backlinks === null}
        interactive={interactive}
      />
      <StatTile
        icon={<CalendarDays size={16} />}
        label="Created"
        hint="Earliest PLC operation timestamp"
        valueLabel={createdLabel || (stats !== null && !createdLabel ? '—' : undefined)}
        sublabel={createdRelative || undefined}
        interactive={interactive}
      />
      {/* Score sits directly after Created so the two pair up on the same row
          in the 2-column mobile grid; Last active + Repo size then pair up on
          the final row. */}
      <CredBlueTile
        state={credBlue}
        handle={handle || did}
        interactive={interactive}
      />
      <StatTile
        icon={<Activity size={16} />}
        label="Last active"
        hint={
          lastActiveDate
            ? `Repo's most recent commit · ${lastActiveDate.toISOString()}`
            : "Timestamp of the repo's most recent commit (head rev)"
        }
        valueLabel={lastActiveDate ? formatTidRelative(lastActiveDate) : undefined}
        unavailable={stats !== null && lastActiveDate === null}
        interactive={interactive}
      />
      {/* The one stat that isn't fetched on load — measuring it downloads the
          full repo CAR, so it stays behind an explicit button. Keyed on `did`
          so switching repos resets it to idle (and unmounts the old fetch). */}
      <RepoSizeTile key={did} did={did} interactive={interactive} />
    </section>
  );
}

function CredBlueTile({
  state,
  handle,
  interactive,
}: {
  state: { status: 'loading' } | { status: 'ready'; score: CredBlueScore | null };
  handle: string;
  interactive: boolean;
}) {
  // Only emit an href when the tile is actually meant to be clickable
  // — non-interactive demos drop it so StatTile renders a plain div.
  const href = interactive
    ? `${CRED_BLUE_BASE}/${encodeURIComponent(handle.replace(/^@/, ''))}`
    : undefined;
  const icon = <Gauge size={16} />;
  const label = 'Score';

  if (state.status === 'loading') {
    return <StatTile icon={icon} label={label} href={href} interactive={interactive} />;
  }
  if (!state.score) {
    return (
      <StatTile
        icon={icon}
        label={label}
        hint="This account hasn't been scored yet on cred.blue — click to generate one."
        href={href}
        valueLabel="—"
        sublabel="not scored yet"
        interactive={interactive}
      />
    );
  }
  const { combined, bluesky, atproto } = state.score.scores;
  return (
    <StatTile
      icon={icon}
      label={label}
      hint={`Bluesky ${bluesky.toLocaleString()} · ATProto ${atproto.toLocaleString()}`}
      href={href}
      value={combined}
      sublabel={`bsky ${bluesky.toLocaleString()} · atp ${atproto.toLocaleString()}`}
      interactive={interactive}
    />
  );
}

/**
 * Convert a Date in the past into a single coarse phrase ("3 years old",
 * "2 months old", "12 days old"). Returns the largest unit that fits;
 * keeps it terse so it can sit beneath the absolute date inside a tile.
 */
function relativeAge(then: Date): string {
  const ms = Date.now() - then.getTime();
  if (ms < 0) return 'in the future';
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day old';
  if (days < 30) return `${days} days old`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} old`;
  const years = Math.floor(days / 365);
  const remMonths = Math.floor((days - years * 365) / 30);
  if (remMonths > 0) {
    return `${years} yr ${remMonths} mo old`;
  }
  return `${years} year${years === 1 ? '' : 's'} old`;
}

function StatTile({
  icon,
  label,
  hint,
  value,
  valueLabel,
  sublabel,
  unavailable,
  href,
  interactive = true,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  /** Numeric value — renders with thousands separator. */
  value?: number;
  /** Pre-formatted string — overrides `value` when set. */
  valueLabel?: string;
  /** Optional smaller line beneath the value (e.g. relative age beside a date). */
  sublabel?: string;
  /** When true, render an em-dash to show the source isn't applicable. */
  unavailable?: boolean;
  /** When set, wraps the whole tile in an external link with hover affordance. */
  href?: string;
  /**
   * When false, the tile drops its native `title` tooltip so demo
   * surfaces don't surface "click to generate one" hover popups for
   * tiles the visitor can't actually click. Has no effect on the
   * href path because callers strip href separately for those tiles.
   */
  interactive?: boolean;
}) {
  let display: React.ReactNode;
  if (unavailable) {
    display = (
      <span className="explore-muted" style={{ fontStyle: 'normal' }}>
        —
      </span>
    );
  } else if (valueLabel != null) {
    display = valueLabel;
  } else if (value == null) {
    display = (
      <span
        style={{
          display: 'inline-block',
          width: '3rem',
          height: '0.875rem',
          background: 'var(--bg-tertiary)',
          opacity: 0.6,
        }}
        aria-hidden
      />
    );
  } else {
    display = value.toLocaleString();
  }
  const body = (
    <>
      <TileLabel icon={icon} label={label} />
      <div style={TILE_VALUE_STYLE}>{display}</div>
      {sublabel && <div style={TILE_SUBLABEL_STYLE}>{sublabel}</div>}
    </>
  );

  const titleAttr = interactive ? hint : undefined;

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={titleAttr}
        style={{
          ...TILE_BASE_STYLE,
          color: 'inherit',
          textDecoration: 'none',
          transition: 'border-color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--text-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-medium)';
        }}
      >
        {body}
      </a>
    );
  }

  return (
    <div title={titleAttr} style={TILE_BASE_STYLE}>
      {body}
    </div>
  );
}

/** Shared tile chrome — the flat card container every stat tile sits in. */
const TILE_BASE_STYLE: React.CSSProperties = {
  padding: '0.75rem 0.875rem',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-medium)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
};

/** The big serif value line (numbers, dates, sizes). */
const TILE_VALUE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontSize: '1.25rem',
  fontWeight: 400,
  color: 'var(--text-primary)',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.1,
  // Keep short values (esp. the "Aug 2023" date) on one line instead of
  // breaking at the space in the narrow mobile tiles.
  whiteSpace: 'nowrap',
};

/** The small mono sublabel under the value (relative age, exact bytes). */
const TILE_SUBLABEL_STYLE: React.CSSProperties = {
  fontSize: '0.7rem',
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-mono)',
  marginTop: '-0.15rem',
};

/** The icon + small-caps label row shared by every tile. */
function TileLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div
      className="explore-small-caps"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        color: 'var(--text-tertiary)',
      }}
    >
      {/* inline-flex so the wrapper hugs the 16px glyph instead of inheriting
          the inline SVG's descender space — otherwise the icon box is taller
          than the icon and align-items:center pushes it optically above the
          label text. */}
      <span style={{ display: 'inline-flex', color: 'var(--text-accent)' }}>
        {icon}
      </span>
      <span>{label}</span>
    </div>
  );
}

type RepoSizeState =
  | { status: 'idle' }
  | { status: 'loading'; bytes: number }
  | { status: 'ready'; bytes: number }
  | { status: 'error'; message: string };

/**
 * Repo-size tile — the one stat that isn't fetched on page load. Measuring it
 * means downloading the account's entire repo export (com.atproto.sync.getRepo,
 * a CAR file that can run to many MB), so it stays behind an explicit button.
 * On click we resolve the PDS, stream the CAR, and count bytes as they arrive
 * — the value ticks up live, then settles on the exact size.
 *
 * The in-flight download is tied to an AbortController so switching repos (or
 * unmounting) cancels it instead of leaking the fetch and updating dead state.
 * Non-interactive demo surfaces (the homepage strip) render the button as an
 * inert preview so a marketing card never kicks off a multi-MB download.
 */
function RepoSizeTile({ did, interactive }: { did: string; interactive: boolean }) {
  const [state, setState] = useState<RepoSizeState>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  // Throttle the live counter to ~one paint per 256 KB downloaded — a large
  // CAR streams in thousands of small chunks and a setState per chunk would
  // thrash. The final size still comes from the exact total getRepoSize returns.
  const lastShownRef = useRef(0);

  // Abort an in-flight download if the tile unmounts — the parent re-keys this
  // component on `did`, so switching repos unmounts the old one and stops it
  // pulling a multi-MB CAR (and updating dead state) mid-stream.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function measure() {
    if (state.status === 'loading') return;
    const controller = new AbortController();
    abortRef.current = controller;
    lastShownRef.current = 0;
    setState({ status: 'loading', bytes: 0 });
    try {
      const identity = await resolveIdentifier(did);
      const bytes = await getRepoSize(identity.pds, identity.did, {
        signal: controller.signal,
        onProgress: (b) => {
          if (controller.signal.aborted) return;
          if (b - lastShownRef.current >= 262_144) {
            lastShownRef.current = b;
            setState({ status: 'loading', bytes: b });
          }
        },
      });
      if (!controller.signal.aborted) setState({ status: 'ready', bytes });
    } catch (err) {
      if (controller.signal.aborted) return;
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let content: React.ReactNode;
  let titleAttr: string | undefined;
  if (state.status === 'ready') {
    content = (
      <>
        <div style={TILE_VALUE_STYLE}>{formatBytes(state.bytes)}</div>
        <div style={TILE_SUBLABEL_STYLE}>{state.bytes.toLocaleString()} bytes</div>
      </>
    );
    titleAttr = interactive ? 'Uncompressed size of the full repo CAR' : undefined;
  } else if (state.status === 'loading') {
    content = (
      <>
        <div style={TILE_VALUE_STYLE}>{formatBytes(state.bytes)}</div>
        <div style={TILE_SUBLABEL_STYLE}>downloading CAR…</div>
      </>
    );
  } else if (state.status === 'error') {
    content = (
      <>
        <MeasureButton interactive={interactive} onClick={measure} label="Retry" />
        <div style={TILE_SUBLABEL_STYLE}>couldn&rsquo;t measure</div>
      </>
    );
    titleAttr = interactive ? `Couldn't measure repo: ${state.message}` : undefined;
  } else {
    content = <MeasureButton interactive={interactive} onClick={measure} />;
    titleAttr = interactive
      ? 'Downloads the full repo (com.atproto.sync.getRepo) to measure its CAR size'
      : undefined;
  }

  return (
    <div title={titleAttr} style={TILE_BASE_STYLE}>
      <TileLabel icon={<HardDrive size={16} />} label="Repo size" />
      {content}
    </div>
  );
}

/**
 * The tap target that kicks off (or retries) a repo-size measurement. On
 * non-interactive demo surfaces it renders as an inert, look-alike preview so
 * a marketing card never triggers a real multi-MB download.
 */
function MeasureButton({
  interactive,
  onClick,
  label = 'Measure',
}: {
  interactive: boolean;
  onClick: () => void;
  label?: string;
}) {
  const inner = (
    <>
      <Download size={13} aria-hidden />
      {label}
    </>
  );
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    alignSelf: 'flex-start',
    padding: '0.3rem 0.55rem',
    background: 'transparent',
    border: '1px solid var(--border-medium)',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-serif)',
    fontSize: '0.8rem',
    lineHeight: 1.1,
    cursor: interactive ? 'pointer' : 'default',
    transition: 'border-color 0.2s ease, color 0.2s ease',
  };

  if (!interactive) {
    return (
      <span style={style} aria-hidden>
        {inner}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--text-accent)';
        e.currentTarget.style.color = 'var(--text-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-medium)';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
    >
      {inner}
    </button>
  );
}

/**
 * Human-readable byte size using binary units (1 KB = 1024 B), matching how
 * PDS/repo tooling reports CAR sizes. Shows one decimal from MB up (two for
 * GB) and drops the decimal for whole-ish KB so tiny repos stay tidy.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

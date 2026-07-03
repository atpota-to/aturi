'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Boxes,
  CalendarDays,
  Database,
  Gauge,
  History,
  Link as LinkIcon,
} from 'lucide-react';
import { describeRepo, getLatestCommit } from '@/utils/atproto/pdsClient';
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
 * Each fetch is independent; one failure doesn't block the others.
 */
export default function AccountStats({ did, handle, interactive = true }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credBlue, setCredBlue] = useState<
    { status: 'loading' } | { status: 'ready'; score: CredBlueScore | null }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setError(null);

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

        setStats({
          namespaces: namespaces.size,
          collections: collections.length,
          auditOps: auditEntries ? auditEntries.length : null,
          createdAt:
            auditEntries && auditEntries.length > 0 ? auditEntries[0].createdAt : null,
          backlinks,
          headRev,
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [did]);

  useEffect(() => {
    let cancelled = false;
    setCredBlue({ status: 'loading' });
    const identifier = handle || did;
    fetchCachedCredBlueScore(identifier).then((score) => {
      if (!cancelled) setCredBlue({ status: 'ready', score });
    });
    return () => {
      cancelled = true;
    };
  }, [handle, did]);

  const createdLabel = useMemo(() => {
    if (!stats?.createdAt) return null;
    try {
      const d = new Date(stats.createdAt);
      // Month + year only ("Aug 2023"). The tile is narrow in the 2-column
      // mobile grid, and the relative age sublabel already carries the
      // finer-grained "how long ago" — a full day-level date just wrapped.
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
      });
    } catch {
      return null;
    }
  }, [stats?.createdAt]);

  const createdRelative = useMemo(() => {
    if (!stats?.createdAt) return null;
    try {
      return relativeAge(new Date(stats.createdAt));
    } catch {
      return null;
    }
  }, [stats?.createdAt]);

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
          in the 2-column mobile grid; Last active trails as the lone tile. */}
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
      <div
        className="explore-small-caps"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          color: 'var(--text-tertiary)',
        }}
      >
        {/* inline-flex so the wrapper hugs the 16px glyph instead of
            inheriting the inline SVG's descender space — otherwise the icon
            box is taller than the icon and align-items:center pushes the
            icon optically above the label text. */}
        <span style={{ display: 'inline-flex', color: 'var(--text-accent)' }}>
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <div
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: '1.25rem',
          fontWeight: 400,
          color: 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
          // Keep short values (esp. the "Aug 2023" date) on one line instead
          // of breaking at the space in the narrow mobile tiles.
          whiteSpace: 'nowrap',
        }}
      >
        {display}
      </div>
      {sublabel && (
        <div
          style={{
            fontSize: '0.7rem',
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            marginTop: '-0.15rem',
          }}
        >
          {sublabel}
        </div>
      )}
    </>
  );

  const baseStyle: React.CSSProperties = {
    padding: '0.75rem 0.875rem',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-medium)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
  };

  const titleAttr = interactive ? hint : undefined;

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={titleAttr}
        style={{
          ...baseStyle,
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
    <div title={titleAttr} style={baseStyle}>
      {body}
    </div>
  );
}

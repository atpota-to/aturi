'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  CalendarDays,
  Database,
  History,
  Link as LinkIcon,
} from 'lucide-react';
import { describeRepo } from '@/utils/atproto/pdsClient';
import { getPlcAuditLog, type PlcAuditEntry } from '@/utils/atproto/plc';
import { resolveIdentifier } from '@/utils/atproto/identity';
import {
  flattenSources,
  getBacklinkSources,
} from '@/utils/atproto/constellation';

type Props = {
  did: string;
};

type Stats = {
  namespaces: number;      // unique 2-segment NSID prefixes (e.g. "net.anisota")
  collections: number;     // total distinct NSIDs / record types
  auditOps: number | null; // PLC operations count — null for non-did:plc
  createdAt: string | null;
  backlinks: number | null; // inbound atproto references via Constellation
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
export default function AccountStats({ did }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        const [describe, audit, backlinkSources] = await Promise.allSettled([
          describeRepo(identity.pds, identity.did),
          did.startsWith('did:plc:')
            ? getPlcAuditLog(did)
            : Promise.resolve<PlcAuditEntry[] | null>(null),
          getBacklinkSources(did),
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

        setStats({
          namespaces: namespaces.size,
          collections: collections.length,
          auditOps: auditEntries ? auditEntries.length : null,
          createdAt:
            auditEntries && auditEntries.length > 0 ? auditEntries[0].createdAt : null,
          backlinks,
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [did]);

  const createdLabel = useMemo(() => {
    if (!stats?.createdAt) return null;
    try {
      const d = new Date(stats.createdAt);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
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
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
        gap: '0.5rem',
      }}
    >
      <StatTile
        icon={<Boxes size={16} />}
        label="Namespaces"
        hint="Unique top-level NSID prefixes (e.g. net.anisota, app.bsky)"
        value={stats?.namespaces}
      />
      <StatTile
        icon={<Database size={16} />}
        label="Lexicons"
        hint="Distinct record types / collections across all namespaces"
        value={stats?.collections}
      />
      <StatTile
        icon={<History size={16} />}
        label="Audit changes"
        hint="PLC operations recorded against this DID"
        value={stats?.auditOps ?? undefined}
        unavailable={stats !== null && stats.auditOps === null}
      />
      <StatTile
        icon={<LinkIcon size={16} />}
        label="Inbound links"
        hint="Records across the Atmosphere pointing at this DID"
        value={stats?.backlinks ?? undefined}
        unavailable={stats !== null && stats.backlinks === null}
      />
      <StatTile
        icon={<CalendarDays size={16} />}
        label="Account created"
        hint="Earliest PLC operation timestamp"
        valueLabel={createdLabel || (stats !== null && !createdLabel ? '—' : undefined)}
        sublabel={createdRelative || undefined}
      />
    </section>
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
  return (
    <div
      title={hint}
      style={{
        padding: '0.75rem 0.875rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
      }}
    >
      <div
        className="explore-small-caps"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          color: 'var(--text-tertiary)',
        }}
      >
        <span style={{ color: 'var(--text-accent)' }}>{icon}</span>
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
    </div>
  );
}

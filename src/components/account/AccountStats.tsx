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
  collections: number;     // unique top-level namespaces (e.g. "app.bsky.feed")
  lexicons: number;        // total distinct NSIDs (e.g. "app.bsky.feed.post")
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
        const lexicons = collections.length;
        const namespaces = new Set(
          collections.map((nsid) => {
            const lastDot = nsid.lastIndexOf('.');
            return lastDot > 0 ? nsid.slice(0, lastDot) : nsid;
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
          collections: namespaces.size,
          lexicons,
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
        label="Collections"
        hint="Distinct top-level namespaces (e.g. app.bsky.feed)"
        value={stats?.collections}
      />
      <StatTile
        icon={<Database size={16} />}
        label="Lexicons"
        hint="Total record types in this repo"
        value={stats?.lexicons}
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
      />
    </section>
  );
}

function StatTile({
  icon,
  label,
  hint,
  value,
  valueLabel,
  unavailable,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  /** Numeric value — renders with thousands separator. */
  value?: number;
  /** Pre-formatted string — overrides `value` when set. */
  valueLabel?: string;
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
    </div>
  );
}

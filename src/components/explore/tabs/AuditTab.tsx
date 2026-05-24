'use client';

import { useEffect, useState } from 'react';
import {
  diffOps,
  formatPlcTime,
  getPlcAuditLog,
  type PlcAuditEntry,
} from '@/utils/atproto/plc';
import type { IdentityBundle } from '@/utils/atproto/identity';

export default function AuditTab({ identity }: { identity: IdentityBundle }) {
  const { did } = identity;
  const isPlc = did.startsWith('did:plc:');
  const [log, setLog] = useState<PlcAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlc) return undefined;
    let cancelled = false;
    setLog(null);
    setError(null);
    getPlcAuditLog(did)
      .then((l) => {
        if (!cancelled) setLog(Array.isArray(l) ? l : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [did, isPlc]);

  if (!isPlc) {
    return (
      <p className="explore-placeholder">
        Audit log only available for <code>did:plc:</code> DIDs.
      </p>
    );
  }
  if (error) return <p className="explore-error">{error}</p>;
  if (!log) return <p className="explore-placeholder">Loading audit log…</p>;
  if (log.length === 0) return <p className="explore-placeholder">No PLC operations recorded.</p>;

  // Newest first; pass the chronologically-previous operation so diffs can
  // surface what changed.
  const ordered = [...log].reverse();

  return (
    <ol
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      {ordered.map((entry, i) => (
        <AuditEntryRow
          key={entry.cid || `${entry.createdAt}-${i}`}
          entry={entry}
          prev={log[log.length - i - 2]}
        />
      ))}
    </ol>
  );
}

function AuditEntryRow({
  entry,
  prev,
}: {
  entry: PlcAuditEntry;
  prev?: PlcAuditEntry;
}) {
  const op = entry.operation || {};
  const type = op.type || (op.prev === null ? 'create' : 'update');
  const changes = diffOps(prev?.operation, op);

  return (
    <li
      style={{
        border: '1px solid var(--border-medium)',
        borderLeft: '3px solid var(--text-accent)',
        background: 'var(--bg-secondary)',
        padding: '0.875rem 1rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.75rem',
        }}
      >
        <span className="explore-small-caps" style={{ color: 'var(--text-secondary)' }}>
          {type}
        </span>
        <time
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
          }}
        >
          {formatPlcTime(entry.createdAt)}
        </time>
      </div>
      {changes.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            margin: '0.5rem 0 0',
            padding: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: '0.85rem',
          }}
        >
          {changes.map((c, idx) => (
            <li key={idx} style={{ padding: '2px 0', color: 'var(--text-secondary)' }}>
              {c}
            </li>
          ))}
        </ul>
      )}
      <details className="explore-raw-details" style={{ marginTop: '0.5rem' }}>
        <summary>Raw operation</summary>
        <pre className="explore-json">{JSON.stringify(entry, null, 2)}</pre>
      </details>
    </li>
  );
}

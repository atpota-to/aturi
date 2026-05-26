/**
 * RecordPreview Component
 * Displays a preview of a generic ATProto record
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { GenericRecord } from '@/utils/recordFetcher';
import { sanitizeHandle } from '@/utils/sanitize';
import { Check, Copy, Telescope } from 'lucide-react';
import { encodeRepo } from '@/utils/atproto/urls';

type RecordPreviewProps = {
  record: GenericRecord;
  collection: string;
  handle: string;
  rkey: string;
  /**
   * When true, suppress the "View Full Record" JSON-modal button and the
   * "Open in Explorer" cross-link. Used inside the explorer's record view,
   * which already shows the raw (linkified) JSON inline and is itself the
   * Explorer destination.
   */
  hideExplorerCtas?: boolean;
};

export default function RecordPreview({
  record,
  collection,
  handle,
  rkey,
  hideExplorerCtas,
}: RecordPreviewProps) {
  const { value, cid } = record;

  // Format the record type nicely
  const recordType = value.$type || collection;
  const displayType = recordType.replace('app.bsky.', '').replace('com.atproto.', '').replace('net.anisota.', '');

  // Get a few key interesting fields to preview (limit to 5-6)
  const allFields = Object.entries(value).filter(
    ([key]) => !key.startsWith('$') && key !== 'createdAt' && key !== 'updatedAt'
  );
  const previewFields = allFields.slice(0, 6);
  const hasMoreFields = allFields.length > 6;

  // Format date if available
  const createdAt = value.createdAt ? new Date(value.createdAt) : null;
  const formattedDate = createdAt
    ? createdAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;


  return (
    <div
      style={{
        marginBottom: '2rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        overflow: 'hidden',
        transform: 'rotate(0.2deg)',
        transition: 'all 0.4s ease',
      }}
      className="card record-preview-card"
    >
        {/* Header: URI Structure. Suppressed inside the explorer, where the
            breadcrumb already shows the at:// segments and the collection
            chip — repeating them here is the redundancy this prop targets. */}
        {!hideExplorerCtas && (
          <div
            style={{
              padding: '1.5rem',
              background: 'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%)',
              borderBottom: '1px solid var(--border-medium)',
            }}
          >
            {/* AT URI Path */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '1rem',
                flexWrap: 'wrap',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.875rem',
              }}
            >
              <span style={{ color: 'var(--text-tertiary)' }}>at://</span>
              <a
                href={`/${sanitizeHandle(handle)}`}
                style={{
                  color: 'var(--text-accent)',
                  fontWeight: '500',
                  textDecoration: 'none',
                  transition: 'opacity 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.7';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1';
                }}
              >
                {handle}
              </a>
              <span style={{ color: 'var(--text-tertiary)' }}>/</span>
              <span style={{ color: 'var(--text-secondary)' }}>{collection}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>/</span>
              <span style={{ color: 'var(--text-tertiary)', opacity: 0.7 }}>{rkey}</span>
            </div>

            {/* Record Type Badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div
                style={{
                  display: 'inline-block',
                  padding: '0.375rem 0.875rem',
                  background: 'var(--glow-subtle)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-accent)',
                  fontSize: '0.8125rem',
                  fontWeight: '600',
                  letterSpacing: '0.03em',
                }}
              >
                {displayType}
              </div>
              {formattedDate && (
                <div style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
                  {formattedDate}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Preview Fields - Simplified */}
        <div style={{ padding: '1.5rem' }}>
          <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
            {previewFields.map(([key, val]) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  gap: '1rem',
                  alignItems: 'flex-start',
                  paddingBottom: '1rem',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <div
                  style={{
                    minWidth: '140px',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--text-tertiary)',
                    paddingTop: '0.125rem',
                  }}
                >
                  {key}
                </div>
                <div
                  style={{
                    flex: 1,
                    color: 'var(--text-primary)',
                    fontSize: '0.9375rem',
                    lineHeight: '1.6',
                    wordBreak: 'break-word',
                    minWidth: 0,
                  }}
                >
                  <FieldValue value={val} />
                </div>
              </div>
            ))}
          </div>

          {/* Single CTA: navigates into the explorer's record page, which
              shows the full record JSON (linkified), backlinks, identity,
              and editing affordances. Replaces the previous \"View Full
              Record\" modal + secondary \"Open in Explorer\" link — one
              click instead of two surfaces. Hidden when we're already
              rendering inside the explorer. */}
          {!hideExplorerCtas && (
            <Link
              href={`/explore/${encodeRepo(handle)}/${collection}/${encodeURIComponent(rkey)}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                width: '100%',
                padding: '0.875rem 1.25rem',
                fontSize: '0.9375rem',
                fontWeight: 400,
                color: 'var(--text-primary)',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-medium)',
                textDecoration: 'none',
                transition: 'all 0.3s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-elevated)';
                e.currentTarget.style.borderColor = 'var(--text-accent)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-tertiary)';
                e.currentTarget.style.borderColor = 'var(--border-medium)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <Telescope size={15} style={{ color: 'var(--text-accent)' }} />
              <span>
                {hasMoreFields
                  ? `View full record (${allFields.length} fields) in Explorer →`
                  : 'View full record in Explorer →'}
              </span>
            </Link>
          )}

          {/* Quick action: grab the raw record JSON without leaving the
              universal link page. Sits beneath the primary CTA as a
              quieter secondary affordance. Hidden inside the explorer —
              the consolidated copy row already covers JSON. */}
          {!hideExplorerCtas && <CopyJsonRow record={record} />}
        </div>

        {/* Footer: CID. Suppressed inside the explorer (CID is in the
            copy row + the raw JSON below). */}
        {cid && !hideExplorerCtas && (
          <div
            style={{
              padding: '1rem 1.5rem',
              background: 'var(--bg-tertiary)',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
              wordBreak: 'break-all',
            }}
          >
            <span style={{ opacity: 0.6, marginRight: '0.5rem' }}>CID:</span>
            {cid}
          </div>
        )}
      </div>

  );
}

async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall through */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
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

/**
 * Recursively renders a record field value. Objects and arrays collapse
 * into a tappable `{N fields}` / `[N items]` summary; expanding reveals
 * the nested key/value pairs (themselves recursive, so deep blobs like
 * `avatar.ref.$link` are reachable). Primitives render inline.
 */
function FieldValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span style={{ color: 'var(--text-tertiary)' }}>null</span>;
  }
  if (typeof value === 'string') {
    const display = value.length > 280 ? `${value.substring(0, 280)}…` : value;
    return <>{display}</>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <>{String(value)}</>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span style={{ color: 'var(--text-tertiary)' }}>[ ]</span>;
    }
    return (
      <details>
        <summary style={nestedSummaryStyle}>{`[${value.length} items]`}</summary>
        <div style={nestedBodyStyle}>
          {value.map((item, i) => (
            <NestedRow key={i} label={String(i)} value={item} />
          ))}
        </div>
      </details>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span style={{ color: 'var(--text-tertiary)' }}>{'{ }'}</span>;
    }
    return (
      <details>
        <summary style={nestedSummaryStyle}>{`{${entries.length} fields}`}</summary>
        <div style={nestedBodyStyle}>
          {entries.map(([k, v]) => (
            <NestedRow key={k} label={k} value={v} />
          ))}
        </div>
      </details>
    );
  }
  return <>{String(value)}</>;
}

function NestedRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
      <div
        style={{
          fontSize: '0.7rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-tertiary)',
          minWidth: '5.5rem',
          paddingTop: '0.125rem',
          fontFamily: 'var(--font-mono)',
          wordBreak: 'break-all',
        }}
      >
        {label}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: '0.875rem',
          color: 'var(--text-primary)',
          wordBreak: 'break-word',
        }}
      >
        <FieldValue value={value} />
      </div>
    </div>
  );
}

const nestedSummaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  color: 'var(--text-accent)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.85rem',
  userSelect: 'none',
  // Default `display: list-item` is preserved so the native disclosure
  // triangle (▶ / ▼) shows and rotates with the open state — gives users
  // a clear tap-to-expand affordance without a custom chevron.
};

const nestedBodyStyle: React.CSSProperties = {
  marginTop: '0.5rem',
  marginLeft: '0.5rem',
  paddingLeft: '0.75rem',
  borderLeft: '1px solid var(--border-subtle)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};

function CopyJsonRow({ record }: { record: GenericRecord }) {
  const [copied, setCopied] = useState(false);
  async function onClick() {
    await writeToClipboard(JSON.stringify(record, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div
      style={{
        marginTop: '0.625rem',
        textAlign: 'center',
      }}
    >
      <button
        type="button"
        onClick={onClick}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.4rem 0.75rem',
          background: 'transparent',
          border: 0,
          color: copied ? 'var(--text-accent)' : 'var(--text-tertiary)',
          fontFamily: 'var(--font-serif)',
          fontSize: '0.8125rem',
          cursor: 'pointer',
          transition: 'color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          if (!copied) e.currentTarget.style.color = 'var(--text-accent)';
        }}
        onMouseLeave={(e) => {
          if (!copied) e.currentTarget.style.color = 'var(--text-tertiary)';
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? 'Copied JSON to clipboard' : 'Copy raw record JSON'}</span>
      </button>
    </div>
  );
}


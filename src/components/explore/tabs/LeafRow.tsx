'use client';

import Link from 'next/link';
import { Check, Pin, PinOff } from 'lucide-react';

/**
 * A single lexicon (leaf NSID) row in the collections list — a link to the
 * collection's records, with an optional "you" marker when the signed-in
 * viewer also has records there and an optional pin/unpin button. Purely
 * presentational; <CollectionsTab> owns the pinned state and toggle handler.
 */
export default function LeafRow({
  nsid,
  href,
  deepIndent,
  dimPrefix,
  baseBg,
  inCommon,
  pinnable,
  pinned,
  onTogglePin,
}: {
  nsid: string;
  href: string;
  deepIndent?: boolean;
  /** Leading slice of `nsid` that's redundant given the parent group; rendered dimmed. */
  dimPrefix?: string;
  /** Resting background for zebra striping; mouseleave restores to this. */
  baseBg: string;
  /** Signed-in viewer also has records in this collection — show a marker. */
  inCommon?: boolean;
  /** Show the pin/unpin button (only when prefs say pins apply on this repo). */
  pinnable?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const hasDim = dimPrefix && nsid.startsWith(dimPrefix);
  const dim = hasDim ? dimPrefix : '';
  const tail = hasDim ? nsid.slice(dimPrefix.length) : nsid;
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'stretch',
        background: baseBg,
        transition: 'background 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-tertiary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = baseBg;
      }}
    >
      {/* `prefetch={false}` + `rel="nofollow"`, per <LinkifiedJson>. One row
          per collection in the repo, and the repo is any repo in the network. */}
      <Link
        href={href}
        prefetch={false}
        rel="nofollow"
        title={inCommon ? 'You have records in this collection too' : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: deepIndent
            ? '0.5rem 0.5rem 0.5rem 3rem'
            : '0.5rem 0.5rem 0.5rem 2.5rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          color: 'var(--text-primary)',
          textDecoration: 'none',
          wordBreak: 'break-all',
          overflowWrap: 'anywhere',
          transition: 'color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)';
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          {dim && <span style={{ color: 'var(--text-tertiary)' }}>{dim}</span>}
          {tail}
        </span>
        {inCommon && (
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.7rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-accent)',
              flexShrink: 0,
            }}
          >
            <Check size={11} aria-hidden /> you
          </span>
        )}
      </Link>
      {pinnable && onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinned ? `Unpin ${nsid}` : `Pin ${nsid}`}
          title={pinned ? 'Unpin from explorer' : 'Pin to top of collections list'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 0.75rem',
            background: 'transparent',
            border: 0,
            color: pinned ? 'var(--text-accent)' : 'var(--text-tertiary)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = pinned
              ? 'var(--text-accent)'
              : 'var(--text-tertiary)';
          }}
        >
          {pinned ? (
            <PinOff size={13} aria-hidden />
          ) : (
            <Pin size={13} aria-hidden />
          )}
        </button>
      )}
    </li>
  );
}

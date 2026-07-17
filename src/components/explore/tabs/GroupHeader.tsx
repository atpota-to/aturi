'use client';

import { ChevronDown, ChevronRight, Pin, PinOff } from 'lucide-react';
import { PIN_GROUP_SUFFIX } from '@/utils/preferences';

/**
 * Collapsible header row for a lexicon group (a major `app.bsky` block or a
 * nested `app.bsky.feed` sub-group) in the collections list. Shows the group
 * prefix with a `.*` suffix, a member count, and — when pinnable — a
 * pin/unpin button that pins the whole `prefix.*` group. Purely presentational;
 * <CollectionsTab> owns the open/pinned state and the toggle handlers.
 */
export default function GroupHeader({
  open,
  onToggle,
  prefix,
  dimPrefix,
  count,
  emphasize,
  indent,
  pinnable,
  pinned,
  onTogglePin,
}: {
  open: boolean;
  onToggle: () => void;
  prefix: string;
  /** Leading slice of `prefix` to render dimmed because it's inherited from a parent group. */
  dimPrefix?: string;
  count: number;
  emphasize?: boolean;
  indent?: boolean;
  /** Show the pin/unpin button that pins the whole `prefix.*` group. */
  pinnable?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const hasDim = dimPrefix && prefix.startsWith(dimPrefix);
  const dim = hasDim ? dimPrefix : '';
  const tail = hasDim ? prefix.slice(dimPrefix.length) : prefix;
  const groupNsid = `${prefix}${PIN_GROUP_SUFFIX}`;
  return (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flex: 1,
          minWidth: 0,
          padding: indent ? '0.55rem 1rem 0.55rem 1.5rem' : '0.625rem 1rem',
          background: 'transparent',
          border: 0,
          textAlign: 'left',
          fontFamily: 'var(--font-mono)',
          fontSize: indent ? '0.8125rem' : '0.875rem',
          color: 'var(--text-primary)',
          cursor: 'pointer',
        }}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
        ) : (
          <ChevronRight size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
        )}
        <code
          style={{
            flex: 1,
            // minWidth: 0 lets the flex item shrink below its intrinsic
            // content width — without it, a long unbreakable NSID (e.g. a
            // ULID-style rkey segment) pushes the count badge off the row.
            minWidth: 0,
            background: 'transparent',
            padding: 0,
            color: emphasize ? 'var(--text-accent)' : 'var(--text-secondary)',
            wordBreak: 'break-all',
            overflowWrap: 'anywhere',
          }}
        >
          {dim && <span style={{ color: 'var(--text-tertiary)' }}>{dim}</span>}
          {tail}
          <span style={{ color: 'var(--text-tertiary)' }}>.*</span>
        </code>
        <span
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
            padding: '0.125rem 0.5rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          {count}
        </span>
      </button>
      {pinnable && onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinned ? `Unpin ${groupNsid}` : `Pin ${groupNsid}`}
          title={
            pinned
              ? 'Unpin this group from the explorer'
              : 'Pin this whole group to the top of the list'
          }
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
          {pinned ? <PinOff size={13} aria-hidden /> : <Pin size={13} aria-hidden />}
        </button>
      )}
    </div>
  );
}

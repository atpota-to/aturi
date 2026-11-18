'use client';

import { ChevronRight, Pin, PinOff } from 'lucide-react';
import { PIN_GROUP_SUFFIX } from '@/utils/preferences';

/**
 * Collapsible header row for a lexicon group (a major `app.bsky` block or a
 * nested `app.bsky.feed` sub-group) in the collections tree. Shows the group
 * prefix, a member count, and — when pinnable — a pin/unpin button that pins
 * the whole `prefix.*` group. Purely presentational; <CollectionsTab> owns the
 * open/pinned state and the toggle handlers.
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
    <div className="fx-row" data-kind="group" data-depth={indent ? 1 : 0}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="fx-row-main"
        style={{ fontWeight: emphasize ? 500 : 400 }}
      >
        <ChevronRight size={12} strokeWidth={2.2} aria-hidden className="fx-row-chev" />
        <code className="fx-row-text">
          {dim && <span className="fx-row-dim fx-row-inherit">{dim}</span>}
          {tail}
          <span className="fx-row-dim" aria-hidden>
            .*
          </span>
        </code>
        <span className="fx-row-count">{count}</span>
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
          className="fx-row-pin"
          data-pinned={pinned || undefined}
        >
          {pinned ? <PinOff size={13} aria-hidden /> : <Pin size={13} aria-hidden />}
        </button>
      )}
    </div>
  );
}

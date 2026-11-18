'use client';

import Link from 'next/link';
import { Check, Pin, PinOff } from 'lucide-react';

/**
 * A single lexicon (leaf NSID) row in the collections tree — a link to the
 * collection's records, with an optional "you" marker when the signed-in
 * viewer also has records there and an optional pin/unpin button. Purely
 * presentational; <CollectionsTab> owns the pinned state and toggle handler.
 */
export default function LeafRow({
  nsid,
  href,
  deepIndent,
  flat,
  dimPrefix,
  inCommon,
  pinnable,
  pinned,
  onTogglePin,
  current,
}: {
  nsid: string;
  href: string;
  deepIndent?: boolean;
  /** Not under a group (an individually pinned NSID): no indent. */
  flat?: boolean;
  /** Leading slice of `nsid` that's redundant given the parent group; rendered dimmed. */
  dimPrefix?: string;
  /** Signed-in viewer also has records in this collection — show a marker. */
  inCommon?: boolean;
  /** Show the pin/unpin button (only when prefs say pins apply on this repo). */
  pinnable?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
  /** The collection on screen — gets the selected fill. */
  current?: boolean;
}) {
  const hasDim = dimPrefix && nsid.startsWith(dimPrefix);
  const dim = hasDim ? dimPrefix : '';
  const tail = hasDim ? nsid.slice(dimPrefix.length) : nsid;
  return (
    <li
      className="fx-row"
      data-kind="leaf"
      data-depth={flat ? 0 : deepIndent ? 2 : 1}
      data-current={current || undefined}
    >
      {/* `prefetch={false}` + `rel="nofollow"`, per <LinkifiedJson>. One row
          per collection in the repo, and the repo is any repo in the network. */}
      <Link
        href={href}
        prefetch={false}
        rel="nofollow"
        title={inCommon ? 'You have records in this collection too' : nsid}
        aria-current={current ? 'page' : undefined}
        className="fx-row-main"
      >
        <span className="fx-row-text">
          {dim && <span className="fx-row-dim fx-row-inherit">{dim}</span>}
          {tail}
        </span>
        {inCommon && (
          <span aria-hidden className="fx-row-you">
            <Check size={10} aria-hidden /> you
          </span>
        )}
      </Link>
      {pinnable && onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinned ? `Unpin ${nsid}` : `Pin ${nsid}`}
          title={pinned ? 'Unpin from explorer' : 'Pin to top of collections list'}
          className="fx-row-pin"
          data-pinned={pinned || undefined}
        >
          {pinned ? <PinOff size={13} aria-hidden /> : <Pin size={13} aria-hidden />}
        </button>
      )}
    </li>
  );
}

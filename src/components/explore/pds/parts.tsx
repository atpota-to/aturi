'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { matchesCommit, statusLabel, statusMeaning, statusTone, type AccountSort } from '@/lib/pdsExplorer';
import type { RelayResult } from '@/lib/tools/relay';
import { formatTidRelative } from '@/utils/atproto/tid';

/**
 * How an account stands, in words with a mark beside them. The mark's tone
 * (pdsExplorer.ts, statusTone) is never the only thing that says it.
 */
export function StatusMark({ standing, quietActive }: { standing: string; quietActive?: boolean }) {
  const tone = statusTone(standing);
  return (
    <span
      className="fx-pd-standing"
      data-tone={tone}
      data-quiet={(quietActive && tone === 'good') || undefined}
      title={statusMeaning(standing)}
    >
      <span className="fx-pd-dot" aria-hidden />
      {statusLabel(standing)}
    </span>
  );
}

/** An account's avatar, or its initial on the accent while there's none. */
export function AccountAvatar({ avatar, label, size = 22 }: { avatar: string | null; label: string; size?: number }) {
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="fx-pd-avatar" src={avatar} alt="" width={size} height={size} loading="lazy" />;
  }
  return (
    <span className="fx-pd-avatar" data-empty aria-hidden style={{ width: size, height: size }}>
      {/* A DID's first letter is always "d", which says nothing. */}
      {label.startsWith('did:') ? '' : label.replace(/^@/, '').charAt(0)}
    </span>
  );
}

/** When a repo last changed: relative while recent, a date after that, the moment on hover. */
export function CommitTime({ date, rev }: { date: Date | null; rev: string | null }) {
  if (!date) {
    return (
      <span className="fx-pd-time" data-unknown title={rev ? `rev ${rev} isn’t a timestamp` : 'No commit listed'}>
        —
      </span>
    );
  }
  return (
    <time
      className="fx-pd-time"
      dateTime={date.toISOString()}
      title={`Last commit ${date.toISOString()}${rev ? ` · rev ${rev}` : ''}`}
      // A year without a commit reads quieter than this week's.
      data-old={matchesCommit(date, 'dormant') || undefined}
    >
      {formatTidRelative(date)}
    </time>
  );
}

const SORT_WORDS: Record<AccountSort, [string, string]> = {
  listed: ['host’s order', 'host’s order, reversed'],
  handle: ['A to Z', 'Z to A'],
  commit: ['oldest first', 'newest first'],
  status: ['active first', 'inactive first'],
};

/** A column head that sorts by its column, and says which way it does. */
export function SortHead({
  label,
  by,
  sort,
  desc,
  onSort,
  className,
}: {
  label: string;
  by: AccountSort;
  sort: AccountSort;
  desc: boolean;
  onSort: (by: AccountSort) => void;
  className?: string;
}) {
  const active = sort === by;
  const Arrow = desc ? ArrowDown : ArrowUp;
  return (
    <span className={className}>
      <button
        type="button"
        className="fx-lx-sort"
        onClick={() => onSort(by)}
        data-active={active || undefined}
        aria-label={`Sort by ${label === '#' ? 'listing order' : label.toLowerCase()}${
          active ? `, ${SORT_WORDS[by][desc ? 1 : 0]}` : ''
        }`}
      >
        {label}
        {active && <Arrow size={11} aria-hidden />}
      </button>
    </span>
  );
}

/** Every order the list can take, for the narrow pane's sort menu. */
export const SORT_CHOICES: { sort: AccountSort; desc: boolean; label: string }[] = [
  { sort: 'listed', desc: false, label: 'As listed' },
  { sort: 'listed', desc: true, label: 'As listed, reversed' },
  { sort: 'commit', desc: true, label: 'Newest commit' },
  { sort: 'commit', desc: false, label: 'Oldest commit' },
  { sort: 'handle', desc: false, label: 'Handle, A to Z' },
  { sort: 'handle', desc: true, label: 'Handle, Z to A' },
  { sort: 'status', desc: false, label: 'Active first' },
  { sort: 'status', desc: true, label: 'Inactive first' },
];

/**
 * How many accounts the relays count on the host: the most any of them
 * says, since a relay that crawls it late or partly counts fewer. Null until
 * one has answered with a count, and when all they say is zero: an entryway
 * like bsky.social is known to relays but holds no repos of its own, and
 * "0 accounts" beside it misleads more than saying nothing.
 */
export function relayAccountCount(results: readonly RelayResult[]): number | null {
  let best: number | null = null;
  for (const { answer } of results) {
    if (answer?.state === 'known' && answer.accountCount !== null) {
      best = best === null ? answer.accountCount : Math.max(best, answer.accountCount);
    }
  }
  return best === 0 ? null : best;
}

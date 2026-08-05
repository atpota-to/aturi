import type { CSSProperties } from 'react';

// listRecords' XRPC max — request the full page on each call so users see
// as many records as possible per fetch.
export const RECORDS_PER_PAGE = 100;

// com.atproto.repo.applyWrites caps a batch at 200 operations (lexicon
// maxLength), so a larger selection is split into chunks. Each chunk lands as
// one atomic repo commit instead of one commit per record.
export const APPLY_WRITES_MAX = 200;

// While paused for the throttle, re-check the budget on this cadence so the
// countdown ticks and a Stop press is picked up within a second.
export const THROTTLE_TICK_MS = 1000;

// Deletes run one batch at a time. Throughput is dominated by the write-rate
// throttle once a selection is large, and sequential batches keep the pacing
// accounting and the "resuming in Ns" countdown simple and exact.
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Row layout. The whole list is one CSS grid so the rkey and data-preview
// columns line up across every row: the <ul> defines the columns and each row
// re-adopts them with `grid-template-columns: subgrid`. The rkey track hugs its
// content but is capped at 30ch — a shared column is only as wide as its widest
// member, so this bounds how far one long rkey can push every preview in — past
// which a long rkey wraps onto a second line (see the <code> wrap rule below)
// rather than shoving the preview off-screen; the `1fr` preview takes the rest.
//
// Sizing to content is the point: a fixed `minmax(_, 30ch)` always *reserves*
// its 30ch max (grid grows fixed tracks to their limit and skips the flexible
// `1fr`), which on a narrow phone viewport left the preview squeezed into a
// sliver on the right. Selection mode prepends a checkbox, adding a leading
// `auto` track.
const RKEY_COLUMN = 'fit-content(30ch)';
export const listColumns = (editing: boolean) =>
  editing ? `auto ${RKEY_COLUMN} 1fr` : `${RKEY_COLUMN} 1fr`;

// Keep the record-count stat compact once a repo has paged in a lot of rows:
// 1000 -> "1k", 1400 -> "1.4k", 12300 -> "12.3k", 1_000_000 -> "1m". Counts
// under 1k render verbatim. Lowercased to sit with the explorer's quiet,
// terminal-flavoured typography.
const compactCountFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
export function formatCount(n: number): string {
  return n < 1000 ? String(n) : compactCountFormatter.format(n).toLowerCase();
}

// Pull minutes-until-reset out of a PDS 429 so the delete UI can say when the
// write budget frees up. Bluesky sends `ratelimit-reset` as an absolute
// unix-seconds timestamp; `retry-after` (seconds from now) is the fallback.
// Returns null when neither header is present or parseable.
export function rateLimitResetMinutes(err: unknown): number | null {
  const headers = (err as { headers?: Record<string, string | undefined> } | null)?.headers;
  if (!headers) return null;
  const reset = headers['ratelimit-reset'];
  if (reset) {
    const ms = Number(reset) * 1000 - Date.now();
    if (Number.isFinite(ms) && ms > 0) return Math.max(1, Math.ceil(ms / 60000));
  }
  const retryAfter = headers['retry-after'];
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) return Math.max(1, Math.ceil(secs / 60));
  }
  return null;
}

// Shared look for the quiet "Select all" / "Deselect all" buttons in the
// bulk-edit toolbar — neutral chips that dim when their action is a no-op.
export function selectionButtonStyle(disabled: boolean): CSSProperties {
  return {
    padding: '0.4rem 0.75rem',
    background: 'var(--bg-tertiary)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-medium)',
    fontFamily: 'var(--font-serif)',
    fontSize: '0.8125rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

/**
 * Pure number formatters shared across the lexicons UI. Kept React-free
 * so server components and metadata can use them too.
 */

/** Compact count: 1_234 -> "1.2k", 1_500_000 -> "1.5M". */
export function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

/** Signed percent: 1 decimal under 100%, 0 decimals at/above. */
export function formatPct(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  if (Math.abs(pct) >= 100) return `${sign}${pct.toFixed(0)}%`;
  return `${sign}${pct.toFixed(1)}%`;
}

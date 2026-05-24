/**
 * Heuristics for extracting a short preview line from an arbitrary record
 * value. Used by:
 *
 *   - the explorer's collection listing (rkey + 1-line preview),
 *   - the extension's Inspect tab (per-AT-URI preview snippet).
 *
 * The order matters: lexicons that have a canonical title field should be
 * caught before generic fallbacks.
 */

const PREVIEW_FIELDS = [
  'title',
  'name',
  'displayName',
  'status',
  'text',
  'description',
  'summary',
] as const;

export function previewFor(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const v = value as Record<string, unknown>;

  for (const k of PREVIEW_FIELDS) {
    const candidate = v[k];
    if (typeof candidate === 'string' && candidate.trim()) {
      return truncate(candidate.trim(), 140);
    }
  }

  // subject is a common "this record points at that one" field on follows,
  // likes, blocks, etc — surface the URI when present.
  const subject = v.subject;
  if (subject && typeof subject === 'object') {
    const subjectObj = subject as Record<string, unknown>;
    if (typeof subjectObj.uri === 'string') return truncate(subjectObj.uri, 140);
    if (typeof subjectObj.handle === 'string') return truncate(subjectObj.handle, 140);
    if (typeof subjectObj.did === 'string') return truncate(subjectObj.did, 140);
  }
  if (typeof subject === 'string') return truncate(subject, 140);

  if (typeof v.createdAt === 'string') return v.createdAt;
  return '';
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

/**
 * Try to surface a concise title from a record value. Falls back to the
 * collection NSID's tail segment if nothing useful is present.
 */
export function titleFor(
  value: unknown,
  fallback?: { collection?: string; rkey?: string },
): string {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    for (const k of ['title', 'name', 'displayName'] as const) {
      const candidate = v[k];
      if (typeof candidate === 'string' && candidate.trim()) {
        return truncate(candidate.trim(), 100);
      }
    }
  }
  if (fallback?.collection) {
    const tail = fallback.collection.split('.').pop();
    if (tail) return tail;
  }
  return fallback?.rkey || 'record';
}

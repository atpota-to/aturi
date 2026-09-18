/**
 * Unsent record drafts, kept in this browser.
 *
 * The composer is a page you can navigate away from, reload, or close by
 * accident, and a half-written record is work. So the draft body survives all
 * three, scoped to the account that wrote it and the collection it was for —
 * two collections' drafts don't overwrite each other, and signing in as someone
 * else doesn't surface the previous account's.
 *
 * Deliberately local and deliberately plain: this is the author's own unsent
 * text in their own browser, never sent anywhere, and cleared the moment the
 * record is written. Storage failures are non-events — a private window with
 * storage disabled loses drafts and keeps working.
 */

const PREFIX = 'aturi:recordDraft:';

/**
 * How long a draft is worth restoring. Long enough to survive a closed laptop
 * over a weekend; short enough that a record you abandoned in March isn't
 * offered back in June as though you meant it.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Serialized ceiling per draft. A record carrying a base64 blob inline can be
 * megabytes, and localStorage is a shared ~5MB budget for the whole origin —
 * which the explorer also uses for preferences and the write-rate ledger.
 * Over this, the draft is simply not kept.
 */
const MAX_BYTES = 128 * 1024;

export type RecordDraft = {
  collection: string;
  rkey: string;
  /** The record body as text, exactly as it sat in the editor. */
  json: string;
  savedAt: number;
};

function keyFor(did: string, collection: string): string {
  return `${PREFIX}${did}:${collection}`;
}

function storage(): Storage | null {
  try {
    // Accessing the property itself throws where site data is blocked, so the
    // guard has to be inside the try.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The draft for this account and collection, if one is worth restoring. */
export function loadDraft(did: string, collection: string): RecordDraft | null {
  const store = storage();
  if (!store || !did || !collection) return null;
  try {
    const raw = store.getItem(keyFor(did, collection));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const draft = parsed as Partial<RecordDraft>;
    if (typeof draft.json !== 'string' || typeof draft.savedAt !== 'number') return null;
    if (Date.now() - draft.savedAt > MAX_AGE_MS) {
      store.removeItem(keyFor(did, collection));
      return null;
    }
    return {
      collection,
      rkey: typeof draft.rkey === 'string' ? draft.rkey : '',
      json: draft.json,
      savedAt: draft.savedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Keep a draft, or drop the stored one when there is nothing left to keep.
 *
 * An empty body clears rather than storing emptiness, so deleting everything
 * in the editor and leaving does not resurrect a blank draft on the next visit.
 */
export function saveDraft(did: string, draft: Omit<RecordDraft, 'savedAt'>): void {
  const store = storage();
  if (!store || !did || !draft.collection) return;
  if (draft.json.trim() === '') {
    clearDraft(did, draft.collection);
    return;
  }
  const payload = JSON.stringify({ ...draft, savedAt: Date.now() });
  if (payload.length > MAX_BYTES) return;
  try {
    store.setItem(keyFor(did, draft.collection), payload);
  } catch {
    // Quota or a blocked store. The draft just isn't kept.
  }
}

export function clearDraft(did: string, collection: string): void {
  const store = storage();
  if (!store || !did || !collection) return;
  try {
    store.removeItem(keyFor(did, collection));
  } catch {
    // Nothing to do, and nothing depends on it.
  }
}

/**
 * PURE-ish. Whether a stored draft still says anything the seeded template
 * didn't.
 *
 * The composer seeds an empty record with its `$type` and the lexicon's
 * defaults, and that seed gets saved like anything else. Restoring it would
 * put a "draft restored" notice over a record the user never touched, so the
 * two are compared before the notice is shown.
 */
export function draftDiffersFrom(draft: string, seed: string): boolean {
  return normalizeJson(draft) !== normalizeJson(seed);
}

/** Compare by structure, so whitespace and key order don't read as an edit. */
function normalizeJson(text: string): string {
  try {
    return JSON.stringify(sortKeys(JSON.parse(text)));
  } catch {
    return text.trim();
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
}

/**
 * What a backlink row says about its linking record: who wrote it, and a
 * line of context (a post's text, the list an account was added to, a
 * starter pack's or document's title). Constellation returns coordinates
 * only, so each comes from a second source:
 *
 *   profiles  app.bsky.actor.getProfiles, 25 accounts per request
 *   posts     app.bsky.feed.getPosts, 25 posts per request
 *   others    Slingshot, one cached request per record (concurrency-limited),
 *             and a second hop for a list item's list
 *
 * Results are cached for the page's lifetime, keyed by DID or AT URI, so
 * moving between relationships and back never refetches a row. The caches
 * are an external store: every batch that lands notifies subscribers, so a
 * component re-renders when its rows fill in, whichever call fetched them.
 */

import { getPosts, getProfilesResult, type AppViewProfile } from './appview';
import { getRecordsByUris } from './slingshot';

export type LinkerProfile = Pick<AppViewProfile, 'did' | 'handle' | 'displayName' | 'avatar'>;

/** `kind` is a short label for the record type; `text` the record's words. */
export type RecordContext = { kind: string | null; text: string };

/** Record types named in a row's context, by the collection's last segment. */
const KIND_BY_NAME: Record<string, string> = {
  starterpack: 'Starter pack',
  document: 'Document',
  list: 'List',
  verification: 'Verification',
  generator: 'Feed',
  event: 'Event',
  profile: 'Profile',
};

/** Fields that read as a record's title or body, in the order tried. */
const TEXT_FIELDS = ['title', 'name', 'displayName', 'text', 'description'] as const;

const MAX_CONTEXT = 300;

function clean(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_CONTEXT ? `${flat.slice(0, MAX_CONTEXT - 1)}…` : flat;
}

/**
 * A row's context for a record value, or null when the record has nothing a
 * reader would recognise. Follows and blocks never get here (their records
 * are a subject and a date).
 */
export function describeLinkingRecord(collection: string, value: unknown): RecordContext | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  for (const field of TEXT_FIELDS) {
    const text = v[field];
    if (typeof text === 'string' && text.trim()) {
      const name = collection.split('.').pop() ?? '';
      return { kind: KIND_BY_NAME[name] ?? null, text: clean(text) };
    }
  }
  return null;
}

/**
 * How a list item's list is named in a row. Bluesky makes reference lists
 * only to back starter packs, so that purpose reads as one.
 */
export function listKind(purpose: unknown): string {
  const p = typeof purpose === 'string' ? purpose.split('#').pop() : '';
  if (p === 'modlist') return 'Moderation list';
  if (p === 'referencelist') return 'Starter pack list';
  return 'List';
}

/** Collections whose records carry no words worth fetching. */
export function hasNoContext(collection: string): boolean {
  return /(follow|block)$/i.test(collection.split('.').pop() ?? '');
}

const profiles = new Map<string, LinkerProfile | null>();
const contexts = new Map<string, RecordContext | null>();
const pendingProfiles = new Set<string>();
const pendingContexts = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version += 1;
  listeners.forEach((listener) => listener());
}

/** For `useSyncExternalStore`: re-render when any cached detail changes. */
export function subscribeBacklinkDetails(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function backlinkDetailsVersion(): number {
  return version;
}

/** `undefined` while unknown, `null` when the AppView has no profile. */
export function cachedProfile(did: string): LinkerProfile | null | undefined {
  return profiles.get(did);
}

/** `undefined` while unknown, `null` when the record has no context. */
export function cachedContext(uri: string): RecordContext | null | undefined {
  return contexts.get(uri);
}

/**
 * Fill the profile cache for `dids`. An account the AppView answered for
 * but does not know is cached as null; a chunk that failed is left unknown
 * so a later call tries again.
 */
export async function loadProfiles(dids: readonly string[]): Promise<void> {
  const wanted = Array.from(new Set(dids)).filter((d) => !profiles.has(d) && !pendingProfiles.has(d));
  if (!wanted.length) return;
  wanted.forEach((d) => pendingProfiles.add(d));
  try {
    const { profiles: found, failed } = await getProfilesResult(wanted);
    for (const did of wanted) {
      const p = found.get(did);
      if (p) profiles.set(did, { did, handle: p.handle, displayName: p.displayName, avatar: p.avatar });
      else if (!failed) profiles.set(did, null);
    }
  } finally {
    wanted.forEach((d) => pendingProfiles.delete(d));
    changed();
  }
}

const POST = 'app.bsky.feed.post';
const LIST_ITEM = 'app.bsky.graph.listitem';

/** Fill the context cache for linking records, given as AT URI + collection. */
export async function loadContexts(
  records: readonly { uri: string; collection: string }[],
): Promise<void> {
  const wanted = records.filter(
    (r) => !contexts.has(r.uri) && !pendingContexts.has(r.uri),
  );
  if (!wanted.length) return;
  for (const r of wanted) {
    if (hasNoContext(r.collection)) contexts.set(r.uri, null);
    else pendingContexts.add(r.uri);
  }
  const posts = wanted.filter((r) => r.collection === POST).map((r) => r.uri);
  const others = wanted.filter((r) => r.collection !== POST && !hasNoContext(r.collection));
  try {
    await Promise.all([loadPostContexts(posts), loadRecordContexts(others)]);
  } finally {
    for (const r of wanted) pendingContexts.delete(r.uri);
    changed();
  }
}

async function loadPostContexts(uris: string[]) {
  const chunks: string[][] = [];
  for (let i = 0; i < uris.length; i += 25) chunks.push(uris.slice(i, i + 25));
  await Promise.all(
    chunks.map(async (chunk) => {
      const res = await getPosts(chunk);
      if (!res) return;
      const byUri = new Map((res.posts ?? []).map((p) => [p.uri, p]));
      for (const uri of chunk) {
        const text = byUri.get(uri)?.record?.text;
        contexts.set(uri, typeof text === 'string' && text.trim() ? { kind: null, text: clean(text) } : null);
      }
    }),
  );
}

async function loadRecordContexts(records: { uri: string; collection: string }[]) {
  if (!records.length) return;
  const fetched = await getRecordsByUris(records.map((r) => r.uri));
  // A list item names an account and a list; the list's name is the context.
  const listUris = new Map<string, string>();
  for (const r of records) {
    const value = fetched.get(r.uri)?.value;
    if (!value) continue;
    if (r.collection === LIST_ITEM && typeof value.list === 'string') listUris.set(r.uri, value.list);
    else contexts.set(r.uri, describeLinkingRecord(r.collection, value));
  }
  if (listUris.size) {
    const lists = await getRecordsByUris([...listUris.values()]);
    for (const [uri, listUri] of listUris) {
      const list = lists.get(listUri)?.value;
      const name = typeof list?.name === 'string' ? list.name.trim() : '';
      contexts.set(uri, name ? { kind: listKind(list?.purpose), text: clean(name) } : null);
    }
  }
  // Records Slingshot could not find stay without context rather than retried.
  for (const r of records) if (!contexts.has(r.uri)) contexts.set(r.uri, null);
}

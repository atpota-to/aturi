/**
 * The live path: mentions arrive off Jetstream in about the time it takes the
 * PDS to commit them, instead of whenever the next poll happens to run.
 *
 * Two wire formats are in the field and this reads both. Jetstream v2 serves
 * `/xrpc/network.bsky.jetstream.subscribeEvents`, takes `collections`/`kinds`,
 * and wraps each event as `{$type, payload}` with a monotonic `seq`. The older
 * v1 serves `/subscribe`, takes `wantedCollections`, and sends a flat object
 * keyed on `time_us`. Normalising both here means a deployment can point at
 * whichever instance it already runs without touching anything else.
 *
 * Delivery is at-least-once, so this is not the whole story — see the
 * reconcile sweep in index.ts for the half that catches what a long
 * disconnect drops.
 */

import { readFile, writeFile } from 'node:fs/promises';
import type { Config } from './config.ts';
import type { Mention, StrongRef } from './bluesky.ts';

const POST_COLLECTION = 'app.bsky.feed.post';
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
/** Cursor writes are debounced: the stream is thousands of events a minute. */
const CURSOR_FLUSH_MS = 5_000;

type Commit = {
  did: string;
  rkey: string;
  cid: string;
  operation: string;
  collection: string;
  record: Record<string, unknown>;
  cursor: string;
};

/**
 * One event, whichever dialect it arrived in. Returns null for anything that
 * is not a post creation — deletes, identity events, malformed frames.
 */
export function parseEvent(raw: string): Commit | null {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message === null) return null;

  const envelope = message as Record<string, unknown>;
  // v2 nests the event under `payload` and flattens the commit fields into it;
  // v1 puts them in a `commit` object beside a top-level `did`.
  const payload = (envelope.payload ?? envelope) as Record<string, unknown>;
  const commit = (payload.commit ?? payload) as Record<string, unknown>;

  const did = payload.did ?? envelope.did;
  const { operation, collection, rkey, cid, record } = commit;

  if (operation !== 'create' || collection !== POST_COLLECTION) return null;
  if (typeof did !== 'string' || typeof rkey !== 'string') return null;
  if (typeof cid !== 'string') return null;
  if (typeof record !== 'object' || record === null) return null;

  // v2's `seq` is the resumption value; v1 has only the microsecond clock.
  // Both go back on the wire as the `cursor` query parameter.
  const seq = payload.seq ?? envelope.seq;
  const timeUs = payload.time_us ?? envelope.time_us;
  const cursor =
    typeof seq === 'number'
      ? String(seq)
      : typeof timeUs === 'number'
        ? String(timeUs)
        : '';

  return {
    did,
    rkey,
    cid,
    operation,
    collection,
    record: record as Record<string, unknown>,
    cursor,
  };
}

function isMentionOf(record: Record<string, unknown>, did: string): boolean {
  const facets = record.facets;
  if (!Array.isArray(facets)) return false;
  for (const facet of facets) {
    const features = (facet as Record<string, unknown>)?.features;
    if (!Array.isArray(features)) continue;
    for (const feature of features) {
      const entry = feature as Record<string, unknown>;
      if (
        entry?.$type === 'app.bsky.richtext.facet#mention' &&
        entry?.did === did
      ) {
        return true;
      }
    }
  }
  return false;
}

function isReplyTo(record: Record<string, unknown>, did: string): boolean {
  const reply = record.reply as Record<string, unknown> | undefined;
  const parent = reply?.parent as Record<string, unknown> | undefined;
  return typeof parent?.uri === 'string' && parent.uri.startsWith(`at://${did}/`);
}

function strongRef(value: unknown): StrongRef | null {
  const ref = value as Record<string, unknown> | undefined;
  return typeof ref?.uri === 'string' && typeof ref?.cid === 'string'
    ? { uri: ref.uri, cid: ref.cid }
    : null;
}

/**
 * A post worth answering, or null. Everything needed to reply is already in
 * the commit — the author's handle is not, and is resolved later, because
 * that is one network call and most events are not for us.
 */
export function toMention(commit: Commit, botDid: string): Mention | null {
  if (commit.did === botDid) return null;
  if (!isMentionOf(commit.record, botDid) && !isReplyTo(commit.record, botDid)) {
    return null;
  }
  const text = commit.record.text;
  if (typeof text !== 'string' || !text.trim()) return null;

  const self: StrongRef = {
    uri: `at://${commit.did}/${POST_COLLECTION}/${commit.rkey}`,
    cid: commit.cid,
  };
  const reply = commit.record.reply as Record<string, unknown> | undefined;

  return {
    ...self,
    authorDid: commit.did,
    text,
    indexedAt: new Date().toISOString(),
    root: strongRef(reply?.root) ?? self,
  };
}

function subscribeUrl(config: Config, cursor: string | null): string {
  const url = new URL(config.jetstreamUrl);
  // v2 lives under /xrpc and renamed its filters; v1 keeps the `wanted` prefix.
  if (url.pathname.includes('/xrpc/')) {
    url.searchParams.set('collections', POST_COLLECTION);
    url.searchParams.set('kinds', 'commit');
  } else {
    url.searchParams.set('wantedCollections', POST_COLLECTION);
  }
  if (cursor) url.searchParams.set('cursor', cursor);
  return url.toString();
}

async function readCursor(path: string): Promise<string | null> {
  try {
    const value = (await readFile(path, 'utf8')).trim();
    return value || null;
  } catch {
    return null;
  }
}

export type Watcher = { stop: () => void };

/**
 * Hold a subscription open, handing every mention to `onMention`, reconnecting
 * with backoff for as long as the process lives.
 *
 * The cursor is persisted so a restart resumes where it left off rather than
 * at the live edge. It is inclusive, so resuming replays the last event — the
 * dedupe pass absorbs that, which is why replaying is the safe direction to
 * err in.
 */
export function watchMentions(
  config: Config,
  botDid: string,
  onMention: (mention: Mention) => void,
): Watcher {
  let socket: WebSocket | null = null;
  let stopped = false;
  let backoff = RECONNECT_MIN_MS;
  let cursor: string | null = null;
  let pendingCursor: string | null = null;
  let retryTimer: NodeJS.Timeout | undefined;

  const flushTimer = setInterval(() => {
    if (!pendingCursor || pendingCursor === cursor) return;
    cursor = pendingCursor;
    void writeFile(config.cursorFile, cursor, 'utf8').catch(() => {
      // A cursor we cannot persist costs a replay on restart, not an event.
    });
  }, CURSOR_FLUSH_MS);
  flushTimer.unref?.();

  async function connect(): Promise<void> {
    if (stopped) return;
    if (cursor === null) cursor = await readCursor(config.cursorFile);
    if (stopped) return;

    const url = subscribeUrl(config, pendingCursor ?? cursor);
    const ws = new WebSocket(url);
    socket = ws;

    ws.onopen = () => {
      backoff = RECONNECT_MIN_MS;
      console.log(`[jetstream] connected${cursor ? ` at cursor ${cursor}` : ''}`);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const commit = parseEvent(event.data);
      if (!commit) return;
      if (commit.cursor) pendingCursor = commit.cursor;

      const mention = toMention(commit, botDid);
      if (mention) onMention(mention);
    };

    ws.onerror = () => {
      // The close handler runs next and owns the retry; without a handler
      // here Node treats the error as unhandled and tears the process down.
    };

    ws.onclose = () => {
      socket = null;
      if (stopped) return;
      retryTimer = setTimeout(() => void connect(), backoff);
      retryTimer.unref?.();
      console.warn(`[jetstream] disconnected, retrying in ${backoff}ms`);
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
    };
  }

  void connect();

  return {
    stop() {
      stopped = true;
      clearInterval(flushTimer);
      if (retryTimer) clearTimeout(retryTimer);
      try {
        socket?.close();
      } catch {
        // already closing
      }
      if (pendingCursor) {
        void writeFile(config.cursorFile, pendingCursor, 'utf8').catch(() => {});
      }
    },
  };
}

/**
 * Jetstream WebSocket client. Emits commit events as plain JS objects.
 *
 *   const dispose = createJetstreamConnection(
 *     { wantedCollections: ['app.bsky.feed.post'] },
 *     (evt) => { ... },
 *   );
 *   // later:
 *   dispose();
 *
 * Browser-only — the WebSocket spec is in the global lexical scope but only
 * in browser-like runtimes. Callers from server components should defer
 * to a `'use client'` boundary.
 *
 * `createJetstreamConnection` is the commit-only view the live feeds use.
 * `subscribeJetstream` underneath it hands over every event Jetstream sends,
 * identity and account events included, for the stream monitor.
 */

import { JETSTREAM } from './config';
import { openReconnectingSocket, type SocketStatus } from './reconnectingSocket';

export type JetstreamCommit = {
  did: string;
  time_us: number;
  kind: 'commit';
  commit: {
    rev?: string;
    operation: 'create' | 'update' | 'delete';
    collection: string;
    rkey: string;
    record?: Record<string, unknown>;
    cid?: string;
  };
};

/**
 * Jetstream forwards these whatever `wantedCollections` asks for; only
 * `wantedDids` narrows them. `handle` is present when the identity event
 * carried one, which not all of them do: an event without it means "this
 * DID's identity may have changed, resolve it again".
 */
export type JetstreamIdentity = {
  did: string;
  time_us: number;
  kind: 'identity';
  identity: { did: string; handle?: string; seq: number; time: string };
};

export type JetstreamAccount = {
  did: string;
  time_us: number;
  kind: 'account';
  account: { did: string; active: boolean; status?: string; seq: number; time: string };
};

export type JetstreamEvent = JetstreamCommit | JetstreamIdentity | JetstreamAccount;

export type JetstreamOpts = {
  wantedCollections?: string[];
  wantedDids?: string[];
  /**
   * Commit operations the caller wants to receive. Defaults to
   * `['create']` so existing callers (which assume only fresh records
   * come through) keep working. Pass `['create', 'update', 'delete']`
   * to surface the full mutation stream.
   */
  wantedOps?: ('create' | 'update' | 'delete')[];
  cursor?: number;
};

type Disposer = () => void;

function buildUrl(opts: JetstreamOpts): string {
  const params = new URLSearchParams();
  for (const c of opts.wantedCollections || []) params.append('wantedCollections', c);
  for (const d of opts.wantedDids || []) params.append('wantedDids', d);
  if (opts.cursor) params.set('cursor', String(opts.cursor));
  const qs = params.toString();
  return qs ? `${JETSTREAM}?${qs}` : JETSTREAM;
}

/** Narrow a parsed message to the three event shapes Jetstream documents. */
function asJetstreamEvent(data: unknown): JetstreamEvent | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.did !== 'string') return null;
  if (d.kind === 'commit') {
    const c = d.commit as Record<string, unknown> | undefined;
    return c && typeof c.collection === 'string' ? (d as JetstreamCommit) : null;
  }
  if (d.kind === 'identity') return d.identity ? (d as JetstreamIdentity) : null;
  if (d.kind === 'account') return d.account ? (d as JetstreamAccount) : null;
  return null;
}

export type JetstreamHandlers = {
  /** `raw` is the message text as received, for matching without re-serialising. */
  onEvent: (evt: JetstreamEvent, raw: string) => void;
  onStatus?: (status: SocketStatus) => void;
  onError?: (err: Error) => void;
};

/**
 * Open a Jetstream WebSocket and deliver every commit, identity and account
 * event it sends. `wantedOps` does not apply here (Jetstream has no
 * server-side operation filter; callers that want one filter themselves).
 * Auto-reconnects with exponential backoff capped at 30s. Returns a dispose
 * function that closes the socket and cancels any pending reconnect.
 */
export function subscribeJetstream(
  opts: Omit<JetstreamOpts, 'wantedOps'>,
  { onEvent, onStatus, onError }: JetstreamHandlers,
): Disposer {
  return openReconnectingSocket({
    url: () => buildUrl(opts),
    onMessage: (text) => {
      try {
        const evt = asJetstreamEvent(JSON.parse(text));
        if (evt) onEvent(evt, text);
      } catch {
        // Skip malformed messages — jetstream output is structured, but
        // be defensive against future schema changes.
      }
    },
    onStatus,
    onError,
  });
}

/**
 * Open a Jetstream WebSocket that emits commits only, limited to
 * `wantedOps`. Auto-reconnects on close with exponential backoff capped at
 * 30s. Returns a dispose function that closes the socket cleanly and cancels
 * any pending reconnect.
 */
export function createJetstreamConnection(
  opts: JetstreamOpts,
  onEvent: (evt: JetstreamCommit) => void,
  onError?: (err: Error) => void,
): Disposer {
  const allowedOps = new Set<'create' | 'update' | 'delete'>(
    opts.wantedOps && opts.wantedOps.length ? opts.wantedOps : ['create'],
  );
  return subscribeJetstream(opts, {
    onEvent: (evt) => {
      if (evt.kind === 'commit' && allowedOps.has(evt.commit.operation)) onEvent(evt);
    },
    onError,
  });
}

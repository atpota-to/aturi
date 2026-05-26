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
 */

import { JETSTREAM } from './config';

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

/**
 * Open a Jetstream WebSocket. Auto-reconnects on close with exponential
 * backoff capped at 30s. Returns a dispose function that closes the socket
 * cleanly and cancels any pending reconnect.
 */
export function createJetstreamConnection(
  opts: JetstreamOpts,
  onEvent: (evt: JetstreamCommit) => void,
  onError?: (err: Error) => void,
): Disposer {
  let disposed = false;
  let ws: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const allowedOps = new Set<'create' | 'update' | 'delete'>(
    opts.wantedOps && opts.wantedOps.length ? opts.wantedOps : ['create'],
  );

  function connect(): void {
    if (disposed) return;
    try {
      ws = new WebSocket(buildUrl(opts));
    } catch (err) {
      onError?.(err as Error);
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      attempt = 0;
    });

    ws.addEventListener('message', (e) => {
      if (disposed) return;
      try {
        const data = JSON.parse(typeof e.data === 'string' ? e.data : '');
        if (
          data &&
          data.kind === 'commit' &&
          data.commit?.collection &&
          allowedOps.has(data.commit?.operation)
        ) {
          onEvent(data as JetstreamCommit);
        }
      } catch {
        // Skip malformed messages — jetstream output is structured, but
        // be defensive against future schema changes.
      }
    });

    ws.addEventListener('error', (err) => {
      onError?.(new Error('Jetstream WebSocket error'));
      // 'error' fires before 'close'; reconnect happens in close handler.
      void err;
    });

    ws.addEventListener('close', () => {
      ws = null;
      scheduleReconnect();
    });
  }

  function scheduleReconnect(): void {
    if (disposed) return;
    const delay = Math.min(30_000, 1000 * 2 ** attempt);
    attempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  }

  connect();

  return () => {
    disposed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore — socket may already be closed
      }
      ws = null;
    }
  };
}

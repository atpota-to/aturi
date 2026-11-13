/**
 * A WebSocket that reopens itself. Shared by the Jetstream and PLC export
 * stream clients, which differ only in the URL they open and what they make
 * of each message.
 *
 * Reconnects on close with exponential backoff capped at 30s, and resets the
 * backoff once a connection opens. `url` is called on every attempt rather
 * than once, so a client can resume from the last cursor it saw.
 *
 * Browser-only, like the clients built on it.
 */

export type SocketStatus = 'connecting' | 'open' | 'reconnecting';

export type ReconnectingSocketOpts = {
  url: () => string;
  onMessage: (text: string) => void;
  onStatus?: (status: SocketStatus) => void;
  onError?: (err: Error) => void;
};

export function openReconnectingSocket({
  url,
  onMessage,
  onStatus,
  onError,
}: ReconnectingSocketOpts): () => void {
  let disposed = false;
  let ws: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect(): void {
    if (disposed) return;
    onStatus?.(attempt === 0 ? 'connecting' : 'reconnecting');
    try {
      ws = new WebSocket(url());
    } catch (err) {
      onError?.(err as Error);
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      attempt = 0;
      if (!disposed) onStatus?.('open');
    });

    ws.addEventListener('message', (e) => {
      if (disposed || typeof e.data !== 'string') return;
      onMessage(e.data);
    });

    ws.addEventListener('error', () => {
      // 'error' fires before 'close'; the reconnect happens in the close
      // handler.
      onError?.(new Error('WebSocket error'));
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
    onStatus?.('reconnecting');
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

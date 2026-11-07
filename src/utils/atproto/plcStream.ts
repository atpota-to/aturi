/**
 * Live feed of PLC directory operations, from the directory's export stream.
 *
 *   const dispose = subscribePlcStream({}, {
 *     onEvent: (op) => { ... },
 *   });
 *
 * Each message is one sequenced operation: the shape `/export` returns, with
 * a `seq` and a `type` of `sequenced_op`. Messages of any other type are
 * skipped rather than guessed at.
 *
 * On a dropped connection the client reopens from the last `seq` it saw, so
 * a blip does not leave a gap. A fresh subscription starts at the live edge.
 *
 * Browser-only, like the Jetstream client.
 */

import { PLC_EXPORT_STREAM } from './config';
import type { PlcOperation } from './plc';
import { openReconnectingSocket, type SocketStatus } from './reconnectingSocket';

/**
 * A PLC operation as the export carries it. `plc_operation` and
 * `plc_tombstone` use the fields on `PlcOperation`; DIDs created before
 * those existed have a legacy `create` genesis with the fields added here.
 */
export type PlcStreamOperation = PlcOperation & {
  handle?: string;
  service?: string;
  signingKey?: string;
  recoveryKey?: string;
};

export type PlcStreamEntry = {
  seq: number;
  type: 'sequenced_op';
  did: string;
  operation: PlcStreamOperation;
  cid: string;
  createdAt: string;
  nullified?: boolean;
};

export type PlcStreamHandlers = {
  /** `raw` is the message text as received, for matching without re-serialising. */
  onEvent: (entry: PlcStreamEntry, raw: string) => void;
  onStatus?: (status: SocketStatus) => void;
  onError?: (err: Error) => void;
};

function asPlcStreamEntry(data: unknown): PlcStreamEntry | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== 'sequenced_op') return null;
  if (typeof d.seq !== 'number' || typeof d.did !== 'string') return null;
  if (!d.operation || typeof d.operation !== 'object') return null;
  return d as PlcStreamEntry;
}

export function subscribePlcStream(
  opts: { cursor?: number },
  { onEvent, onStatus, onError }: PlcStreamHandlers,
): () => void {
  let lastSeq = opts.cursor ?? 0;
  return openReconnectingSocket({
    url: () => (lastSeq ? `${PLC_EXPORT_STREAM}?cursor=${lastSeq}` : PLC_EXPORT_STREAM),
    onMessage: (text) => {
      try {
        const entry = asPlcStreamEntry(JSON.parse(text));
        if (!entry) return;
        if (entry.seq > lastSeq) lastSeq = entry.seq;
        onEvent(entry, text);
      } catch {
        // Skip malformed messages.
      }
    },
    onStatus,
    onError,
  });
}

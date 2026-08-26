/**
 * Jetstream tool: a bounded, live tap into the network event stream.
 *
 * The MCP protocol is stateless request/response, so this cannot stream — but
 * an agent rarely wants an unbounded stream anyway. sample_jetstream opens a
 * Jetstream WebSocket, collects matching events until it hits a small event
 * cap or a short time budget (both well under the route's maxDuration), then
 * closes and returns what it saw. That answers "show me live activity in
 * collection X" or "what is account Y doing right now" without the agent
 * holding a socket.
 *
 * sample_recent_records (UFOs) is the historical companion; this is the live
 * one, and the only tool that can filter by specific DIDs and by operation
 * type (creates vs updates vs deletes).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { JETSTREAM } from '@/utils/atproto/config';
import { toAtUri } from '@/utils/atproto/urls';
import { isValidDid, isValidNsid } from '@/utils/atproto/spaceUri';
import { McpToolError } from '@/lib/mcp/errors';
import { toolHandler, recordLink, READ_ONLY } from '@/lib/mcp/respond';

const MAX_DURATION_SECONDS = 15;
const MAX_EVENTS = 100;
/**
 * Total serialized size a single window may return. The event cap alone does
 * not bound the payload: a commit carries the whole record, and some lexicons
 * write large ones, so 100 events could otherwise run to megabytes and swamp
 * the caller's context. Whichever limit is reached first ends the window.
 */
const MAX_PAYLOAD_BYTES = 256_000;
/**
 * Ceiling on what is read off the socket, as opposed to what is kept. A window
 * with no collection filter and a narrow operation filter (say deletes only)
 * would otherwise stream and parse the entire stream for its full duration
 * while retaining almost nothing, spending a volunteer-run service's bandwidth
 * to do it. Reaching this ends the window with whatever was collected.
 */
const MAX_INGRESS_BYTES = 4_000_000;

type Operation = 'create' | 'update' | 'delete';

type CollectedEvent = {
  did: string;
  seenAt: string;
  operation: Operation;
  collection: string;
  rkey: string;
  uri: string;
  cid: string | null;
  record: Record<string, unknown> | null;
  link: string;
};

type JetstreamMessage = {
  did?: string;
  time_us?: number;
  kind?: string;
  commit?: {
    operation?: Operation;
    collection?: string;
    rkey?: string;
    cid?: string;
    record?: Record<string, unknown>;
  };
};

/**
 * Open Jetstream, collect matching commit events until `maxEvents` or
 * `durationMs`, then close. Resolves with what was collected; a quiet window
 * yields an empty array, which is a valid answer, not an error.
 */
function collectJetstream(opts: {
  collections: string[];
  dids: string[];
  operations: Set<Operation>;
  maxEvents: number;
  durationMs: number;
}): Promise<{ events: CollectedEvent[]; reachedMax: boolean }> {
  const { collections, dids, operations, maxEvents, durationMs } = opts;

  const params = new URLSearchParams();
  for (const c of collections) params.append('wantedCollections', c);
  for (const d of dids) params.append('wantedDids', d);
  const url = params.toString() ? `${JETSTREAM}?${params}` : JETSTREAM;

  return new Promise((resolve, reject) => {
    if (typeof WebSocket === 'undefined') {
      reject(new McpToolError('internal_error', 'This runtime has no WebSocket; Jetstream is unavailable here'));
      return;
    }

    const events: CollectedEvent[] = [];
    let settled = false;
    let bytes = 0;
    let ingress = 0;
    let ws: WebSocket | null = null;

    const timer = setTimeout(() => finish(false), durationMs);

    /** Close the socket on every exit path; a serverless worker can be frozen
     *  with one still open otherwise. Safe to call more than once. */
    function closeSocket() {
      try {
        ws?.close();
      } catch {
        // socket may already be closing
      }
      ws = null;
    }

    function finish(reachedMax: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeSocket();
      resolve({ events, reachedMax });
    }

    function fail(err: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeSocket();
      reject(err);
    }

    try {
      ws = new WebSocket(url);
    } catch (err) {
      fail(err);
      return;
    }

    ws.onmessage = (e: MessageEvent) => {
      if (settled) return;
      const raw = typeof e.data === 'string' ? e.data : '';
      ingress += raw.length;
      if (ingress > MAX_INGRESS_BYTES) {
        finish(events.length >= maxEvents);
        return;
      }
      let data: JetstreamMessage;
      try {
        data = JSON.parse(raw) as JetstreamMessage;
      } catch {
        return;
      }
      const commit = data.commit;
      if (data.kind !== 'commit' || !commit?.collection || !commit.operation || !commit.rkey) return;
      if (!operations.has(commit.operation)) return;

      const event: CollectedEvent = {
        did: data.did ?? '',
        seenAt: data.time_us ? new Date(data.time_us / 1000).toISOString() : '',
        operation: commit.operation,
        collection: commit.collection,
        rkey: commit.rkey,
        uri: toAtUri({ did: data.did ?? '', collection: commit.collection, rkey: commit.rkey }),
        cid: commit.cid ?? null,
        record: commit.record ?? null,
        link: recordLink(data.did ?? '', commit.collection, commit.rkey),
      };

      // Measure before keeping it: one outsized record should end the window
      // rather than be returned and blow the payload budget.
      const size = JSON.stringify(event).length;
      if (bytes + size > MAX_PAYLOAD_BYTES) {
        finish(events.length > 0);
        return;
      }
      bytes += size;
      events.push(event);
      if (events.length >= maxEvents) finish(true);
    };

    // A socket error with nothing collected is a real failure; once events are
    // in hand, prefer returning them over failing the whole call.
    ws.onerror = () => {
      if (events.length === 0) {
        fail(
          new McpToolError(
            'upstream_error',
            'Could not connect to Jetstream',
            'Safe to retry shortly.',
          ),
        );
      } else {
        finish(false);
      }
    };

    // Jetstream closing early (an unusable filter, a restart) would otherwise
    // leave the caller waiting out the whole window for events that can no
    // longer arrive.
    ws.onclose = () => {
      if (events.length === 0) {
        fail(
          new McpToolError(
            'upstream_error',
            'Jetstream closed the connection',
            'Check that the collections and dids you passed are well formed, then retry.',
          ),
        );
      } else {
        finish(false);
      }
    };
  });
}

export function registerJetstreamTools(server: McpServer): void {
  server.registerTool(
    'sample_jetstream',
    {
      title: 'Tap Jetstream, the live event stream',
      description:
        'You want a live sample of what is happening on the network right now: open Jetstream ' +
        'for a few seconds and return the events seen. Filter by collections (which record ' +
        'types), by dids (watch specific accounts live), and by operation (create/update/delete). ' +
        'Bounded by a short time budget and an event cap; an empty result means the window was ' +
        'quiet, not an error. Use sample_recent_records for the historical version.',
      inputSchema: z.object({
        collections: z
          .array(z.string().min(1).max(512))
          .max(20)
          .optional()
          .describe('NSIDs to include, e.g. ["app.bsky.feed.post"]. Omit for all collections.'),
        dids: z
          .array(z.string().min(1).max(256))
          .max(20)
          .optional()
          .describe('DIDs to watch. Omit to watch the whole network.'),
        operations: z
          .array(z.enum(['create', 'update', 'delete']))
          .min(1)
          .max(3)
          .optional()
          .describe('Which commit operations to include; default ["create"].'),
        max_events: z
          .number()
          .int()
          .min(1)
          .max(MAX_EVENTS)
          .optional()
          .describe('Stop after this many matching events. Default 20.'),
        duration_seconds: z
          .number()
          .int()
          .min(1)
          .max(MAX_DURATION_SECONDS)
          .optional()
          .describe(`Stop after this many seconds. Default 5, max ${MAX_DURATION_SECONDS}.`),
      }),
      // idempotentHint describes effects on the environment, and is only
      // meaningful when readOnlyHint is false, so a read-only tool must not
      // claim non-idempotence just because its answer changes between calls.
      annotations: READ_ONLY,
    },
    toolHandler(async ({ collections, dids, operations, max_events, duration_seconds }) => {
      // Jetstream rejects the whole subscription on a malformed filter, which
      // would otherwise surface as a mysterious early close after the caller
      // had already spent their window. Say what is wrong instead.
      const badCollections = (collections ?? []).filter((c) => !isValidNsid(c));
      if (badCollections.length) {
        throw new McpToolError(
          'invalid_parameter',
          `Not valid NSIDs: ${badCollections.slice(0, 3).join(', ')}`,
          'Collections are lexicon NSIDs like app.bsky.feed.post; search_lexicons finds them.',
        );
      }
      const badDids = (dids ?? []).filter((d) => !isValidDid(d));
      if (badDids.length) {
        throw new McpToolError(
          'invalid_parameter',
          `Not valid DIDs: ${badDids.slice(0, 3).join(', ')}`,
          'Jetstream filters by DID, not handle; resolve_identity converts one.',
        );
      }

      const maxEvents = max_events ?? 20;
      const durationSeconds = duration_seconds ?? 5;
      const ops = new Set<Operation>(
        operations && operations.length ? operations : ['create'],
      );

      const { events, reachedMax } = await collectJetstream({
        collections: collections ?? [],
        dids: dids ?? [],
        operations: ops,
        maxEvents,
        durationMs: durationSeconds * 1000,
      });

      return {
        window: { durationSeconds, maxEvents, operations: [...ops] },
        count: events.length,
        reachedMax,
        // False + count 0 means the window elapsed quietly; try a longer
        // window, broader collections, or no did filter.
        events,
      };
    }),
  );
}

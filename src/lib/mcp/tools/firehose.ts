/**
 * Firehose tool: a bounded, live tap into Jetstream.
 *
 * The MCP protocol is stateless request/response, so this cannot stream — but
 * an agent rarely wants an unbounded stream anyway. sample_firehose opens a
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
import { McpToolError } from '@/lib/mcp/errors';
import { toolHandler, recordLink } from '@/lib/mcp/respond';

const MAX_DURATION_SECONDS = 15;
const MAX_EVENTS = 100;

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
function collectFirehose(opts: {
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
      reject(new McpToolError('internal_error', 'This runtime has no WebSocket; the firehose is unavailable here'));
      return;
    }

    const events: CollectedEvent[] = [];
    let settled = false;
    let ws: WebSocket;

    const timer = setTimeout(() => finish(false), durationMs);

    function finish(reachedMax: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // socket may already be closing
      }
      resolve({ events, reachedMax });
    }

    try {
      ws = new WebSocket(url);
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }

    ws.onmessage = (e: MessageEvent) => {
      if (settled) return;
      let data: JetstreamMessage;
      try {
        data = JSON.parse(typeof e.data === 'string' ? e.data : '') as JetstreamMessage;
      } catch {
        return;
      }
      const commit = data.commit;
      if (data.kind !== 'commit' || !commit?.collection || !commit.operation || !commit.rkey) return;
      if (!operations.has(commit.operation)) return;

      events.push({
        did: data.did ?? '',
        seenAt: data.time_us ? new Date(data.time_us / 1000).toISOString() : '',
        operation: commit.operation,
        collection: commit.collection,
        rkey: commit.rkey,
        uri: toAtUri({ did: data.did ?? '', collection: commit.collection, rkey: commit.rkey }),
        cid: commit.cid ?? null,
        record: commit.record ?? null,
        link: recordLink(data.did ?? '', commit.collection, commit.rkey),
      });
      if (events.length >= maxEvents) finish(true);
    };

    ws.onerror = () => {
      // A socket error with nothing collected is a real failure; once we have
      // events, prefer returning them over failing the whole call.
      if (events.length === 0 && !settled) {
        settled = true;
        clearTimeout(timer);
        reject(new McpToolError('upstream_error', 'Could not connect to the Jetstream firehose', 'Safe to retry shortly.'));
      } else {
        finish(false);
      }
    };
  });
}

export function registerFirehoseTools(server: McpServer): void {
  server.registerTool(
    'sample_firehose',
    {
      title: 'Tap the live firehose (Jetstream)',
      description:
        'You want a live sample of what is happening on the network right now: open the Jetstream ' +
        'firehose for a few seconds and return the events seen. Filter by collections (which record ' +
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
      annotations: {
        readOnlyHint: true,
        // Not idempotent: two calls see different live events.
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    toolHandler(async ({ collections, dids, operations, max_events, duration_seconds }) => {
      const maxEvents = max_events ?? 20;
      const durationSeconds = duration_seconds ?? 5;
      const ops = new Set<Operation>(
        operations && operations.length ? operations : ['create'],
      );

      const { events, reachedMax } = await collectFirehose({
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

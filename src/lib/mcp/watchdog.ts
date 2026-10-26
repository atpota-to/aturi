/**
 * Where a request was when it stopped moving.
 *
 * The tool timings in instrument.ts answer "which tool is slow". They said
 * nothing about the timeouts still coming out of /api/mcp, which is itself
 * the finding: whatever hangs is not a tool handler, because a handler slow
 * enough to matter would have given up on its budget at 25s and logged it.
 *
 * The shape of the request is not what it looks like from the outside, and
 * getting this wrong costs a deploy, so: `await mcpHandler(request)` does not
 * wait for the work. It comes back in tens of milliseconds holding a Response
 * whose body is still being produced, and the tool runs inside that stream.
 * Measured against this route, the handler returned at 69ms on a call the
 * client experienced as six seconds. Everything that takes time, and every
 * way a request can fail to finish, is downstream of that return — so a
 * watchdog cleared when the handler returns measures nothing at all, and the
 * platform's timeout means the response stream did not end, not that some
 * function call ran long.
 *
 * Three posts, then, and the last is where the time lives:
 *
 *   reading-body  mcp-handler is parsing the JSON-RPC envelope, with a bare
 *                 `await req.clone().json()` and no timeout of its own, so a
 *                 body that stops arriving mid-transfer waits here forever
 *                 having run no tool and logged nothing.
 *   dispatching   the envelope parsed; method and tool are known from here.
 *   streaming     headers are out and the body is still being written. A tool
 *                 that is merely slow shows up here, and so does a stream
 *                 nobody is draining.
 *
 * The watchdog runs from the first byte to the last, and is cleared when the
 * body closes, errors, or is cancelled — not when the handler returns. What
 * it prints is the post the request had reached, the method and tool if they
 * are known by then, and enough of the request headers to say who sent it.
 *
 * Diagnostic scaffolding. It exists to settle that question and should come
 * out once it has.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout, clearTimeout } from 'node:timers';

/**
 * Under maxDuration so a stuck request still gets to speak, and above the 25s
 * tool budget so an ordinary give-up has already resolved into a real answer
 * before this fires.
 */
export const WATCHDOG_MS = 30_000;

export type Stage = 'reading-body' | 'dispatching' | 'streaming';

export type RequestPhase = {
  stage: Stage;
  method?: string;
  tool?: string;
};

const inFlight = new AsyncLocalStorage<RequestPhase>();

/**
 * The phase of the request being served on this async context, for the
 * mcp-handler event hook to annotate. Undefined off a request, which is the
 * hook's cue to do nothing.
 */
export function currentPhase(): RequestPhase | undefined {
  return inFlight.getStore();
}

/** Header value, trimmed to something a log line can carry. */
function header(request: Request, name: string): string {
  return (request.headers.get(name) ?? '').slice(0, 120) || '-';
}

/**
 * The line a stuck request leaves behind. Exported because it is the whole
 * output of this module — the thing someone will be reading in the log a week
 * from now — and asserting on its shape is cheaper than waiting out a
 * watchdog to see it.
 */
export function describeStuckRequest(
  request: Request,
  phase: RequestPhase,
  elapsed: number,
): string {
  const named = [
    phase.method ? `method=${phase.method}` : '',
    phase.tool ? `tool=${phase.tool}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    `[mcp] ${request.method} stuck in ${phase.stage} after ${elapsed}ms` +
    (named ? ` ${named}` : '') +
    ` ua="${header(request, 'user-agent')}"` +
    ` content-length=${header(request, 'content-length')}` +
    ` accept="${header(request, 'accept')}"`
  );
}

/**
 * Pass the body through unchanged, and say when it ends.
 *
 * Explicitly, rather than through a TransformStream, because every terminal
 * path has to clear the watchdog and a transformer only offers some of them.
 * `pull` is called on demand, so the reader's own backpressure carries
 * through and a client that stops draining still stalls the writer — which is
 * one of the things being measured here and must not be papered over.
 */
function traceBodyEnd(
  body: ReadableStream<Uint8Array>,
  ended: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          ended();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        ended();
        controller.error(err);
      }
    },
    cancel(reason) {
      ended();
      return reader.cancel(reason);
    },
  });
}

/**
 * Run the handler with a phase attached, and say so if the request is still
 * going when the watchdog fires.
 */
export async function watchRequest(
  request: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  const started = Date.now();
  const phase: RequestPhase = { stage: 'reading-body' };

  const watchdog = setTimeout(() => {
    console.warn(describeStuckRequest(request, phase, Date.now() - started));
  }, WATCHDOG_MS);
  // The instance outlives the invocation under fluid compute, so a timer left
  // armed would eventually fire against a request that finished long ago.
  // Unref keeps it from holding anything open; clearing it on every exit is
  // what keeps it honest.
  watchdog.unref();
  const stop = () => clearTimeout(watchdog);

  let response: Response;
  try {
    response = await inFlight.run(phase, run);
  } catch (err) {
    stop();
    throw err;
  }

  phase.stage = 'streaming';
  if (!response.body) {
    stop();
    return response;
  }

  // Rebuilt around the traced body, which is the one case where rebuilding is
  // right: status, statusText and headers carry over verbatim and the body
  // stays a stream, so nothing the transport set is lost.
  return new Response(traceBodyEnd(response.body, stop), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

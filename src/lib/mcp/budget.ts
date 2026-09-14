/**
 * Wall-clock budgets for one MCP tool call.
 *
 * Every outbound request here is already bounded on its own: 8s per attempt in
 * upstreamFetch, the same 8s in requestDeadline for the clients that fetch
 * bare. Nothing bounded their sum. The tools that take an arbitrary identifier
 * resolve it and then walk the repo behind it, which is half a dozen
 * sequential calls against hosts this server does not control, and at 8s plus
 * a retry apiece that total clears a minute with every individual step
 * behaving exactly as designed. The invocation then dies on the platform's own
 * timeout, and what the caller is left holding is not an error it can act on:
 * it is an SSE stream that stops mid-air with no JSON-RPC response on it.
 *
 * A budget turns that into an ordinary tool failure with a code and a hint.
 *
 * It cannot cancel the work it gives up on, and nothing here could: a pending
 * fetch has its own AbortSignal but no handle reaches back to it from this
 * layer, and dns.lookup runs in libuv's threadpool where it is not
 * interruptible at all. So a budget bounds what the caller waits for, not what
 * the process is still doing, which is why it sits well under the route's
 * maxDuration — the abandoned work needs room to finish before the platform
 * kills the invocation out from under it.
 */

// Imported by name so the timer is typed as Node's, which has unref(). The
// global setTimeout is ambiguous in a project that also pulls in the DOM lib.
import { setTimeout, clearTimeout } from 'node:timers';
import { McpToolError } from '@/lib/mcp/errors';

/**
 * Ceiling on one whole tool call.
 *
 * Set against the route's 60s maxDuration rather than against any tool's
 * normal runtime. The slowest legitimate call is sample_jetstream's 15s
 * window; everything else answers in under two seconds. 25s therefore refuses
 * nothing that works today, while leaving the remaining 35s to whatever the
 * abandoned work is still finishing.
 */
export const TOOL_BUDGET_MS = 25_000;

/**
 * Ceiling on one name resolution inside the SSRF guard.
 *
 * The guard resolves hostnames that come from callers and from DID documents,
 * so a name whose nameserver simply never answers is ordinary input, not an
 * attack. dns.lookup has no timeout of its own and defers to the system
 * resolver, which on Linux gives each nameserver several seconds and several
 * attempts before it gives up; it also occupies one of libuv's four threadpool
 * slots for the whole time, where it can hold up requests that had nothing to
 * do with it. Five seconds is generous for a name that is going to resolve at
 * all, and well inside the per-fetch budget that follows it.
 */
export const DNS_BUDGET_MS = 5_000;

/**
 * Resolve `work`, or fail with an McpToolError once `ms` has passed.
 *
 * The rejection is upstream_error because that is what it is from the agent's
 * side: some third-party host did not answer in time. Callers that need to
 * tell an expiry apart from the work's own failure can check for
 * McpToolError, which is how the guard keeps its "does not resolve" wording
 * off a timeout that resolved nothing either way.
 */
export async function withBudget<T>(
  work: Promise<T>,
  ms: number,
  message: string,
  hint?: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new McpToolError('upstream_error', message, hint)), ms);
    // A budget timer must never be the thing holding an invocation open; that
    // is the failure this module exists to stop, and it would be a poor way
    // to reintroduce it.
    timer.unref();
  });

  try {
    // race() subscribes to both, so a rejection from the branch that loses is
    // handled and cannot surface as an unhandled rejection later.
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

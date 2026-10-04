/**
 * Per-tool timing for the hosted server.
 *
 * The route is one function for thirty-odd tools, so a platform timeout says
 * only that "/api/mcp" ran too long — never which tool was waiting on what.
 * That is the whole difficulty in reading these in production: the invocation
 * that overran is also the one that died before it could say anything.
 *
 * This wraps the handler at the moment it is registered, so the name comes
 * from the registration itself and cannot drift from a string repeated at the
 * call site. Every tool gets it, including ones added later, and no tool
 * module has to remember to opt in.
 *
 * Quiet by default. A public MCP endpoint takes a lot of malformed input, and
 * a tool answering "not found" or refusing a bad argument is doing its job;
 * logging those would bury the thing worth seeing. Only duration is worth a
 * line, plus a handler that threw, which by construction should not happen —
 * toolHandler catches everything a tool can throw.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolResult } from '@/lib/mcp/errors';

/**
 * Duration that earns a log line.
 *
 * Under the 25s tool budget, so a call that gives up on the budget always
 * reports itself. sample_jetstream's window can legitimately run to 15s and
 * will show up here saying so; that is a fair price for seeing every other
 * tool that has no business taking ten seconds.
 */
export const SLOW_TOOL_MS = 10_000;

type ToolCall = (...args: unknown[]) => Promise<ToolResult>;

function timed(name: string, call: ToolCall): ToolCall {
  return async (...args) => {
    const started = Date.now();
    let threw = false;
    try {
      return await call(...args);
    } catch (err) {
      threw = true;
      throw err;
    } finally {
      const ms = Date.now() - started;
      if (threw || ms >= SLOW_TOOL_MS) {
        console.warn(`[mcp] ${name} ${threw ? 'threw' : 'slow'} after ${ms}ms`);
      }
    }
  };
}

/**
 * Wrap every tool this server registers from here on, and hand the same
 * server back.
 *
 * It shadows registerTool with an own property rather than proxying the
 * instance: an McpServer reads its own private fields, and a Proxy would hand
 * its methods a `this` their class does not recognise. The instance is ours
 * either way — mcp-handler builds a fresh one per request and passes it
 * straight to registerAtmosphereServer.
 *
 * The overloads on registerTool are elaborate and none of them are this
 * function's business: it replaces the handler and hands every other argument
 * back untouched, so restating the generics would only add something a reader
 * has to check for no benefit.
 */
export function instrumentTools(server: McpServer): McpServer {
  type Registrar = (name: string, config: unknown, handler: unknown) => unknown;
  const register = server.registerTool.bind(server) as unknown as Registrar;

  const patched: Registrar = (name, config, handler) =>
    // Both of registerTool's overloads put the handler last, so this only
    // fails to hold if the SDK grows a shape this has not seen. Passing an
    // unrecognised registration straight through loses its timings, which is
    // a diagnostic going quiet; wrapping the wrong argument would lose the
    // tool, which is the server going wrong. Prefer the quiet one.
    typeof handler === 'function'
      ? register(name, config, timed(name, handler as ToolCall))
      : register(name, config, handler);

  server.registerTool = patched as unknown as McpServer['registerTool'];
  return server;
}

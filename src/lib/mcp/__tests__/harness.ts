/**
 * Test double for McpServer registration. Captures what a tool group
 * registers so tests can assert on the surface (names, descriptions,
 * annotations, schemas) and drive handlers directly, without a transport
 * and without the network.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolResult } from '@/lib/mcp/errors';

type ZodishSchema = {
  safeParse: (input: unknown) => { success: boolean };
};

export type CapturedTool = {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: ZodishSchema;
    annotations?: Record<string, unknown>;
  };
  handler: (args: unknown) => Promise<ToolResult>;
};

export type CapturedPrompt = {
  name: string;
  config: { title?: string; description?: string };
  handler: (args: unknown) => unknown;
};

export function captureRegistrations(
  register: (server: McpServer) => void,
): { tools: Map<string, CapturedTool>; prompts: Map<string, CapturedPrompt> } {
  const tools = new Map<string, CapturedTool>();
  const prompts = new Map<string, CapturedPrompt>();

  const fake = {
    registerTool(
      name: string,
      config: CapturedTool['config'],
      handler: CapturedTool['handler'],
    ) {
      if (tools.has(name)) throw new Error(`duplicate tool: ${name}`);
      tools.set(name, { name, config, handler });
      return {};
    },
    registerPrompt(
      name: string,
      config: CapturedPrompt['config'],
      handler: CapturedPrompt['handler'],
    ) {
      if (prompts.has(name)) throw new Error(`duplicate prompt: ${name}`);
      prompts.set(name, { name, config, handler });
      return {};
    },
  };

  register(fake as unknown as McpServer);
  return { tools, prompts };
}

/** Parse a tool result's text block back into the JSON payload it carries. */
export function resultBody(result: ToolResult): Record<string, unknown> {
  const text = result.content[0]?.text ?? '';
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Descriptions are prompt real estate: long enough to carry dispatch
 * criteria, short enough not to crowd the model's context. Shared cap so
 * every group's test enforces the same budget.
 */
export const MAX_DESCRIPTION_LENGTH = 600;

/** Bytes a single tool result may occupy; mirrors respond.ts's own ceiling. */
export const MAX_RESULT_BYTES = 1_000_000;

/**
 * Ceiling on the whole `tools/list` payload, in bytes of serialized JSON.
 *
 * This is the one cost every caller pays whether or not they call anything.
 * A client that loads all schemas up front holds it for the whole
 * conversation; a client that defers schemas holds only the names, which are
 * 659 bytes of the total. Measured 2026-08-30 against the served payload:
 * 33,195 bytes across 38 tools, of which descriptions are 10,901 and input
 * schemas 15,751. That is about 8,100 tokens, or 4.1 bytes per token, if a
 * failure needs converting into the unit a caller actually budgets in.
 *
 * 48,000 leaves room for roughly sixteen more average-sized tools before the
 * budget has to be argued rather than assumed. That is the point of the
 * number: not that 48KB is correct, but that passing it should be a decision
 * someone makes rather than a thing that happens.
 */
export const MAX_TOOL_LIST_BYTES = 48_000;

/**
 * Ceiling on a single tool's entry in that payload.
 *
 * Guards the other failure mode: not forty small tools but one tool whose
 * schema grew a hundred-value enum. The mean is 873 bytes and the largest
 * (`sample_jetstream`, which carries three filter arrays) is 1,484.
 */
export const MAX_TOOL_BYTES = 2_000;

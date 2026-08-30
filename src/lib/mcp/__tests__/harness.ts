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
 * schemas 15,751.
 *
 * Bytes are the unit here because they are exact. Callers budget in tokens,
 * which are model-specific: an OpenAI tokenizer puts this list at about
 * 8,100, and Anthropic's guidance is that those undercount Claude by 15-20%,
 * so call it 9,500 and treat `messages.count_tokens` as the only figure
 * worth quoting. That is roughly 3.5 bytes per token, which is what the
 * failure message converts at.
 *
 * The ceiling is that conversion applied to a threshold someone else set.
 * Anthropic's advanced-tool-use guidance says to defer tool schemas once
 * definitions pass 10K tokens, and Claude Code applies about that number
 * automatically; the MCP client best-practices doc says the same thing as
 * 1-5% of the context window. 35,000 bytes is 10K tokens at 3.5, so this
 * catalog sits just under the line where clients stop loading it eagerly.
 *
 * That leaves only about two tools of headroom, which is the intent rather
 * than an oversight. Crossing 10K is not a bug and deferral is not a
 * punishment, but it does change what every caller's client does with this
 * server, and that should be a decision someone makes rather than a thing
 * that happens. Raising this constant is how that decision gets recorded.
 */
export const MAX_TOOL_LIST_BYTES = 35_000;

/**
 * Ceiling on a single tool's entry in that payload.
 *
 * Guards the other failure mode: not forty small tools but one tool whose
 * schema grew a hundred-value enum. The mean is 873 bytes and the largest
 * (`sample_jetstream`, which carries three filter arrays) is 1,484.
 *
 * For scale, this catalog averages about 250 tokens a tool where Anthropic's
 * published figures put the GitHub MCP server near 740 and Slack's near
 * 1,900, so the per-tool budget is generous by the standard of the servers
 * it is measured against.
 */
export const MAX_TOOL_BYTES = 2_000;

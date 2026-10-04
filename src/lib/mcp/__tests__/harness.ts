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

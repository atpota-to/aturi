/**
 * Assembles the MCP server: every tool group plus the prompts.
 *
 * The catalog is read-only by design — see docs/mcp-server-plan.md. Write
 * tools belong to a future local companion package, never to this hosted
 * surface.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import { registerResolveTools } from '@/lib/mcp/tools/resolve';
import { registerIdentityTools } from '@/lib/mcp/tools/identity';
import { registerRepoTools } from '@/lib/mcp/tools/repo';
import { registerGraphTools } from '@/lib/mcp/tools/graph';
import { registerBskyTools } from '@/lib/mcp/tools/bsky';
import { registerLexiconTools } from '@/lib/mcp/tools/lexicons';
import { registerFeedTools } from '@/lib/mcp/tools/feeds';
import { registerJetstreamTools } from '@/lib/mcp/tools/jetstream';
import { registerDocsTools } from '@/lib/mcp/tools/docs';
import { registerPrompts } from '@/lib/mcp/prompts';

/** Version of the MCP tool surface, independent of the site or REST API. */
export const MCP_SERVER_VERSION = '0.1.0';

export const MCP_SERVER_INFO = {
  // What a client shows in its connector list. The product name is
  // "Atmosphere MCP"; this is its machine-readable half.
  name: 'atmosphere',
  version: MCP_SERVER_VERSION,
} as const;

export function registerAtmosphereServer(server: McpServer): void {
  registerResolveTools(server);
  registerIdentityTools(server);
  registerRepoTools(server);
  registerGraphTools(server);
  registerBskyTools(server);
  registerLexiconTools(server);
  registerFeedTools(server);
  registerJetstreamTools(server);
  registerDocsTools(server);
  registerPrompts(server);
}

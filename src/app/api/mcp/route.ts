import { createMcpHandler } from 'mcp-handler';
import {
  registerAtmosphereServer,
  MCP_SERVER_INFO,
} from '@/lib/mcp/registry';

/**
 * /api/mcp — the Model Context Protocol endpoint. Serves the 2026-07-28
 * stateless protocol natively and 2025-era Streamable HTTP through the
 * handler's fallback, from this single route. The human-readable companion
 * (what this is, how to add it to a client) lives at /mcp.
 *
 * Node runtime rather than edge: the tool layer reuses the same protocol
 * clients as the server-rendered explorer pages. Sixty seconds covers the
 * worst tool (a records-mode backlink walk is several sequential upstream
 * calls, each already bounded to 8s by upstreamFetch).
 */
export const maxDuration = 60;

const handler = createMcpHandler(registerAtmosphereServer, {
  serverInfo: MCP_SERVER_INFO,
});

export { handler as GET, handler as POST, handler as DELETE };

import { createMcpHandler } from 'mcp-handler';
import {
  registerAtmosphereServer,
  MCP_SERVER_INFO,
} from '@/lib/mcp/registry';

/**
 * /api/mcp — the Model Context Protocol endpoint, stateless Streamable HTTP.
 *
 * It negotiates whatever revision the client asks for out of the SDK's
 * supported set, which is 2025-11-25 (the newest it implements) back to
 * 2024-10-07. Note that mcp-handler's own README advertises the 2026-07-28
 * revision, but the installed @modelcontextprotocol/server does not list it
 * in SUPPORTED_PROTOCOL_VERSIONS, so a client requesting it is answered with
 * 2025-11-25 instead. Check that constant before repeating a version claim
 * anywhere user-facing.
 *
 * Node runtime rather than edge: the tool layer reuses the same protocol
 * clients as the server-rendered explorer pages. Sixty seconds covers the
 * worst tool (a records-mode backlink walk is several sequential upstream
 * calls, each already bounded to 8s by upstreamFetch).
 */
export const maxDuration = 60;

/**
 * Browser-based MCP clients (the hosted Inspector, in-page agents) send a
 * preflight before every call and drop the response without these. The server
 * is public, keyless and read-only, so there is no origin worth restricting to
 * and nothing a cross-origin caller could reach that a curl could not; the
 * headers mirror what /api/resolve and /api/waypoints already send.
 *
 * The tradeoff, recorded so it reads as a decision rather than an oversight:
 * with `*`, a web page can make each of its visitors call this endpoint from
 * their own address, spreading load over as many IPs as it has readers and
 * diluting a per-IP rate limit. That is already true of every keyless endpoint
 * here. If it becomes a problem the answer is a global budget at the edge, not
 * an origin allowlist: a real MCP client sends no Origin at all and an
 * allowlist would shut it out while stopping none of this.
 *
 * `mcp-session-id` and `mcp-protocol-version` are the transport's own headers,
 * and must be both accepted on the request and exposed on the response for a
 * browser client to read them back.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
};

const mcpHandler = createMcpHandler(registerAtmosphereServer, {
  serverInfo: MCP_SERVER_INFO,
});

async function handler(request: Request): Promise<Response> {
  const response = await mcpHandler(request);
  // Copy onto the existing response rather than rebuilding it: the transport
  // sets its own status, body stream and headers, and reconstructing would
  // break streaming.
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export { handler as GET, handler as POST, handler as DELETE };

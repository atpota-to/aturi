import { createMcpHandler } from 'mcp-handler';
import {
  registerAtmosphereServer,
  MCP_SERVER_INFO,
} from '@/lib/mcp/registry';
import { currentPhase, watchRequest } from '@/lib/mcp/watchdog';

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
 * clients as the server-rendered explorer pages.
 *
 * Sixty seconds is deliberately not the thing that bounds a tool call — the
 * 25s budget in lib/mcp/budget.ts is, and it answers the caller rather than
 * dropping the stream on the floor. This is the outer net, sized for what a
 * budget cannot cancel: an abandoned dns.lookup is not interruptible, so an
 * invocation can still be busy for a while after its response has gone out,
 * and killing it at 30 would put that ordinary tail back in the error log as
 * a timeout. The platform would allow far more (Pro tops out at 800s), but
 * nothing here has any business running that long, and a cap that generous
 * would only let a stuck invocation cost more before it died.
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
  /**
   * This catalog never changes, so say so.
   *
   * registerTool turns tools.listChanged on unless it is told otherwise, and
   * registerPrompt does the same, which is how this endpoint came to advertise
   * a capability nothing here can exercise: the server is rebuilt per request
   * from a static registry, and no code path emits a list-changed
   * notification. A client reading those bits does the reasonable thing and
   * opens a subscriptions/listen stream to receive them — and that stream is
   * meant to stay open until the client hangs up, which on a function with a
   * sixty second ceiling means it is killed instead, roughly a hundred times
   * an hour, having delivered nothing but keepalives. Every timeout this route
   * logged came from exactly that, and nothing else.
   *
   * Declaring the bits false is the honest fix rather than the workaround: a
   * long-lived server-to-client channel is not something a stateless function
   * can hold, and a catalog fixed at build time has nothing to send over one.
   */
  capabilities: {
    tools: { listChanged: false },
    prompts: { listChanged: false },
  },
  /**
   * And refuse the stream outright, for clients that ask anyway.
   *
   * The capability bits are advice; this is the part that cannot be ignored.
   * A refusal costs the caller a fraction of a second instead of occupying an
   * invocation until the platform kills it. The SDK spends its own wording on
   * the rejection ("Subscription limit reached", which is true in the letter
   * of a zero limit if not the spirit), and that is worth the trade over
   * hanging.
   */
  maxSubscriptions: 0,
  /**
   * The handler fires this the moment it has parsed an envelope, which is the
   * only signal from inside it that the body arrived at all. One handler
   * serves every request, so the phase it annotates comes from the async
   * context rather than from here.
   */
  onEvent(event) {
    if (event.type !== 'REQUEST_RECEIVED') return;
    const phase = currentPhase();
    if (!phase) return;

    phase.stage = 'dispatching';
    phase.method = event.method;
    const params = (event.parameters as { params?: { name?: unknown } } | undefined)?.params;
    if (typeof params?.name === 'string') phase.tool = params.name;
  },
});

async function handler(request: Request): Promise<Response> {
  const response = await watchRequest(request, () => mcpHandler(request));
  // Set onto whatever response comes back rather than building another one
  // around it. The transport chooses its own status and headers and answers
  // with a body still being written, so anything that rebuilds here has to
  // carry all three across intact; watchRequest does exactly that and is the
  // only thing in this route allowed to.
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export { handler as GET, handler as POST, handler as DELETE };

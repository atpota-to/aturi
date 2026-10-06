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
import { instrumentTools } from '@/lib/mcp/instrument';

/** Version of the MCP tool surface, independent of the site or REST API. */
export const MCP_SERVER_VERSION = '0.1.0';

export const MCP_SERVER_INFO = {
  // What a client shows in its connector list. The product name is
  // "Atmosphere MCP"; this is its machine-readable half.
  name: 'atmosphere',
  version: MCP_SERVER_VERSION,
} as const;

type Registrar = (...args: unknown[]) => unknown;

/** One registerTool or registerPrompt call, captured verbatim for replay. */
type Registration = {
  method: 'registerTool' | 'registerPrompt';
  args: unknown[];
};

type JsonSchemaHost = {
  '~standard'?: { jsonSchema?: Record<'input' | 'output', (options?: unknown) => unknown> };
};

/**
 * Memoize a schema's JSON Schema conversion on the schema itself.
 *
 * The SDK converts every tool's input schema through its Standard JSON
 * Schema hook once at registration and again for tools/list. Because the
 * catalog below is recorded once, these are the same schema objects on every
 * request, so the conversion only has to happen once too. Results are kept
 * as JSON text and parsed per call, so each caller gets its own copy and
 * nothing the SDK does to one can reach another request. A conversion that
 * throws is not cached and throws again next time, as before.
 */
function memoizeJsonSchema(schema: unknown): void {
  const standard = (schema as JsonSchemaHost | undefined)?.['~standard'];
  const convert = standard?.jsonSchema;
  if (!standard || !convert) return;

  const cache = new Map<string, string>();
  const memoized = (io: 'input' | 'output') => (options?: unknown) => {
    const key = `${io} ${JSON.stringify(options ?? null)}`;
    let json = cache.get(key);
    if (json === undefined) {
      json = JSON.stringify(convert[io](options));
      cache.set(key, json);
    }
    return JSON.parse(json) as unknown;
  };
  standard.jsonSchema = { input: memoized('input'), output: memoized('output') };
}

/**
 * Every tool and prompt registration, recorded once per server instance.
 *
 * mcp-handler is stateless: it builds a fresh McpServer for each request and
 * hands it here. Running the groups each time rebuilt all their zod schemas
 * and re-converted each one to JSON Schema: ~30ms of CPU on every MCP
 * request before it did any work, initialize and a refused call included.
 * Replaying a recorded catalog brought that to ~3ms in local benchmarks of
 * the route handler. The catalog cannot vary between requests (this
 * function receives no request, and the groups only ever call registerTool
 * and registerPrompt), so the groups run once against a recorder and each
 * request replays the result onto its own server.
 *
 * Replay hands every request the same config objects and handlers. Both are
 * safe to share: the SDK reads configs without mutating them, handlers keep
 * no state between calls, and zod schemas are made to be parsed from module
 * scope. A group that starts calling anything else on the server will fail
 * here on its first request rather than misbehave quietly, because the
 * recorder has nothing else to call.
 */
let catalog: Registration[] | undefined;

function recordCatalog(): Registration[] {
  const recorded: Registration[] = [];
  const record =
    (method: Registration['method']): Registrar =>
    (...args) => {
      recorded.push({ method, args });
    };
  const recorder = {
    registerTool: record('registerTool'),
    registerPrompt: record('registerPrompt'),
  } as unknown as McpServer;

  registerResolveTools(recorder);
  registerIdentityTools(recorder);
  registerRepoTools(recorder);
  registerGraphTools(recorder);
  registerBskyTools(recorder);
  registerLexiconTools(recorder);
  registerFeedTools(recorder);
  registerJetstreamTools(recorder);
  registerDocsTools(recorder);
  registerPrompts(recorder);

  for (const { args } of recorded) {
    const config = args[1] as Record<string, unknown> | undefined;
    memoizeJsonSchema(config?.inputSchema);
    memoizeJsonSchema(config?.outputSchema);
    memoizeJsonSchema(config?.argsSchema);
  }
  return recorded;
}

export function registerAtmosphereServer(server: McpServer): void {
  catalog ??= recordCatalog();

  // Per request, before anything registers, so every tool is timed. The
  // per-group tests register against their own double and bypass this; what
  // they cover is the tool bodies, which this does not touch.
  const timed = instrumentTools(server) as unknown as Record<Registration['method'], Registrar>;

  for (const { method, args } of catalog) {
    timed[method](...args);
  }
}

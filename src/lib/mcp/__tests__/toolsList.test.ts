import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpHandler } from 'mcp-handler';
import {
  registerAtmosphereServer,
  MCP_SERVER_INFO,
} from '@/lib/mcp/registry';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_TOOL_BYTES,
  MAX_TOOL_LIST_BYTES,
} from '@/lib/mcp/__tests__/harness';

/**
 * What the catalog costs before a single tool is called.
 *
 * The rest of the suite asserts what tools do. This asserts what they weigh:
 * `tools/list` is the one payload every caller pays for whether or not they
 * use it, and in most clients it lands in the model's context next to the
 * system prompt and stays there for the conversation.
 *
 * It goes through the real handler rather than the registration harness on
 * purpose. The harness captures zod schemas; what a client receives is those
 * schemas converted to JSON Schema and serialized by the SDK, which is both
 * larger and not ours to predict. Measuring anything else would assert on a
 * number no caller ever sees.
 *
 * Bytes, not tokens, because bytes are exact, tokenizer-independent and need
 * no dependency the rest of this suite does not already have. The harness
 * records the conversion for anyone reading a failure in tokens.
 */

/** The tools array as an MCP client receives it. */
async function fetchToolsList(): Promise<Record<string, unknown>[]> {
  const handler = createMcpHandler(registerAtmosphereServer, {
    serverInfo: MCP_SERVER_INFO,
  });

  const call = (body: unknown) =>
    handler(
      new Request('https://aturi.to/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
      }),
    );

  await call({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'size-budget-test', version: '0' },
    },
  });

  const response = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const raw = await response.text();

  // The transport answers as SSE regardless of the Accept ordering, so the
  // JSON-RPC envelope arrives as a `data:` line rather than the whole body.
  const line = raw.split('\n').find((l) => l.startsWith('data: '));
  assert.ok(line, `tools/list did not return an SSE data frame:\n${raw.slice(0, 200)}`);
  const payload = JSON.parse(line.slice('data: '.length));
  assert.ok(payload.result?.tools, `tools/list returned no tools: ${line.slice(0, 200)}`);
  return payload.result.tools as Record<string, unknown>[];
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const tools = await fetchToolsList();

test('the tool list fits the context budget it is allowed', () => {
  const total = bytes(tools);
  // Reported on failure so the next person does not have to re-measure to
  // decide whether to trim or to raise the ceiling.
  const descriptions = tools.reduce((sum, t) => sum + Buffer.byteLength(String(t.description ?? '')), 0);
  const schemas = tools.reduce((sum, t) => sum + bytes(t.inputSchema), 0);
  assert.ok(
    total <= MAX_TOOL_LIST_BYTES,
    `tools/list is ${total} bytes over ${tools.length} tools, past the ${MAX_TOOL_LIST_BYTES} budget ` +
      `(descriptions ${descriptions}, schemas ${schemas}, ~${Math.round(total / 4.1)} tokens). ` +
      `Trim descriptions or schemas, or raise MAX_TOOL_LIST_BYTES and say why in the plan's design record.`,
  );
});

test('no single tool dominates the list', () => {
  const oversized = tools
    .map((t) => ({ name: String(t.name), size: bytes(t) }))
    .filter((t) => t.size > MAX_TOOL_BYTES);
  assert.deepEqual(
    oversized,
    [],
    `over the ${MAX_TOOL_BYTES}-byte per-tool budget: ${oversized
      .map((t) => `${t.name} (${t.size})`)
      .join(', ')}`,
  );
});

test('every served tool carries the fields a client routes on', () => {
  // A tool that reaches the wire without a description is one an agent has to
  // guess at, and the description cap is enforced per group against the zod
  // config rather than against what ships. This is the same rule applied to
  // the served payload, so a tool group added without its own test still
  // cannot skip it.
  for (const tool of tools) {
    const name = String(tool.name);
    assert.ok(typeof tool.description === 'string' && tool.description.length > 0, `${name} has no description`);
    assert.ok(
      String(tool.description).length <= MAX_DESCRIPTION_LENGTH,
      `${name} description is ${String(tool.description).length} chars, over ${MAX_DESCRIPTION_LENGTH}`,
    );
    assert.equal(typeof tool.title, 'string', `${name} has no title`);
    const schema = tool.inputSchema as { type?: string } | undefined;
    assert.equal(schema?.type, 'object', `${name} inputSchema is not a JSON Schema object`);
    assert.equal(
      (tool.annotations as { readOnlyHint?: boolean } | undefined)?.readOnlyHint,
      true,
      `${name} is not marked read-only, and this server is read-only by design`,
    );
  }
});

test('a client that defers schemas pays only for the names', () => {
  // The cheap path this catalog is meant to stay friendly to: clients that
  // list names and fetch a schema on demand. If names alone ever stopped
  // being a rounding error, tool naming would have gone badly wrong.
  const names = bytes(tools.map((t) => t.name));
  assert.ok(
    names < MAX_TOOL_LIST_BYTES / 20,
    `names alone are ${names} bytes, no longer cheap next to the ${MAX_TOOL_LIST_BYTES} full list`,
  );
});

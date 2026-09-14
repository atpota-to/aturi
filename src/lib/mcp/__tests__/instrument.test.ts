import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/server';
import type { ToolResult } from '@/lib/mcp/errors';
import { instrumentTools } from '@/lib/mcp/instrument';

const CONFIG = { description: 'a tool', inputSchema: {} };
const ok: ToolResult = { content: [{ type: 'text', text: 'hi' }] };

type Handler = () => Promise<ToolResult>;
type Registrar = (name: string, config: unknown, handler: unknown) => unknown;

/**
 * A real McpServer with a tap between the instrumentation and the SDK, so a
 * test can hold the handler the server actually received — the wrapped one —
 * rather than the one the tool module passed in. The tap goes on first;
 * instrumentTools then patches on top of it, which is the same order the real
 * registry uses.
 */
function tapped() {
  const server = new McpServer({ name: 'test', version: '0' });
  const base = server.registerTool.bind(server) as unknown as Registrar;

  let received: Handler | undefined;
  const tap: Registrar = (name, config, handler) => {
    received = handler as Handler;
    return base(name, config, handler);
  };
  server.registerTool = tap as unknown as McpServer['registerTool'];

  instrumentTools(server);
  return { server, registered: () => received };
}

test('instrumented registration still reaches the real server', () => {
  const server = instrumentTools(new McpServer({ name: 'test', version: '0' }));
  server.registerTool('once', CONFIG, async () => ok);

  // The SDK is what rejects a duplicate name. Seeing that refusal is how this
  // knows the wrapper handed the registration on rather than swallowing it.
  assert.throws(() => server.registerTool('once', CONFIG, async () => ok), /already registered/);
});

test('the handler is wrapped, and answers exactly what the tool answered', async () => {
  const { server, registered } = tapped();
  const original = async () => ok;
  server.registerTool('wrapped', CONFIG, original);

  assert.notEqual(registered(), original, 'the raw handler should not be what got registered');
  assert.deepEqual(await registered()!(), ok);
});

test('an ordinary fast call says nothing', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    const { server, registered } = tapped();
    server.registerTool('quiet', CONFIG, async () => ok);
    await registered()!();
    assert.equal(warn.mock.callCount(), 0, 'a healthy call is not news');
  } finally {
    warn.mock.restore();
  }
});

test('a handler that throws is named in the log, and the throw still propagates', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    const { server, registered } = tapped();
    server.registerTool('explodes', CONFIG, async () => {
      throw new Error('boom');
    });

    await assert.rejects(registered()!(), /boom/);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0].arguments[0]), /\[mcp\] explodes threw after \d+ms/);
  } finally {
    warn.mock.restore();
  }
});

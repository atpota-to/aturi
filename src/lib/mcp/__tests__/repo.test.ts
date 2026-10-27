import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerRepoTools } from '@/lib/mcp/tools/repo';
import {
  captureRegistrations,
  resultBody,
  MAX_DESCRIPTION_LENGTH,
} from '@/lib/mcp/__tests__/harness';

const { tools } = captureRegistrations(registerRepoTools);

test('registers exactly the repo tools', () => {
  assert.deepEqual(
    [...tools.keys()].sort(),
    ['describe_pds', 'describe_repo', 'get_record', 'list_records'],
  );
});

test('every tool carries a title, a bounded description, and read-only annotations', () => {
  for (const tool of tools.values()) {
    assert.ok(tool.config.title, `${tool.name} has no title`);
    assert.ok(
      (tool.config.description ?? '').length <= MAX_DESCRIPTION_LENGTH,
      `${tool.name} description exceeds the budget`,
    );
    assert.equal(tool.config.annotations?.readOnlyHint, true, tool.name);
    assert.equal(tool.config.annotations?.openWorldHint, true, tool.name);
  }
});

test('list_records schema bounds limit and requires the pair', () => {
  const schema = tools.get('list_records')!.config.inputSchema!;
  assert.equal(schema.safeParse({ identifier: 'a.b' }).success, false);
  assert.equal(
    schema.safeParse({ identifier: 'a.b', collection: 'app.bsky.feed.post', limit: 101 }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ identifier: 'a.b', collection: 'app.bsky.feed.post', limit: 100 }).success,
    true,
  );
});

test('list_records rejects a non-NSID collection before touching the network', async () => {
  const result = await tools.get('list_records')!.handler({
    identifier: 'did:plc:abc',
    collection: 'not an nsid',
  });
  assert.equal(result.isError, true);
  assert.equal(resultBody(result).code, 'invalid_parameter');
});

test('get_record demands either a uri or the full triple, offline', async () => {
  const missing = await tools.get('get_record')!.handler({});
  assert.equal(resultBody(missing).code, 'missing_parameter');

  const partial = await tools.get('get_record')!.handler({
    identifier: 'alice.test',
    collection: 'app.bsky.feed.post',
  });
  assert.equal(resultBody(partial).code, 'missing_parameter');

  const malformed = await tools.get('get_record')!.handler({ uri: 'at://did:plc:abc' });
  assert.equal(resultBody(malformed).code, 'invalid_parameter');
});

test('describe_pds refuses private and internal hosts, offline', async () => {
  for (const host of ['localhost', '127.0.0.1', '169.254.169.254', '10.0.0.8', 'pds.internal']) {
    const result = await tools.get('describe_pds')!.handler({ host });
    assert.equal(result.isError, true, host);
    assert.equal(resultBody(result).code, 'invalid_parameter', host);
  }
});

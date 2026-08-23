import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerFirehoseTools } from '@/lib/mcp/tools/firehose';
import { captureRegistrations, resultBody, MAX_DESCRIPTION_LENGTH } from '@/lib/mcp/__tests__/harness';

const { tools } = captureRegistrations(registerFirehoseTools);
const sample = tools.get('sample_firehose');

test('registers exactly the firehose tool', () => {
  assert.deepEqual([...tools.keys()], ['sample_firehose']);
});

test('carries a title, a bounded description, and read-only annotations', () => {
  assert.ok(sample?.config.title);
  assert.ok((sample?.config.description ?? '').length <= MAX_DESCRIPTION_LENGTH);
  assert.equal(sample?.config.annotations?.readOnlyHint, true);
  // idempotentHint is about effects on the environment, not about whether the
  // answer changes between calls, and the spec treats it as meaningful only
  // when readOnlyHint is false. A read-only tool claiming non-idempotence
  // reads to a client as "this one might do something".
  assert.equal(sample?.config.annotations?.idempotentHint, true);
});

test('bounds the time budget, event cap, filter arrays, and operations enum', () => {
  const schema = sample!.config.inputSchema!;
  assert.equal(schema.safeParse({}).success, true, 'all inputs optional');
  assert.equal(schema.safeParse({ duration_seconds: 16 }).success, false, 'duration capped at 15');
  assert.equal(schema.safeParse({ duration_seconds: 0 }).success, false);
  assert.equal(schema.safeParse({ max_events: 101 }).success, false, 'events capped at 100');
  assert.equal(schema.safeParse({ operations: ['create', 'boost'] }).success, false, 'unknown op');
  assert.equal(
    schema.safeParse({ collections: Array.from({ length: 21 }, (_, i) => `a.b.c${i}`) }).success,
    false,
    'collections capped at 20',
  );
  assert.equal(
    schema.safeParse({
      collections: ['app.bsky.feed.post'],
      dids: ['did:plc:abc'],
      operations: ['create', 'update', 'delete'],
      max_events: 100,
      duration_seconds: 15,
    }).success,
    true,
  );
});

test('rejects malformed collection filters before opening a socket', async () => {
  const result = await sample!.handler({ collections: ['not an nsid'], duration_seconds: 1 });
  assert.equal(result.isError, true);
  assert.equal(resultBody(result).code, 'invalid_parameter');
});

test('rejects handles where Jetstream needs DIDs, before opening a socket', async () => {
  // The filter is DID-only upstream; passing a handle would be accepted by the
  // schema and then silently match nothing.
  const result = await sample!.handler({ dids: ['alice.bsky.social'], duration_seconds: 1 });
  assert.equal(result.isError, true);
  const body = resultBody(result);
  assert.equal(body.code, 'invalid_parameter');
  assert.match(String(body.hint), /resolve_identity/);
});

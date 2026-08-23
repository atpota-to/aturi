import { test } from 'node:test';
import assert from 'node:assert/strict';
import { okResult } from '@/lib/mcp/respond';
import { MAX_RESULT_BYTES, resultBody } from '@/lib/mcp/__tests__/harness';

test('an ordinary result passes through as text plus structured content', () => {
  const result = okResult({ hello: 'world' });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent, { ok: true, hello: 'world' });
  assert.deepEqual(resultBody(result), { ok: true, hello: 'world' });
});

test('an oversized result is refused rather than flooding the caller', () => {
  // Stands in for a repo on a hostile PDS answering a legal list_records call
  // with megabytes: the tool code is correct, the upstream is the problem.
  const huge = { records: Array.from({ length: 400 }, () => ({ value: 'x'.repeat(2000) })) };
  const result = okResult(huge);
  assert.equal(result.isError, true);
  const body = resultBody(result);
  assert.equal(body.code, 'invalid_parameter');
  assert.match(String(body.error), /over the \d+KB limit/);
  assert.match(String(body.hint), /lower `limit`|cursor/);
  assert.ok(
    JSON.stringify(result).length < MAX_RESULT_BYTES,
    'the refusal itself must be small',
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiErrorBody } from '@/lib/apiError';

test('always carries ok:false, a code and a message', () => {
  assert.deepEqual(apiErrorBody('missing_parameter', 'Missing url parameter'), {
    ok: false,
    code: 'missing_parameter',
    error: 'Missing url parameter',
  });
});

test('a hint is included when there is one', () => {
  assert.deepEqual(apiErrorBody('invalid_parameter', 'Invalid url', 'Use an absolute URL.'), {
    ok: false,
    code: 'invalid_parameter',
    error: 'Invalid url',
    hint: 'Use an absolute URL.',
  });
});

test('an absent hint is omitted rather than set to null', () => {
  // Callers branch on presence: `hint` in body means there is a concrete next
  // step. A null would make every error look like it had one.
  for (const empty of [undefined, '']) {
    assert.ok(!('hint' in apiErrorBody('internal_error', 'Boom', empty)));
  }
});

test('keeps the legacy `error` field so older callers keep working', () => {
  // `code` and `hint` were added later; `error` predates them and is what
  // existing consumers read.
  assert.equal(apiErrorBody('not_found', 'Post not found').error, 'Post not found');
});

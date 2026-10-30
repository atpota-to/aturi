import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The mode is resolved from a build-time inlined constant, so these assert the
 * decision table rather than calling the function with a mutated environment.
 *
 * The rule that matters: only the exact string 'bff' selects the backend.
 * Anything else — unset, empty, a typo, or the 'auto' an earlier draft
 * suggested — falls back to the browser client. A browser cannot see whether
 * the server has a signing key and a database, so a mode that guessed
 * "backend" would send every sign-in on an unconfigured deployment to a route
 * that answers 503.
 */
function decide(raw: string | undefined): 'browser' | 'bff' {
  return raw === 'bff' ? 'bff' : 'browser';
}

test('only the exact string "bff" selects the backend client', () => {
  assert.equal(decide('bff'), 'bff');
});

test('everything else falls back to the browser client', () => {
  for (const raw of [undefined, '', 'auto', 'BFF', 'browser', 'true', '1', 'yes']) {
    assert.equal(decide(raw), 'browser', `${String(raw)} should not select the backend`);
  }
});

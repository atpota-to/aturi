import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEnvelope,
  open,
  safeEqual,
  seal,
  sha256Base64Url,
  sha256Hex,
} from '@/lib/oauth/server/crypto';
import { isRetriableConnectError } from '@/lib/oauth/server/retriable';

const KEY = '0'.repeat(64); // 32 bytes of hex

test('sealing and opening round-trips a session object', () => {
  const value = { tokenSet: { refresh_token: 'secret', scope: 'atproto' } };
  const sealed = seal(value, KEY);
  assert.ok(isEnvelope(sealed));
  assert.deepEqual(open(sealed, KEY), value);
});

test('the ciphertext does not contain the plaintext', () => {
  const sealed = seal({ refresh_token: 'a-very-distinctive-token' }, KEY);
  assert.ok(!JSON.stringify(sealed).includes('a-very-distinctive-token'));
});

test('a tampered envelope fails to open rather than opening wrong', () => {
  const sealed = seal({ a: 1 }, KEY);
  const flipped = { ...sealed, ct: Buffer.from('nope').toString('base64') };
  assert.throws(() => open(flipped, KEY));
});

test('a different key cannot open it', () => {
  const sealed = seal({ a: 1 }, KEY);
  assert.throws(() => open(sealed, 'f'.repeat(64)));
});

test('plaintext is refused rather than passed through', () => {
  // The reference implementation returns unencrypted values unchanged when no
  // key is set, so a live table could migrate gradually. These tables start
  // empty, so a plaintext row means a misconfiguration and must fail closed.
  assert.throws(() => open({ tokenSet: {} }, KEY));
});

test('a key of the wrong length is rejected', () => {
  assert.throws(() => seal({ a: 1 }, 'abcd'), /32 bytes/);
});

test('hashes are stable and the right shape', () => {
  assert.match(sha256Hex('x'), /^[0-9a-f]{64}$/);
  assert.equal(sha256Hex('x'), sha256Hex('x'));
  assert.match(sha256Base64Url('x'), /^[A-Za-z0-9_-]{43}$/);
});

test('safeEqual matches only identical strings', () => {
  assert.ok(safeEqual('abc', 'abc'));
  assert.ok(!safeEqual('abc', 'abd'));
  assert.ok(!safeEqual('abc', 'abcd'));
  assert.ok(!safeEqual('', 'a'));
});

/**
 * The retry allowlist is a correctness boundary, not a tuning knob: every code
 * on it means the connection never opened, so the request never reached the
 * PDS. A code that can fire after the PDS accepted a write must never be on
 * it, or a retried createRecord posts twice.
 */
test('only connection-establishment failures are retriable', () => {
  for (const code of ['UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) {
    assert.ok(isRetriableConnectError(Object.assign(new Error('x'), { code })), code);
  }
  for (const code of [
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'ECONNRESET',
    'UND_ERR_SOCKET',
  ]) {
    assert.ok(!isRetriableConnectError(Object.assign(new Error('x'), { code })), code);
  }
});

test('a code nested in `cause` is still found', () => {
  const err = Object.assign(new Error('fetch failed'), {
    cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
  });
  assert.ok(isRetriableConnectError(err));
});

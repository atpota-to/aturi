import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PostgrestDriver } from '@/lib/oauth/server/store/postgrest';

/**
 * The filters the driver puts on the wire.
 *
 * PostgREST compares an `eq.` operand literally, quotes and all, so a quoted
 * filter is valid syntax that matches no row. Nothing errors: reads come back
 * empty, deletes delete nothing, and the only symptom is a sign-in that never
 * finds its own state. These assert the URL rather than a round trip because
 * a mocked PostgREST would agree with whatever the driver sent.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function capture(body = '[]'): { urls: URL[] } {
  const seen = { urls: [] as URL[] };
  globalThis.fetch = (async (input: string | URL | Request) => {
    seen.urls.push(new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url));
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return seen;
}

const driver = new PostgrestDriver('https://db.example', 'service-key', 'aturi_staging');

test('select filters with an unquoted eq operand', async () => {
  const seen = capture();
  await driver.selectOne('oauth_state', { key: 'kpcMMtbjZjQibmS7en8GqA' }, 'state_data,expires_at');
  assert.equal(seen.urls[0].searchParams.get('key'), 'eq.kpcMMtbjZjQibmS7en8GqA');
});

test('values with colons and dots pass through as written', async () => {
  const seen = capture();
  await driver.select('oauth_sessions', { sub: 'did:plc:abc123', client: 'web' });
  assert.equal(seen.urls[0].searchParams.get('sub'), 'eq.did:plc:abc123');
  assert.equal(seen.urls[0].searchParams.get('client'), 'eq.web');
});

test('update and delete use the same unquoted filter', async () => {
  const seen = capture('');
  await driver.update('app_sessions', { token_sha256: 'ab12' }, { last_seen_at: 'now' });
  await driver.remove('oauth_state', { key: 'xyz' });
  assert.equal(seen.urls[0].searchParams.get('token_sha256'), 'eq.ab12');
  assert.equal(seen.urls[1].searchParams.get('key'), 'eq.xyz');
});

test('no filter value is ever wrapped in double quotes', async () => {
  const seen = capture();
  await driver.select('oauth_sessions', { sub: 'did:web:example.com', client: 'extension' });
  for (const [name, value] of seen.urls[0].searchParams) {
    if (name === 'select') continue;
    assert.ok(!value.includes('"'), `${name}=${value} is quoted`);
  }
});

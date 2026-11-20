import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { IOS_UNIVERSAL_LINK_PATHS } from '@/lib/iosApp';
import { GET } from '../../app/api/oauth/extension/return/route';

/**
 * The page Safari's extension sign-in lands on, with a live one-time code in
 * its fragment. The login route accepts it as a return target on the grounds
 * that it runs no script, reflects nothing and loads nothing; these tests are
 * what keep those grounds true.
 */

const RETURN_PATH = '/api/oauth/extension/return';
const routeFile = resolve(process.cwd(), `src/app${RETURN_PATH}/route.ts`);
const routeSrc = readFileSync(routeFile, 'utf8');

test('the landing page runs no script and loads nothing', async () => {
  const res = GET();
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.doesNotMatch(body, /<script/i);
  assert.doesNotMatch(routeSrc, /<script/i);
  // No inline handlers, links, forms or subresources either: nothing that
  // could run, navigate or send the URL anywhere.
  assert.doesNotMatch(body, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(body, /<(a|form|img|iframe|link|object|embed|base|meta http-equiv)\b/i);
  assert.doesNotMatch(body, /\b(src|href|action)\s*=/i);
  assert.doesNotMatch(body, /url\(/i);
});

test('the landing page sends the headers its safety depends on', () => {
  const res = GET();
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /(^|;\s*)default-src 'none'(;|$)/);
  assert.match(csp, /(^|;\s*)base-uri 'none'(;|$)/);
  assert.match(csp, /(^|;\s*)form-action 'none'(;|$)/);
  assert.match(csp, /(^|;\s*)frame-ancestors 'none'(;|$)/);
  assert.doesNotMatch(csp, /script-src/);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.match(res.headers.get('content-type') ?? '', /^text\/html; charset=utf-8$/);
});

test('the landing page reflects nothing from the request', async () => {
  // GET takes no request at all, which is the strongest form of this: there
  // is nothing it could echo. Pin that, so a later edit that starts reading
  // ?oauth_error has to come through here.
  assert.equal(GET.length, 0);
  assert.doesNotMatch(routeSrc, /searchParams|request\.url|\.hash\b/);
  const a = await GET().text();
  const b = await GET().text();
  assert.equal(a, b);
});

test('the landing page is not a universal link', () => {
  // If iOS handed this URL to the app instead of Safari, the code would leave
  // the browser the extension is waiting in.
  const matches = (pattern: string, path: string) => {
    const re = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
    );
    return re.test(path);
  };
  for (const pattern of IOS_UNIVERSAL_LINK_PATHS) {
    assert.ok(!matches(pattern, RETURN_PATH), `${pattern} claims ${RETURN_PATH}`);
  }
});

test('the landing page is the path the login route accepts', () => {
  const loginSrc = readFileSync(
    resolve(process.cwd(), 'src/app/api/oauth/login/route.ts'),
    'utf8',
  );
  const path = /const EXTENSION_TAB_RETURN_PATH = '([^']*)';/.exec(loginSrc)?.[1];
  assert.equal(path, RETURN_PATH);
  assert.ok(existsSync(routeFile));
  // Nothing else is routed beneath it, so the exact match in validateReturn
  // and the route directory cannot drift apart unnoticed.
  assert.deepEqual(readdirSync(resolve(process.cwd(), `src/app${RETURN_PATH}`)), ['route.ts']);
});

test('the extension can read the session-error header cross-origin', () => {
  // Safari treats the extension's fetch as cross-origin unless aturi.to is
  // granted, and a grant can be withdrawn. Without the expose header the
  // extension cannot see x-aturi-oauth-error and never notices a revoked
  // session.
  const httpSrc = readFileSync(resolve(process.cwd(), 'src/lib/oauth/server/http.ts'), 'utf8');
  const cors = /export const CORS_HEADERS[^=]*= \{([\s\S]*?)\n\};/.exec(httpSrc)?.[1] ?? '';
  const header = /export const ERROR_CODE_HEADER = '([^']+)';/.exec(httpSrc)?.[1];
  assert.ok(header, 'ERROR_CODE_HEADER is no longer where this test looks');
  const exposed = /'Access-Control-Expose-Headers':\s*'([^']*)'/.exec(cors)?.[1] ?? '';
  assert.ok(
    exposed.split(',').map((s) => s.trim().toLowerCase()).includes(header.toLowerCase()),
    `CORS_HEADERS must expose ${header}`,
  );
});

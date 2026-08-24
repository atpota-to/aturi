import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two guards on the sign-in route, tested against the source because the route
 * module cannot be imported under plain `node --test` (it pulls in next/server
 * and the whole OAuth SDK).
 */

const src = readFileSync(resolve(process.cwd(), 'src/app/api/oauth/login/route.ts'), 'utf8');

/**
 * The extension's read-only grant is enforced by the server.
 *
 * Defence in depth rather than a hole: grants are keyed (sub, client), so an
 * extension session can only restore tokens minted by an extension flow, and
 * anyone running that flow authorizes their own account. What this pins is
 * that the claim does not depend on the client — both privacy documents state
 * the extension cannot write, and only this line keeps that true regardless of
 * what a caller sends.
 */
test('an extension sign-in cannot request any scope', () => {
  const build = /const scope = buildScopeString\(([\s\S]*?)\);/.exec(src);
  assert.ok(build, 'the scope string is no longer built where this test looks');
  const expr = build[1];
  assert.match(
    expr,
    /clientParam === 'extension'\s*\?\s*new Set<ScopeId>\(\)/,
    'extension flows must resolve to the empty scope set regardless of ?scopes=',
  );
});

test('the same-site check exempts only the extension', () => {
  // Widening this exemption would remove the login-CSRF guard for the web.
  assert.match(src, /clientParam === 'web' && !startedHere\(request, origin\)/);
});

/**
 * Firefox derives its redirect host from an internal UUID randomised per
 * install, so an exact-match allowlist means Firefox sign-in can never
 * succeed. The pattern is safe because the redirect is not what authenticates
 * the extension — the code is worthless without the PKCE verifier.
 */
test('browser-reserved redirect hosts are matched by pattern', () => {
  const block = /const BROWSER_REDIRECT_HOSTS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(block, 'BROWSER_REDIRECT_HOSTS is gone');
  const patterns: RegExp[] = [];
  for (const line of block[1].split('\n')) {
    const m = /^\s*(\/.*\/[a-z]*),?\s*$/.exec(line);
    if (!m) continue;
    const lastSlash = m[1].lastIndexOf('/');
    patterns.push(new RegExp(m[1].slice(1, lastSlash), m[1].slice(lastSlash + 1)));
  }
  assert.equal(patterns.length, 3, 'expected chromiumapp, allizom and the mozoauth2 loopback');

  const accepted = [
    'https://abcdefghijklmnop.chromiumapp.org/',
    'https://3f2b1a9c-0000-4444-8888-abcdefabcdef.extensions.allizom.org/',
    'http://127.0.0.1/mozoauth2/abcdef',
  ];
  for (const url of accepted) {
    assert.ok(patterns.some((re) => re.test(url)), `should accept ${url}`);
  }

  // A pattern that reached a real host would be a takeover path: these two
  // domains are intercepted by the browser and resolve nowhere.
  const rejected = [
    'https://evil.example/',
    'https://chromiumapp.org.evil.example/',
    'https://x.chromiumapp.org.evil.example/',
    'https://x.chromiumapp.org/@evil.example',
    'http://127.0.0.1/mozoauth2/../../evil',
    'https://x.extensions.allizom.org.evil.example/',
  ];
  for (const url of rejected) {
    assert.ok(!patterns.some((re) => re.test(url)), `should reject ${url}`);
  }
});

/**
 * A failed extension sign-in has to land on the EXTENSION's return target.
 *
 * launchWebAuthFlow navigates with `Accept: text/html`, so the JSON branch
 * does not fire, and it resolves only when the navigation reaches the calling
 * extension's own redirect prefix. Sending the failure to aturi.to's homepage
 * leaves the auth window sitting there and the promise never settles — the
 * user sees a hang rather than the message.
 */
test('an extension failure redirects to the extension, not to the site', () => {
  const bail = /const bail = \([\s\S]*?\n  \};/.exec(src);
  assert.ok(bail, 'bail() is no longer where this test looks');
  const body = bail[0];

  // The extension branch must come before the web fallback and use the
  // extension's own validated target.
  const extBranch = body.indexOf("rawClient === 'extension'");
  const webFallback = body.indexOf("validateReturn(params.get('return'), 'web'");
  assert.ok(extBranch > -1, 'no extension branch in bail()');
  assert.ok(webFallback > extBranch, 'the web fallback must not run first');
  assert.match(body, /validateReturn\(\s*params\.get\('return'\),\s*'extension',/);
});

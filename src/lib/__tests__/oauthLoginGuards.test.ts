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
 * The extension's read-only grant has to be enforced by the server.
 *
 * This route is exempt from the same-site check — launchWebAuthFlow is
 * cross-site by construction, so it has to be — which makes it the one place a
 * caller other than our own extension could plausibly reach. If the scope came
 * from the caller, anything reaching it could request write access and receive
 * a grant the user believes is read-only, because that is what the extension's
 * UI and both privacy documents told them.
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

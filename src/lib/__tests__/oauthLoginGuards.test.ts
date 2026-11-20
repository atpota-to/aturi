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

/**
 * Safari's first-party return target, exercised as running code.
 *
 * The other tests here read patterns out of the source. This one needs the
 * real comparison, so it lifts `validateReturn` and the two constants it reads
 * out of the route verbatim, writes them to a scratch module and imports that
 * (the suite runs with type stripping on). Any edit to the function is what
 * gets tested; nothing is restated.
 */
async function loadValidateReturn(): Promise<
  (raw: string | null, client: 'web' | 'extension', allowed: readonly string[], origin: string) =>
    string | null
> {
  const hosts = /const BROWSER_REDIRECT_HOSTS = \[[\s\S]*?\n\];/.exec(src)?.[0];
  const path = /const EXTENSION_TAB_RETURN_PATH = '[^']*';/.exec(src)?.[0];
  const fn = /function validateReturn\([\s\S]*?\n\}\n/.exec(src)?.[0];
  assert.ok(hosts, 'BROWSER_REDIRECT_HOSTS is no longer where this test looks');
  assert.ok(path, 'EXTENSION_TAB_RETURN_PATH is no longer where this test looks');
  assert.ok(fn, 'validateReturn is no longer where this test looks');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'aturi-validate-return-'));
  try {
    const file = join(dir, 'validateReturn.ts');
    writeFileSync(file, `${hosts}\n${path}\nexport ${fn}`);
    const mod = (await import(pathToFileURL(file).href)) as {
      validateReturn: Awaited<ReturnType<typeof loadValidateReturn>>;
    };
    return mod.validateReturn;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Safari return: only this origin plus the exact path is accepted', async () => {
  const validateReturn = await loadValidateReturn();
  const origin = 'https://aturi.to';
  const exact = 'https://aturi.to/api/oauth/extension/return';

  assert.equal(validateReturn(exact, 'extension', [], origin), exact);
  // Staging returns to staging, with nothing configured.
  assert.equal(
    validateReturn(
      'https://testing.aturi.to/api/oauth/extension/return',
      'extension',
      [],
      'https://testing.aturi.to',
    ),
    'https://testing.aturi.to/api/oauth/extension/return',
  );

  const rejected = [
    'https://aturi.to/api/oauth/extension/return.evil',
    'https://aturi.to/api/oauth/extension/returnx',
    'https://aturi.to/api/oauth/extension/return/',
    'https://aturi.to/api/oauth/extension/return?x=1',
    'https://aturi.to/api/oauth/extension/return#x',
    'https://aturi.to/api/oauth/extension/return/../../callback',
    'https://aturi.to/api/oauth/extension/RETURN',
    'https://aturi.to/api/oauth/extension',
    'https://aturi.to/',
    'http://aturi.to/api/oauth/extension/return',
    'https://www.aturi.to/api/oauth/extension/return',
    'https://testing.aturi.to/api/oauth/extension/return',
    'https://aturi.to.evil.example/api/oauth/extension/return',
    'https://evil.example/api/oauth/extension/return',
    'https://evil.example/?u=https://aturi.to/api/oauth/extension/return',
    'https://aturi.to@evil.example/api/oauth/extension/return',
    '/api/oauth/extension/return',
    '//aturi.to/api/oauth/extension/return',
    ' https://aturi.to/api/oauth/extension/return',
  ];
  for (const raw of rejected) {
    assert.equal(validateReturn(raw, 'extension', [], origin), null, `should reject ${raw}`);
  }
});

test('Safari return: the first-party target is for the extension only', async () => {
  const validateReturn = await loadValidateReturn();
  // A web return is a root-relative path. An absolute URL to the landing page
  // is refused like any other absolute URL, so the web flow cannot be pointed
  // at it.
  assert.equal(
    validateReturn('https://aturi.to/api/oauth/extension/return', 'web', [], 'https://aturi.to'),
    null,
  );
  // A path under /api/oauth collapses to the home page, as before.
  assert.equal(
    validateReturn('/api/oauth/extension/return', 'web', [], 'https://aturi.to'),
    '/',
  );
});

test('Safari return: the browser patterns and the operator list still behave as before', async () => {
  const validateReturn = await loadValidateReturn();
  const origin = 'https://aturi.to';
  assert.equal(
    validateReturn('https://abcdefghijklmnop.chromiumapp.org/', 'extension', [], origin),
    'https://abcdefghijklmnop.chromiumapp.org/',
  );
  assert.equal(validateReturn('https://evil.example/', 'extension', [], origin), null);
  assert.equal(
    validateReturn('https://named.example/', 'extension', ['https://named.example/'], origin),
    'https://named.example/',
  );
  assert.equal(validateReturn(null, 'extension', [], origin), null);
  assert.equal(validateReturn(null, 'web', [], origin), '/');
});

test('both validateReturn call sites pass the request origin', () => {
  // bail() runs before requireBffConfig(), so it has its own call. Missing the
  // origin there would make every Safari failure fall through to JSON and
  // leave the user on a blank page.
  const sites: string[] = [];
  for (const m of src.matchAll(/(?<!function )validateReturn\(/g)) {
    // Walk to the matching parenthesis; the arguments contain calls of their own.
    let depth = 0;
    let end = m.index;
    for (; end < src.length; end += 1) {
      if (src[end] === '(') depth += 1;
      if (src[end] === ')' && --depth === 0) break;
    }
    sites.push(src.slice(m.index, end + 1));
  }
  assert.equal(sites.length, 3, 'expected the bail() extension, bail() web and main call sites');
  for (const call of sites) {
    assert.match(call, /,\s*origin,?\s*\)$/, `call site does not pass origin: ${call}`);
  }
});

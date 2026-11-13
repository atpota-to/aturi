import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/**
 * The XRPC proxy serves a literal allowlist, so a space method the client
 * calls but the allowlist omits fails with a 403 that no test would otherwise
 * catch — the code looks right, and the feature simply stops working for
 * anyone who ticked the space scopes.
 *
 * That already happened once: `getLatestCommit` and `listRepoOps` were missing
 * because the allowlist was derived from the methods that call
 * `assertTransport(t, 'oauth', ...)`, and those two assert nothing — they
 * accept EITHER transport and route through OAuth when that is what they were
 * handed. Auditing the asserted ones undercounts by exactly the unasserted
 * ones.
 *
 * So this reads both files and compares them, rather than restating a list
 * that would drift the same way.
 */

const root = process.cwd();
const clientSrc = readFileSync(resolve(root, 'src/utils/atproto/spaceClient.ts'), 'utf8');
const routeSrc = readFileSync(
  resolve(root, 'src/app/api/oauth/xrpc/[nsid]/route.ts'),
  'utf8',
);

/** NSIDs named in the proxy's ALLOWED_NSIDS set. */
function allowlisted(): Set<string> {
  const block = routeSrc.slice(
    routeSrc.indexOf('ALLOWED_NSIDS'),
    routeSrc.indexOf('])', routeSrc.indexOf('ALLOWED_NSIDS')),
  );
  return new Set([...block.matchAll(/'([a-z][a-zA-Z0-9.]+)'/g)].map((m) => m[1]));
}

/**
 * Space methods the client can send over the OAuth transport: every NSID it
 * names, minus the ones it explicitly reserves for a credential.
 */
function reachableOverOauth(): Set<string> {
  const named = new Set(
    [...clientSrc.matchAll(/'(com\.atproto\.(?:space|simplespace)\.[a-zA-Z]+)'/g)].map(
      (m) => m[1],
    ),
  );
  for (const [, nsid] of clientSrc.matchAll(
    /assertTransport\(\s*t\s*,\s*'credential'\s*,\s*'([^']+)'/g,
  )) {
    named.delete(nsid);
  }
  // Not a method — the lexicon's shared type namespace.
  named.delete('com.atproto.simplespace.defs');
  return named;
}

test('every space method reachable over OAuth is proxied', () => {
  const allowed = allowlisted();
  const missing = [...reachableOverOauth()].filter((nsid) => !allowed.has(nsid));
  assert.deepEqual(
    missing,
    [],
    `these would 403 at the proxy: ${missing.join(', ')}`,
  );
});

test('the allowlist carries no space method that cannot reach it', () => {
  // The mirror of the test above, and the reason uploadBlob is absent too:
  // allowlisting a method ahead of a caller is reach granted for nothing.
  const reachable = reachableOverOauth();
  const extra = [...allowlisted()].filter(
    (nsid) => /^com\.atproto\.(space|simplespace)\./.test(nsid) && !reachable.has(nsid),
  );
  assert.deepEqual(extra, [], `allowlisted but never sent over OAuth: ${extra.join(', ')}`);
});

const UPLOAD_BLOB = 'com.atproto.repo.uploadBlob';

/** Every non-test source file under src/, as [relative path, contents]. */
function sourceFiles(): [string, string][] {
  const dir = resolve(root, 'src');
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !f.split(sep).includes('__tests__'))
    .map((f) => [f.split(sep).join('/'), readFileSync(resolve(dir, f), 'utf8')]);
}

/**
 * Repo and AppView methods the app calls through an Agent, read off the call
 * sites (`agent.com.atproto.repo.putRecord(`, `proxied.app.bsky.actor...`).
 *
 * The space test above covers only spaceClient.ts, and that is how the
 * space-administration methods went missing while this branch sat unmerged:
 * features land on other branches, call through the signed-in Agent, and
 * work in browser mode, which never touches the proxy.
 */
function calledThroughAgents(): Set<string> {
  const called = new Set<string>();
  for (const [, src] of sourceFiles()) {
    for (const m of src.matchAll(/\.((?:com\.atproto|app\.bsky|chat\.bsky)\.[a-z]+\.[a-zA-Z]+)\(/g)) {
      called.add(m[1]);
    }
  }
  return called;
}

test('every repo and AppView method the app calls through an Agent is proxied', () => {
  const allowed = allowlisted();
  // uploadBlob has its own rule, below.
  const missing = [...calledThroughAgents()].filter(
    (nsid) => nsid !== UPLOAD_BLOB && !allowed.has(nsid),
  );
  assert.deepEqual(missing, [], `these would 403 at the proxy: ${missing.join(', ')}`);
});

test('uploadBlob is proxied exactly when something uploads', () => {
  // An authenticated multi-megabyte write endpoint, so allowlisting it ahead
  // of a caller is reach granted for nothing. Its one call site is
  // `uploadImage` in userinput/writes.ts, which nothing uses yet; once
  // something does, every attachment would 403 without it.
  const used = sourceFiles().some(
    ([path, src]) => path !== 'utils/userinput/writes.ts' && /\buploadImage\s*\(/.test(src),
  );
  assert.equal(
    allowlisted().has(UPLOAD_BLOB),
    used,
    used ? 'uploadImage is called, so the proxy must allowlist uploadBlob' : 'nothing uploads, so uploadBlob must stay off the allowlist',
  );
});

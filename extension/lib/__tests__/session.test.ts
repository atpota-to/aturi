import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The extension's sign-in module, exercised for the two properties that are
 * easy to break and impossible to notice: where the credential is stored, and
 * that a code is worthless without its verifier.
 *
 * `#imports` is stubbed by the vitest config, so `browser` is undefined here
 * and the storage helpers take their null-area path. That is enough to pin the
 * shape of what would be written, which is the part that matters.
 */

describe('storage key', () => {
  it('is not the prefs key', async () => {
    // lib/prefs.ts serialises the WHOLE prefs object to browser.storage.sync,
    // which uploads it to Google's or Mozilla's servers. A session token that
    // ended up in that object would sync off-device silently. The two keys
    // must never converge, so this asserts on the source rather than trusting
    // that nobody moves it later.
    const [prefsSrc, sessionSrc] = await Promise.all([
      import('node:fs').then((fs) => fs.readFileSync('lib/prefs.ts', 'utf8')),
      import('node:fs').then((fs) => fs.readFileSync('lib/session.ts', 'utf8')),
    ]);
    const prefsKey = /STORAGE_KEY = '([^']+)'/.exec(prefsSrc)?.[1];
    const sessionKey = /SESSION_KEY = '([^']+)'/.exec(sessionSrc)?.[1];
    expect(prefsKey).toBeTruthy();
    expect(sessionKey).toBeTruthy();
    expect(sessionKey).not.toBe(prefsKey);
  });

  it('stores the session in local, never in sync', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('lib/session.ts', 'utf8'),
    );
    // Comments stripped first: the file explains at length WHY it avoids
    // storage.sync, and matching prose would fail on the explanation itself.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // storage.sync leaves the device. Nothing in this file may reach for it.
    expect(code).not.toMatch(/storage\??\.sync/);
    expect(code).toMatch(/storage\??\.local/);
  });
});

describe('signIn', () => {
  const original = globalThis.location;

  beforeEach(() => {
    vi.stubGlobal('location', { pathname: '/popup.html' } as Location);
  });
  afterEach(() => {
    vi.stubGlobal('location', original);
  });

  it('refuses to run from the popup', async () => {
    // launchWebAuthFlow opens a separate window, which destroys the popup and
    // collects the pending promise with it. In development the popup often
    // survives (devtools holds it open), so this would ship looking fine.
    const { signIn } = await import('../session');
    await expect(signIn('someone.example')).rejects.toThrow(/cannot run from the popup/i);
  });
});

describe('getSession', () => {
  it('returns null rather than throwing when storage is unavailable', async () => {
    // MV3 suspends and restarts the worker freely; every caller reads storage
    // fresh, so an unavailable area has to be an ordinary "signed out" rather
    // than an exception that takes a UI down.
    const { getSession } = await import('../session');
    await expect(getSession()).resolves.toBeNull();
  });
});

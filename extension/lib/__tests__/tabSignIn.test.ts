import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Safari's tab-based sign-in (lib/tabSignIn.ts), and the promise that Chrome
 * and Firefox are untouched by it.
 *
 * `#imports` is replaced here with a small in-memory browser: storage.local is
 * a Map, storage.sync throws if anything so much as looks at it, and the tab,
 * runtime and permission calls are spies. `fetch` is stubbed per test, so
 * "no network" is something a test can assert rather than assume.
 */

type Listener = (...args: any[]) => unknown;

const h = vi.hoisted(() => {
  const local = new Map<string, unknown>();
  const changeListeners = new Set<Listener>();
  const listeners = {
    onUpdated: [] as Listener[],
    onRemoved: [] as Listener[],
    onMessage: [] as Listener[],
  };
  const notify = (keys: string[]) => {
    const changes = Object.fromEntries(keys.map((k) => [k, {}]));
    for (const fn of changeListeners) fn(changes, 'local');
  };
  const browser: Record<string, any> = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) {
            if (local.has(k)) out[k] = structuredClone(local.get(k));
          }
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) local.set(k, structuredClone(v));
          notify(Object.keys(items));
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) local.delete(k);
          notify(list);
        }),
      },
      get sync(): never {
        throw new Error('storage.sync must never be touched by sign-in');
      },
      onChanged: {
        addListener: (fn: Listener) => changeListeners.add(fn),
        removeListener: (fn: Listener) => changeListeners.delete(fn),
      },
    },
    tabs: {
      create: vi.fn(async (props: { url: string; active?: boolean }) => ({ id: 41, ...props })),
      update: vi.fn(async (id: number) => ({ id, windowId: 3 })),
      remove: vi.fn(async () => {}),
      get: vi.fn(async (id: number) => ({ id, url: '' })),
      getCurrent: vi.fn(async () => ({ id: 7, windowId: 3 })),
      onUpdated: { addListener: vi.fn((fn: Listener) => listeners.onUpdated.push(fn)) },
      onRemoved: { addListener: vi.fn((fn: Listener) => listeners.onRemoved.push(fn)) },
    },
    runtime: {
      sendMessage: vi.fn(async () => undefined),
      onMessage: { addListener: vi.fn((fn: Listener) => listeners.onMessage.push(fn)) },
    },
    windows: { update: vi.fn(async () => ({})) },
    permissions: { request: vi.fn(async () => true) },
    identity: undefined,
  };
  return { local, browser, listeners, changeListeners };
});

vi.mock('#imports', () => ({ browser: h.browser }));

const RETURN = 'https://aturi.to/api/oauth/extension/return';
const PENDING_KEY = 'aturi.signin.pending.v1';
const OUTCOME_KEY = 'aturi.signin.outcome.v1';
const SESSION_KEY = 'aturi.session.v1';

function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A stand-in for aturi.to and the handle resolver. Redeeming checks the
 * verifier against the pending flow's challenge, the way /exchange does.
 */
function stubNetwork(opts: { did?: string; resolvesTo?: string | null } = {}) {
  const did = opts.did ?? 'did:plc:alice';
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://aturi.to/api/oauth/exchange') {
      const { code, verifier } = JSON.parse(String(init?.body));
      const pending = h.local.get(PENDING_KEY) as { challenge: string } | undefined;
      // The pending record must already be gone by the time we redeem.
      expect(pending).toBeUndefined();
      if (code !== 'the-code' || typeof verifier !== 'string') {
        return json({ ok: false, error: 'Invalid or expired code' }, 400);
      }
      return json({ ok: true, token: `token-for-${did}`, did, expiresAt: '2030-01-01T00:00:00Z' });
    }
    if (url === 'https://aturi.to/api/oauth/logout') return json({ ok: true });
    if (url.startsWith('https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle')) {
      if (opts.resolvesTo === null) return json({ error: 'nope' }, 400);
      return json({ did: opts.resolvesTo ?? did });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function seedPending(overrides: Record<string, unknown> = {}) {
  const verifier = 'v'.repeat(43);
  h.local.set(PENDING_KEY, {
    verifier,
    challenge: challengeOf(verifier),
    handle: 'alice.test',
    tabId: 41,
    optionsTabId: 7,
    startedAt: Date.now(),
    ...overrides,
  });
  return verifier;
}

beforeEach(() => {
  h.local.clear();
  h.changeListeners.clear();
  h.listeners.onUpdated.length = 0;
  h.listeners.onRemoved.length = 0;
  h.listeners.onMessage.length = 0;
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('where the pending flow lives', () => {
  it('has its own key, not the prefs key or the session key', async () => {
    const src = (file: string) => readFileSync(file, 'utf8');
    const prefsKey = /STORAGE_KEY = '([^']+)'/.exec(src('lib/prefs.ts'))?.[1];
    const pendingKey = /PENDING_KEY = '([^']+)'/.exec(src('lib/tabSignIn.ts'))?.[1];
    expect(prefsKey).toBeTruthy();
    expect(pendingKey).toBe(PENDING_KEY);
    expect(pendingKey).not.toBe(prefsKey);
    expect(pendingKey).not.toBe(SESSION_KEY);
  });

  it('never reaches for storage.sync', () => {
    const code = readFileSync('lib/tabSignIn.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/storage\??\.sync/);
    expect(code).toMatch(/storage\??\.local/);
    // Nothing in the module logs; a stray console call is how a verifier
    // ends up in a bug report.
    expect(code).not.toMatch(/console\./);
  });
});

describe('beginTabSignIn', () => {
  it('stores the verifier locally only, and never puts it in a URL', async () => {
    const { beginTabSignIn } = await import('../tabSignIn');
    await beginTabSignIn('  alice.test ');

    const pending = h.local.get(PENDING_KEY) as Record<string, unknown>;
    expect(pending).toMatchObject({ handle: 'alice.test', tabId: 41, optionsTabId: 7 });
    expect(typeof pending.verifier).toBe('string');
    expect(pending.challenge).toBe(challengeOf(pending.verifier as string));

    const { url, active } = h.browser.tabs.create.mock.calls[0][0];
    const login = new URL(url);
    expect(login.origin + login.pathname).toBe('https://aturi.to/api/oauth/login');
    expect(login.searchParams.get('client')).toBe('extension');
    expect(login.searchParams.get('challenge')).toBe(pending.challenge);
    expect(login.searchParams.get('return')).toBe(RETURN);
    expect(url).not.toContain(pending.verifier as string);

    // Opened in the background, brought forward once the record exists.
    expect(active).toBe(false);
    const setOrder = h.browser.storage.local.set.mock.invocationCallOrder[0];
    const updateOrder = h.browser.tabs.update.mock.invocationCallOrder[0];
    expect(h.browser.tabs.update).toHaveBeenCalledWith(41, { active: true });
    expect(updateOrder).toBeGreaterThan(setOrder);

    // Asked the background to look once, and nothing went over the network.
    expect(h.browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'aturi:signin-check' });
  });

  it('closes the tab again if the record cannot be written', async () => {
    const { beginTabSignIn } = await import('../tabSignIn');
    h.browser.storage.local.set.mockRejectedValueOnce(new Error('quota'));
    await expect(beginTabSignIn('alice.test')).rejects.toThrow('quota');
    expect(h.browser.tabs.remove).toHaveBeenCalledWith(41);
    expect(h.browser.tabs.update).not.toHaveBeenCalled();
  });

  it('exposes no verifier to the options page', async () => {
    const { beginTabSignIn, getPendingTabSignIn, PENDING_TTL_MS } = await import('../tabSignIn');
    await beginTabSignIn('alice.test');
    const view = await getPendingTabSignIn();
    expect(view).not.toBeNull();
    expect(Object.keys(view!).sort()).toEqual(['expiresAt', 'handle', 'startedAt']);
    expect(view!.expiresAt - view!.startedAt).toBe(PENDING_TTL_MS);
  });
});

describe('completeTabSignIn', () => {
  it('ignores anything that is not exactly the return page', async () => {
    const fetchMock = stubNetwork();
    seedPending();
    const { completeTabSignIn } = await import('../tabSignIn');
    const urls = [
      `${RETURN}x#code=the-code`,
      `${RETURN}.evil#code=the-code`,
      `${RETURN}/#code=the-code`,
      `${RETURN}/../returnx#code=the-code`,
      'https://aturi.to/api/oauth/extension/RETURN#code=the-code',
      'http://aturi.to/api/oauth/extension/return#code=the-code',
      'https://www.aturi.to/api/oauth/extension/return#code=the-code',
      'https://aturi.to.evil.example/api/oauth/extension/return#code=the-code',
      'https://evil.example/api/oauth/extension/return#code=the-code',
      `https://evil.example/?next=${RETURN}#code=the-code`,
      'https://aturi.to/#code=the-code',
      // The page itself, but with neither a code nor an error: not an arrival.
      RETURN,
      `${RETURN}#state=x`,
      'not a url',
    ];
    for (const url of urls) {
      await expect(completeTabSignIn(url, 41)).resolves.toBe('ignored');
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.local.has(PENDING_KEY)).toBe(true);
    expect(h.browser.tabs.remove).not.toHaveBeenCalled();
  });

  it('ignores the right URL in the wrong tab', async () => {
    const fetchMock = stubNetwork();
    seedPending({ tabId: 41 });
    const { completeTabSignIn } = await import('../tabSignIn');
    await expect(completeTabSignIn(`${RETURN}#code=the-code`, 42)).resolves.toBe('ignored');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.local.has(PENDING_KEY)).toBe(true);
  });

  it('makes no request at all without a pending flow', async () => {
    const fetchMock = stubNetwork();
    const { completeTabSignIn } = await import('../tabSignIn');
    await expect(completeTabSignIn(`${RETURN}#code=the-code`, 41)).resolves.toBe('ignored');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.local.has(SESSION_KEY)).toBe(false);
  });

  it('redeems once, however many times the arrival is reported', async () => {
    const fetchMock = stubNetwork();
    seedPending();
    const { completeTabSignIn } = await import('../tabSignIn');
    const url = `${RETURN}#code=the-code`;
    const results = await Promise.all([
      completeTabSignIn(url, 41),
      completeTabSignIn(url, 41),
      completeTabSignIn(url, 41),
    ]);
    expect(results.filter((r) => r === 'signed-in')).toHaveLength(1);
    expect(results.filter((r) => r === 'ignored')).toHaveLength(2);
    const exchanges = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/exchange'));
    expect(exchanges).toHaveLength(1);
    await expect(completeTabSignIn(url, 41)).resolves.toBe('ignored');
  });

  it('signs in, closes the tab and goes back to the options tab', async () => {
    const fetchMock = stubNetwork();
    const verifier = seedPending();
    const { completeTabSignIn } = await import('../tabSignIn');
    await expect(completeTabSignIn(`${RETURN}#code=the-code`, 41)).resolves.toBe('signed-in');

    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/exchange'))!;
    expect(JSON.parse(String(init?.body))).toEqual({ code: 'the-code', verifier });
    expect(h.local.get(SESSION_KEY)).toMatchObject({ did: 'did:plc:alice' });
    expect(h.local.has(PENDING_KEY)).toBe(false);
    expect(h.local.get(OUTCOME_KEY)).toMatchObject({ ok: true });
    expect(JSON.stringify(h.local.get(OUTCOME_KEY))).not.toContain(verifier);
    expect(h.browser.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(h.browser.windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(h.browser.tabs.remove).toHaveBeenCalledWith(41);
  });

  it('reports ?oauth_error without any request', async () => {
    const fetchMock = stubNetwork();
    seedPending();
    const { completeTabSignIn, takeTabSignInOutcome } = await import('../tabSignIn');
    const url = `${RETURN}?oauth_error=${encodeURIComponent('Handle not found')}`;
    await expect(completeTabSignIn(url, 41)).resolves.toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.local.has(PENDING_KEY)).toBe(false);
    expect(h.browser.tabs.remove).toHaveBeenCalledWith(41);
    await expect(takeTabSignInOutcome()).resolves.toMatchObject({
      ok: false,
      message: 'Handle not found',
    });
    // Taken once; the next read has nothing.
    await expect(takeTabSignInOutcome()).resolves.toBeNull();
  });

  it('refuses a flow older than ten minutes without redeeming it', async () => {
    const fetchMock = stubNetwork();
    seedPending({ startedAt: Date.now() - 11 * 60_000 });
    const { completeTabSignIn } = await import('../tabSignIn');
    await expect(completeTabSignIn(`${RETURN}#code=the-code`, 41)).resolves.toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.local.get(OUTCOME_KEY)).toMatchObject({ ok: false, message: expect.stringMatching(/too long/) });
  });

  it('surfaces an exchange failure and stores nothing', async () => {
    stubNetwork();
    seedPending();
    const { completeTabSignIn } = await import('../tabSignIn');
    await expect(completeTabSignIn(`${RETURN}#code=wrong`, 41)).resolves.toBe('failed');
    expect(h.local.has(SESSION_KEY)).toBe(false);
    expect(h.local.get(OUTCOME_KEY)).toMatchObject({ ok: false, message: 'Invalid or expired code' });
  });

  it('refuses, and ends, a session for a different account than the one typed', async () => {
    const fetchMock = stubNetwork({ did: 'did:plc:mallory', resolvesTo: 'did:plc:alice' });
    seedPending({ handle: '@Alice.test' });
    const { completeTabSignIn } = await import('../tabSignIn');
    await expect(completeTabSignIn(`${RETURN}#code=the-code`, 41)).resolves.toBe('failed');
    expect(h.local.has(SESSION_KEY)).toBe(false);
    const logout = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/logout'));
    expect(logout?.[1]?.headers).toEqual({ authorization: 'Bearer token-for-did:plc:mallory' });
    const lookup = fetchMock.mock.calls.find(([u]) => String(u).includes('resolveHandle'));
    expect(String(lookup?.[0])).toContain('handle=alice.test');
    expect(h.local.get(OUTCOME_KEY)).toMatchObject({
      ok: false,
      message: expect.stringContaining('alice.test'),
    });
  });

  it('accepts the session when the typed handle cannot be resolved', async () => {
    stubNetwork({ resolvesTo: null });
    seedPending({ handle: 'unresolvable.test' });
    const { completeTabSignIn } = await import('../tabSignIn');
    await expect(completeTabSignIn(`${RETURN}#code=the-code`, 41)).resolves.toBe('signed-in');
    expect(h.local.get(SESSION_KEY)).toMatchObject({ did: 'did:plc:alice' });
  });

  it('does not look anything up for a server URL or a matching DID', async () => {
    const fetchMock = stubNetwork();
    seedPending({ handle: 'https://pds.example' });
    const { completeTabSignIn } = await import('../tabSignIn');
    await expect(completeTabSignIn(`${RETURN}#code=the-code`, 41)).resolves.toBe('signed-in');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('resolveHandle'))).toBe(false);

    seedPending({ handle: 'did:plc:alice' });
    await expect(completeTabSignIn(`${RETURN}#code=the-code`, 41)).resolves.toBe('signed-in');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('resolveHandle'))).toBe(false);
  });
});

describe('cancelling', () => {
  it('drops the flow and closes its tab', async () => {
    seedPending();
    const { cancelTabSignIn } = await import('../tabSignIn');
    await expect(cancelTabSignIn()).resolves.toBe(true);
    expect(h.local.has(PENDING_KEY)).toBe(false);
    expect(h.browser.tabs.remove).toHaveBeenCalledWith(41);
    await expect(cancelTabSignIn()).resolves.toBe(false);
  });
});

describe('installTabSignIn', () => {
  async function installOnSafari() {
    vi.stubEnv('BROWSER', 'safari');
    vi.resetModules();
    const mod = await import('../tabSignIn');
    mod.installTabSignIn();
    return mod;
  }

  it('registers nothing outside the Safari build', async () => {
    const { installTabSignIn } = await import('../tabSignIn');
    installTabSignIn();
    expect(h.browser.tabs.onUpdated.addListener).not.toHaveBeenCalled();
    expect(h.browser.tabs.onRemoved.addListener).not.toHaveBeenCalled();
    expect(h.browser.runtime.onMessage.addListener).not.toHaveBeenCalled();
  });

  it('registers its listeners synchronously on Safari', async () => {
    await installOnSafari();
    expect(h.listeners.onUpdated).toHaveLength(1);
    expect(h.listeners.onRemoved).toHaveLength(1);
    expect(h.listeners.onMessage).toHaveLength(1);
  });

  it("leaves other messages to the background's own listener", async () => {
    await installOnSafari();
    const [listener] = h.listeners.onMessage;
    const sendResponse = vi.fn();
    for (const message of [
      { type: 'aturi:open-waypoint' },
      { type: 'aturi:redirect-scope' },
      { type: 'aturi:detected', count: 2 },
      'aturi:signin-return',
      null,
    ]) {
      expect(listener(message, { tab: { id: 41 } }, sendResponse)).toBeUndefined();
    }
    // A return report from no tab (an extension page) is not one.
    expect(
      listener({ type: 'aturi:signin-return', url: `${RETURN}#code=the-code` }, {}, sendResponse),
    ).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(h.browser.storage.local.get).not.toHaveBeenCalled();
  });

  it('completes from the content script report', async () => {
    stubNetwork();
    seedPending();
    await installOnSafari();
    const [listener] = h.listeners.onMessage;
    const responded = new Promise((resolve) => {
      const keepOpen = listener(
        { type: 'aturi:signin-return', url: `${RETURN}#code=the-code` },
        { tab: { id: 41 } },
        resolve,
      );
      expect(keepOpen).toBe(true);
    });
    await expect(responded).resolves.toEqual({ result: 'signed-in' });
    expect(h.local.get(SESSION_KEY)).toMatchObject({ did: 'did:plc:alice' });
  });

  it('completes once when the tab watcher and the content script both report', async () => {
    const fetchMock = stubNetwork();
    seedPending();
    await installOnSafari();
    const url = `${RETURN}#code=the-code`;
    h.listeners.onUpdated[0](41, { url }, { id: 41, url });
    const response = await new Promise((resolve) =>
      h.listeners.onMessage[0]({ type: 'aturi:signin-return', url }, { tab: { id: 41 } }, resolve),
    );
    expect(response).toEqual({ result: 'ignored' });
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/exchange'))).toHaveLength(1);
    expect(h.local.get(SESSION_KEY)).toMatchObject({ did: 'did:plc:alice' });
  });

  it('does nothing for the updates of every other tab', async () => {
    await installOnSafari();
    const [onUpdated] = h.listeners.onUpdated;
    onUpdated(9, { url: 'https://bsky.app/' }, { id: 9, url: 'https://bsky.app/' });
    onUpdated(9, { status: 'complete' }, { id: 9, url: '' });
    onUpdated(9, { status: 'loading' }, undefined);
    await Promise.resolve();
    expect(h.browser.storage.local.get).not.toHaveBeenCalled();
  });

  it('reports a closed sign-in tab as cancelled, and ignores other tabs closing', async () => {
    seedPending();
    await installOnSafari();
    const [onRemoved] = h.listeners.onRemoved;
    onRemoved(99);
    await vi.waitFor(() => expect(h.browser.storage.local.get).toHaveBeenCalled());
    expect(h.local.has(PENDING_KEY)).toBe(true);

    onRemoved(41);
    await vi.waitFor(() => expect(h.local.has(PENDING_KEY)).toBe(false));
    expect(h.local.get(OUTCOME_KEY)).toMatchObject({ ok: false, message: 'Sign-in was cancelled.' });
  });

  it('finishes a flow the background slept through when the options page asks', async () => {
    stubNetwork();
    seedPending();
    h.browser.tabs.get.mockResolvedValueOnce({ id: 41, url: `${RETURN}#code=the-code` });
    await installOnSafari();
    const response = await new Promise((resolve) =>
      h.listeners.onMessage[0]({ type: 'aturi:signin-check' }, { tab: { id: 7 } }, resolve),
    );
    expect(response).toEqual({ result: 'signed-in' });
    expect(h.browser.tabs.get).toHaveBeenCalledWith(41);
  });
});

describe('the return page', () => {
  it('is the route the server serves and accepts', async () => {
    const { TAB_RETURN_URL, ATURI_ORIGINS } = await import('../tabSignIn');
    const { origin, pathname } = new URL(TAB_RETURN_URL);
    expect(origin).toBe('https://aturi.to');
    expect(TAB_RETURN_URL).toBe(RETURN);
    // The route lives at the same path in the Next app...
    expect(existsSync(resolve('..', `src/app${pathname}/route.ts`))).toBe(true);
    // ...and is the one exact path the login route lets an extension return to.
    const login = readFileSync(resolve('..', 'src/app/api/oauth/login/route.ts'), 'utf8');
    expect(login).toContain(`const EXTENSION_TAB_RETURN_PATH = '${pathname}';`);
    // The site access asked for covers it.
    expect(ATURI_ORIGINS).toEqual(['https://aturi.to/*']);
  });

  it('has a Safari-only content script that reports to the same listener', async () => {
    const { TAB_RETURN_URL, RETURN_MESSAGE } = await import('../tabSignIn');
    const src = readFileSync('entrypoints/signin-return.content.ts', 'utf8');
    expect(src).toMatch(/include:\s*\['safari'\]/);
    expect(src).toContain(`matches: ['${TAB_RETURN_URL}*']`);
    expect(src).toMatch(/runAt:\s*'document_start'/);
    expect(src).toContain(`type: '${RETURN_MESSAGE}'`);
  });
});

describe('Chrome and Firefox are unchanged', () => {
  it('still sign in through identity.launchWebAuthFlow', async () => {
    const fetchMock = stubNetwork();
    const launchWebAuthFlow = vi.fn(async () => 'https://abcdef.chromiumapp.org/#code=the-code');
    h.browser.identity = {
      getRedirectURL: () => 'https://abcdef.chromiumapp.org/',
      launchWebAuthFlow,
    };
    try {
      const { signIn } = await import('../session');
      const session = await signIn(' alice.test ');
      expect(session.did).toBe('did:plc:alice');

      const [{ url, interactive }] = launchWebAuthFlow.mock.calls[0] as unknown as [
        { url: string; interactive: boolean },
      ];
      expect(interactive).toBe(true);
      const login = new URL(url);
      expect(login.origin + login.pathname).toBe('https://aturi.to/api/oauth/login');
      expect([...login.searchParams.keys()]).toEqual([
        'handle',
        'client',
        'scopes',
        'challenge',
        'return',
      ]);
      expect(login.searchParams.get('handle')).toBe('alice.test');
      expect(login.searchParams.get('return')).toBe('https://abcdef.chromiumapp.org/');

      const [, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/exchange'))!;
      const { verifier } = JSON.parse(String(init?.body));
      expect(login.searchParams.get('challenge')).toBe(challengeOf(verifier));

      // No tab, no site-access prompt, no pending record.
      expect(h.browser.tabs.create).not.toHaveBeenCalled();
      expect(h.browser.permissions.request).not.toHaveBeenCalled();
      expect(h.local.has(PENDING_KEY)).toBe(false);
      expect(h.local.get(SESSION_KEY)).toMatchObject({ did: 'did:plc:alice' });
    } finally {
      h.browser.identity = undefined;
    }
  });

  it('the Account tab only takes the tab path in the Safari build', () => {
    const src = readFileSync('entrypoints/options/tabs/AccountTab.tsx', 'utf8');
    const submit = /onSubmit=\{\(e\) => \{([\s\S]*?)\n {10}\}\}/.exec(src)?.[1] ?? '';
    expect(submit).toMatch(
      /if \(IS_SAFARI\) \{\s*submitOnSafari\(e\);\s*return;\s*\}\s*e\.preventDefault\(\);\s*void doSignIn\(\);/,
    );
    expect(src).toMatch(/setSession\(await signIn\(value\)\)/);
    // IS_SAFARI is the build-time flag, so this branch folds away elsewhere.
    expect(src).toMatch(/import \{ IS_SAFARI \} from '..\/..\/..\/lib\/platform';/);
  });

  it("Safari's submit asks for aturi.to before anything else happens", () => {
    // Safari shows the prompt only during the user's gesture, and the first
    // await ends it. So the request is the first thing the handler does.
    const src = readFileSync('entrypoints/options/tabs/AccountTab.tsx', 'utf8');
    const body = /const submitOnSafari = \(.*?\) => \{([\s\S]*?)\n {2}\};/.exec(src)?.[1] ?? '';
    const code = body.replace(/^\s*\/\/.*$/gm, '').trim();
    expect(code).toMatch(
      /^let access: Promise<boolean>;\s*try \{\s*access = browser\.permissions\.request\(\{ origins: ATURI_ORIGINS \}\);/,
    );
    const requestAt = code.indexOf('browser.permissions.request');
    expect(code.slice(0, requestAt)).not.toMatch(/await|set[A-Z]\w*\(/);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Safari site access for redirect sources (lib/siteAccess.ts).
 *
 * `#imports` is replaced with a browser whose `permissions` is a small fake:
 * `granted` is the set of origin patterns the user has allowed, and the
 * onAdded/onRemoved events keep their listeners where a test can fire them.
 * A test can also take `permissions` away to stand for a browser without it.
 */

type Listener = () => void;

const h = vi.hoisted(() => {
  const granted = new Set<string>();
  const added = new Set<Listener>();
  const removed = new Set<Listener>();
  const permissions = {
    contains: vi.fn(async ({ origins }: { origins: string[] }) =>
      origins.every(o => granted.has(o))
    ),
    request: vi.fn(async ({ origins }: { origins: string[] }) => {
      for (const o of origins) granted.add(o);
      return true;
    }),
    onAdded: {
      addListener: vi.fn((fn: Listener) => added.add(fn)),
      removeListener: vi.fn((fn: Listener) => added.delete(fn)),
    },
    onRemoved: {
      addListener: vi.fn((fn: Listener) => removed.add(fn)),
      removeListener: vi.fn((fn: Listener) => removed.delete(fn)),
    },
  };
  const browser: { permissions?: typeof permissions } = { permissions };
  return { granted, added, removed, permissions, browser };
});

vi.mock('#imports', () => ({ browser: h.browser }));

import {
  checkSiteAccess,
  normalizeHosts,
  originPatternForHost,
  originPatternsForHosts,
  requestSiteAccess,
  summarizeSiteAccess,
  watchSiteAccess,
} from '../siteAccess';

beforeEach(() => {
  h.granted.clear();
  h.added.clear();
  h.removed.clear();
  h.browser.permissions = h.permissions;
  vi.clearAllMocks();
});

describe('pure helpers', () => {
  it('covers a host on http and https, and nothing else', () => {
    expect(originPatternForHost('bsky.app')).toBe('*://bsky.app/*');
  });

  it('normalizes hosts: trimmed, lower-case, unique, sorted, no empties', () => {
    expect(normalizeHosts([' Bsky.App ', 'pdsls.dev', 'bsky.app', '', '  ', 'atp.tools'])).toEqual([
      'atp.tools',
      'bsky.app',
      'pdsls.dev',
    ]);
  });

  it('builds one pattern per distinct host', () => {
    expect(originPatternsForHosts(['pdsls.dev', 'bsky.app', 'BSKY.APP'])).toEqual([
      '*://bsky.app/*',
      '*://pdsls.dev/*',
    ]);
  });

  it('splits hosts into allowed and missing, in sorted order', () => {
    const summary = summarizeSiteAccess(['pdsls.dev', 'bsky.app', 'atp.tools'], h =>
      h.endsWith('.app')
    );
    expect(summary).toEqual({
      hosts: ['atp.tools', 'bsky.app', 'pdsls.dev'],
      allowed: ['bsky.app'],
      missing: ['atp.tools', 'pdsls.dev'],
    });
  });

  it('summarizes an empty list as nothing to allow', () => {
    expect(summarizeSiteAccess([], () => false)).toEqual({ hosts: [], allowed: [], missing: [] });
  });
});

describe('checkSiteAccess', () => {
  it('asks about each host on its own, since a joint call only answers "all of them?"', async () => {
    h.granted.add('*://bsky.app/*');
    const summary = await checkSiteAccess(['pdsls.dev', 'bsky.app']);
    expect(summary).toEqual({
      hosts: ['bsky.app', 'pdsls.dev'],
      allowed: ['bsky.app'],
      missing: ['pdsls.dev'],
    });
    expect(h.permissions.contains).toHaveBeenCalledTimes(2);
    expect(h.permissions.contains).toHaveBeenCalledWith({ origins: ['*://bsky.app/*'] });
    expect(h.permissions.contains).toHaveBeenCalledWith({ origins: ['*://pdsls.dev/*'] });
  });

  it('counts a host whose check fails as not allowed', async () => {
    h.granted.add('*://bsky.app/*');
    h.permissions.contains.mockImplementationOnce(async () => {
      throw new Error('nope');
    });
    const summary = await checkSiteAccess(['bsky.app']);
    expect(summary?.missing).toEqual(['bsky.app']);
  });

  it("answers null where there's no permissions API to ask", async () => {
    h.browser.permissions = undefined;
    expect(await checkSiteAccess(['bsky.app'])).toBeNull();
  });
});

describe('requestSiteAccess', () => {
  it('calls permissions.request before it returns, so a click handler keeps its gesture', () => {
    const pending = requestSiteAccess(['pdsls.dev', 'bsky.app']);
    // No await yet: the request must already have gone out.
    expect(h.permissions.request).toHaveBeenCalledTimes(1);
    expect(h.permissions.request).toHaveBeenCalledWith({
      origins: ['*://bsky.app/*', '*://pdsls.dev/*'],
    });
    return expect(pending).resolves.toBe(true);
  });

  it('resolves false when the user says no', async () => {
    h.permissions.request.mockResolvedValueOnce(false);
    expect(await requestSiteAccess(['bsky.app'])).toBe(false);
  });

  it('resolves false, not a rejection, when the request fails or throws', async () => {
    h.permissions.request.mockRejectedValueOnce(new Error('not from a gesture'));
    expect(await requestSiteAccess(['bsky.app'])).toBe(false);
    h.permissions.request.mockImplementationOnce(() => {
      throw new Error('sync throw');
    });
    expect(await requestSiteAccess(['bsky.app'])).toBe(false);
  });

  it('asks for nothing when there is nothing to allow', async () => {
    expect(await requestSiteAccess([])).toBe(true);
    expect(h.permissions.request).not.toHaveBeenCalled();
  });

  it('resolves false without a permissions API', async () => {
    h.browser.permissions = undefined;
    expect(await requestSiteAccess(['bsky.app'])).toBe(false);
  });
});

describe('watchSiteAccess', () => {
  type DocListener = () => void;
  let docListeners: Map<string, Set<DocListener>>;
  let visibility: 'visible' | 'hidden';

  beforeEach(() => {
    docListeners = new Map();
    visibility = 'visible';
    vi.stubGlobal('document', {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (type: string, fn: DocListener) => {
        if (!docListeners.has(type)) docListeners.set(type, new Set());
        docListeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: DocListener) => {
        docListeners.get(type)?.delete(fn);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fireVisibility = () => {
    for (const fn of docListeners.get('visibilitychange') ?? []) fn();
  };

  it('calls back on a grant, a removal, and the page coming back into view', () => {
    const onChange = vi.fn();
    watchSiteAccess(onChange);

    for (const fn of h.added) fn();
    for (const fn of h.removed) fn();
    expect(onChange).toHaveBeenCalledTimes(2);

    visibility = 'hidden';
    fireVisibility();
    expect(onChange).toHaveBeenCalledTimes(2);

    visibility = 'visible';
    fireVisibility();
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('removes every listener it added', () => {
    const unwatch = watchSiteAccess(() => {});
    expect(h.added.size).toBe(1);
    expect(h.removed.size).toBe(1);
    expect(docListeners.get('visibilitychange')?.size).toBe(1);
    unwatch();
    expect(h.added.size).toBe(0);
    expect(h.removed.size).toBe(0);
    expect(docListeners.get('visibilitychange')?.size).toBe(0);
  });

  it('still watches visibility where permission events are missing', () => {
    h.browser.permissions = { ...h.permissions, onAdded: undefined, onRemoved: undefined } as never;
    const onChange = vi.fn();
    const unwatch = watchSiteAccess(onChange);
    fireVisibility();
    expect(onChange).toHaveBeenCalledTimes(1);
    unwatch();
  });
});

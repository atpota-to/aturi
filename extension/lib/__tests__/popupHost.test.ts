import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The popup's host detection (entrypoints/popup/host.ts): which pages get
 * `data-platform="ios"` and `data-popup-host="sheet"`, and the promise that
 * Chrome, Firefox and macOS Safari never get either.
 *
 * There's no DOM under Vitest, so `document`, `window`, `navigator` and
 * `requestAnimationFrame` are small fakes: frames queue up until a test runs
 * them, and the widths and visibility are plain variables a test sets.
 */

type Fn = () => void;

const h = vi.hoisted(() => ({
  os: 'mac' as string | Error,
  browser: {
    runtime: {
      getPlatformInfo: vi.fn(async (): Promise<{ os: string }> => {
        throw new Error('set in beforeEach');
      }),
    },
  },
}));

vi.mock('#imports', () => ({ browser: h.browser }));

import { isIPhoneUserAgent, looksLikeSheet } from '../../entrypoints/popup/host';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

let dataset: Record<string, string>;
let frames: Fn[];
let listeners: Map<string, Set<Fn>>;
let innerWidth: number;
let bodyWidth: number;
let visibility: 'visible' | 'hidden';

function on(type: string, fn: Fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(fn);
}
function off(type: string, fn: Fn) {
  listeners.get(type)?.delete(fn);
}
function fire(type: string) {
  for (const fn of [...(listeners.get(type) ?? [])]) fn();
}
function runFrames() {
  const due = frames;
  frames = [];
  for (const fn of due) fn();
}
const listenerCount = () => [...listeners.values()].reduce((n, set) => n + set.size, 0);

function stubPage(userAgent: string) {
  vi.stubGlobal('navigator', { userAgent });
  vi.stubGlobal('document', {
    documentElement: { dataset },
    body: { getBoundingClientRect: () => ({ width: bodyWidth }) },
    get visibilityState() {
      return visibility;
    },
    addEventListener: on,
    removeEventListener: off,
  });
  vi.stubGlobal('window', {
    get innerWidth() {
      return innerWidth;
    },
    addEventListener: on,
    removeEventListener: off,
  });
  vi.stubGlobal('requestAnimationFrame', (fn: Fn) => {
    frames.push(fn);
    return frames.length;
  });
}

async function loadHost(browserName: 'safari' | 'chrome') {
  if (browserName === 'safari') vi.stubEnv('BROWSER', 'safari');
  vi.resetModules();
  return import('../../entrypoints/popup/host');
}

beforeEach(() => {
  dataset = {};
  frames = [];
  listeners = new Map();
  innerWidth = 0;
  bodyWidth = 380;
  visibility = 'hidden';
  h.os = 'mac';
  h.browser.runtime.getPlatformInfo.mockReset();
  h.browser.runtime.getPlatformInfo.mockImplementation(async () => {
    if (h.os instanceof Error) throw h.os;
    return { os: h.os };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('pure checks', () => {
  it('knows an iPhone or iPod by its user agent, and nothing else', () => {
    expect(isIPhoneUserAgent(IPHONE_UA)).toBe(true);
    expect(isIPhoneUserAgent('Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)')).toBe(true);
    expect(isIPhoneUserAgent(MAC_UA)).toBe(false);
    expect(isIPhoneUserAgent('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe(false);
  });

  it('calls it a sheet only once both widths are known and they differ', () => {
    expect(looksLikeSheet(0, 380)).toBe(false);
    expect(looksLikeSheet(393, 0)).toBe(false);
    expect(looksLikeSheet(380, 380)).toBe(false);
    expect(looksLikeSheet(381, 380)).toBe(false);
    expect(looksLikeSheet(393, 380)).toBe(true);
    expect(looksLikeSheet(320, 380)).toBe(true);
  });
});

describe('detectPopupHost', () => {
  it('does nothing at all in the Chrome and Firefox builds', async () => {
    stubPage(IPHONE_UA);
    const host = await loadHost('chrome');
    host.detectPopupHost();
    expect(dataset).toEqual({});
    expect(h.browser.runtime.getPlatformInfo).not.toHaveBeenCalled();
    expect(await host.isIOSPopup()).toBe(false);
    expect(listenerCount()).toBe(0);
  });

  it('leaves macOS Safari untouched', async () => {
    stubPage(MAC_UA);
    const host = await loadHost('safari');
    host.detectPopupHost();
    expect(await host.isIOSPopup()).toBe(false);
    visibility = 'visible';
    innerWidth = 1; // macOS starts a popup at 1x1 and grows it
    runFrames();
    expect(dataset).toEqual({});
    expect(listenerCount()).toBe(0);
  });

  it('marks an iPhone as a sheet before the first paint', async () => {
    stubPage(IPHONE_UA);
    h.os = 'ios';
    const host = await loadHost('safari');
    host.detectPopupHost();
    // Synchronously, before getPlatformInfo has answered.
    expect(dataset).toEqual({ platform: 'ios', popupHost: 'sheet' });
    expect(await host.isIOSPopup()).toBe(true);
    expect(dataset).toEqual({ platform: 'ios', popupHost: 'sheet' });
    expect(listenerCount()).toBe(0);
  });

  it('keeps an iPad popover at its fixed width', async () => {
    stubPage(MAC_UA);
    h.os = 'ios';
    const host = await loadHost('safari');
    host.detectPopupHost();
    expect(dataset).toEqual({});
    expect(await host.isIOSPopup()).toBe(true);
    expect(dataset).toEqual({ platform: 'ios' });

    visibility = 'visible';
    innerWidth = 380;
    fire('visibilitychange');
    runFrames();
    fire('resize');
    runFrames();
    expect(dataset.popupHost).toBeUndefined();
  });

  it('latches a sheet on an iPad in a narrow window, once it has been presented', async () => {
    stubPage(MAC_UA);
    h.os = 'ios';
    const host = await loadHost('safari');
    host.detectPopupHost();
    await host.isIOSPopup();

    // Not presented yet: no size, hidden.
    runFrames();
    expect(dataset.popupHost).toBeUndefined();

    visibility = 'visible';
    innerWidth = 320;
    fire('visibilitychange');
    expect(dataset.popupHost).toBeUndefined(); // one sighting isn't enough
    runFrames();
    expect(dataset.popupHost).toBe('sheet');
    expect(listenerCount()).toBe(0);
  });

  it("doesn't latch on one odd frame", async () => {
    stubPage(MAC_UA);
    h.os = 'ios';
    const host = await loadHost('safari');
    host.detectPopupHost();
    await host.isIOSPopup();

    visibility = 'visible';
    innerWidth = 500;
    fire('resize');
    innerWidth = 380;
    runFrames();
    expect(dataset.popupHost).toBeUndefined();
    expect(listenerCount()).toBeGreaterThan(0);
  });

  it('falls back to the user agent when getPlatformInfo fails', async () => {
    h.os = new Error('unavailable');
    stubPage(IPHONE_UA);
    let host = await loadHost('safari');
    host.detectPopupHost();
    expect(await host.isIOSPopup()).toBe(true);
    expect(dataset).toEqual({ platform: 'ios', popupHost: 'sheet' });

    dataset = {};
    stubPage(MAC_UA);
    host = await loadHost('safari');
    host.detectPopupHost();
    expect(await host.isIOSPopup()).toBe(false);
    expect(dataset).toEqual({});
  });

  it('survives a getPlatformInfo that throws instead of rejecting', async () => {
    h.browser.runtime.getPlatformInfo.mockImplementation(() => {
      throw new Error('not a function here');
    });
    stubPage(MAC_UA);
    const host = await loadHost('safari');
    expect(() => host.detectPopupHost()).not.toThrow();
    expect(await host.isIOSPopup()).toBe(false);
  });
});

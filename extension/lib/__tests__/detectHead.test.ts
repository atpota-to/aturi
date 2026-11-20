import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The popup asks detect-head for the page's AT URI and, on Safari, treats an
 * undefined reply as "the content script hasn't been injected yet" and asks
 * again after a pause (lib/activeTab.ts). So the script must answer on every
 * page, with `atUri: null` when the head names nothing. These run its main()
 * against a parsed document and a stand-in for chrome.runtime.
 */

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => unknown;

async function runOn(html: string): Promise<Listener[]> {
  const { document } = parseHTML(html);
  const listeners: Listener[] = [];
  vi.stubGlobal('document', document);
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener: (l: Listener) => listeners.push(l) } },
  });
  vi.resetModules();
  const script = (await import('../../entrypoints/detect-head.content')).default as unknown as {
    main: () => void;
  };
  script.main();
  return listeners;
}

function ask(listeners: Listener[], message: unknown) {
  const sendResponse = vi.fn();
  const returned = listeners.map((l) => l(message, {}, sendResponse));
  return { sendResponse, returned };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detect-head content script', () => {
  it('answers { atUri: null } on a page whose head names nothing', async () => {
    const listeners = await runOn('<html><head><title>x</title></head><body></body></html>');
    expect(listeners).toHaveLength(1);
    const { sendResponse, returned } = ask(listeners, { type: 'aturi:query-head' });
    expect(sendResponse).toHaveBeenCalledWith({ atUri: null });
    expect(returned).toContain(true);
  });

  it('answers with the record a legacy <link href="at://"> names', async () => {
    const uri = 'at://did:plc:abc/app.bsky.feed.post/3k';
    const listeners = await runOn(
      `<html><head><link rel="alternate" href="${uri}"></head><body></body></html>`,
    );
    const { sendResponse } = ask(listeners, { type: 'aturi:query-head' });
    expect(sendResponse).toHaveBeenCalledWith({ atUri: uri });
  });

  it('leaves every other message alone', async () => {
    const listeners = await runOn('<html><head></head><body></body></html>');
    const { sendResponse, returned } = ask(listeners, { type: 'aturi:inspect-scan' });
    expect(sendResponse).not.toHaveBeenCalled();
    expect(returned.every((r) => r === undefined)).toBe(true);
  });
});

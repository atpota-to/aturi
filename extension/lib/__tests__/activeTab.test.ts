import { describe, it, expect, vi } from 'vitest';
import { activeTabOnSafari, MESSAGE_RETRY_MS, retryOnceIfUnanswered } from '../activeTab';
import type { DetectedAtUri } from '../inspectScanner';

/**
 * The popup's Safari paths (lib/activeTab.ts): which tab it settles on, and
 * the one retry when a content script hasn't answered yet.
 */

type Tab = { id: number; url?: string };
type Query = { active: boolean; currentWindow?: boolean; lastFocusedWindow?: boolean };

/** A tabs.query fake answering by which window the query asks about. */
function fakeQuery(byWindow: { current?: Tab[] | Error; lastFocused?: Tab[] | Error }) {
  return vi.fn(async (info: Query) => {
    const answer = info.currentWindow ? byWindow.current : byWindow.lastFocused;
    if (answer instanceof Error) throw answer;
    return answer ?? [];
  });
}

describe('activeTabOnSafari', () => {
  it("takes the popup window's active tab even when Safari hides its url", async () => {
    const query = fakeQuery({ current: [{ id: 7, url: '' }], lastFocused: [{ id: 9, url: 'https://bsky.app/' }] });
    expect(await activeTabOnSafari(query)).toEqual({ id: 7, url: '' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
  });

  it('falls back to the last focused window, and asks nothing wider', async () => {
    const query = fakeQuery({ current: [], lastFocused: [{ id: 9 }] });
    expect(await activeTabOnSafari(query)).toEqual({ id: 9 });
    expect(query.mock.calls.map(([info]) => info)).toEqual([
      { active: true, currentWindow: true },
      { active: true, lastFocusedWindow: true },
    ]);
  });

  it('treats a query that throws as finding nothing', async () => {
    const query = fakeQuery({ current: new Error('no window'), lastFocused: [{ id: 3 }] });
    expect(await activeTabOnSafari(query)).toEqual({ id: 3 });
  });

  it('gives null when neither window has an active tab', async () => {
    const query = fakeQuery({ current: [], lastFocused: new Error('nope') });
    expect(await activeTabOnSafari(query)).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('copes with a query that resolves undefined', async () => {
    const query = vi.fn(async () => undefined);
    expect(await activeTabOnSafari(query)).toBeNull();
  });
});

/**
 * The replies the content scripts really send: detect-head answers
 * `aturi:query-head` even when the page's head has no AT URI, and
 * inspect-scan answers `aturi:inspect-scan` even when it found nothing.
 */
const HIT: DetectedAtUri = { uri: 'at://did:plc:abc/app.bsky.feed.post/1', where: 'link' };
const CONTENT_SCRIPT_REPLIES: Array<[string, object]> = [
  ['a head with an AT URI', { atUri: HIT.uri }],
  ['a head with none', { atUri: null }],
  ['a scan with hits', { atUris: [HIT] }],
  ['a scan with none', { atUris: [] }],
  ['a scan that failed', { atUris: [], error: 'boom' }],
];

describe('retryOnceIfUnanswered', () => {
  it.each(CONTENT_SCRIPT_REPLIES)('returns %s at once, without waiting', async (_, reply) => {
    const send = vi.fn(async () => reply);
    const wait = vi.fn(async () => {});
    expect(await retryOnceIfUnanswered(send, 200, wait)).toBe(reply);
    expect(send).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('asks once more, after the delay, when nobody answered', async () => {
    const send = vi
      .fn<() => Promise<{ atUris: DetectedAtUri[] } | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ atUris: [HIT] });
    const wait = vi.fn(async () => {});
    expect(await retryOnceIfUnanswered(send, 200, wait)).toEqual({ atUris: [HIT] });
    expect(send).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(200);
    expect(wait.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[1]);
  });

  it('gives a first attempt that rejects the same second try', async () => {
    const send = vi
      .fn<() => Promise<string | undefined>>()
      .mockRejectedValueOnce(new Error('Could not establish connection'))
      .mockResolvedValueOnce('ok');
    expect(await retryOnceIfUnanswered(send, 200, async () => {})).toBe('ok');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retries only once, and passes the second answer or error through', async () => {
    const unanswered = vi.fn(async () => undefined);
    expect(await retryOnceIfUnanswered(unanswered, 200, async () => {})).toBeUndefined();
    expect(unanswered).toHaveBeenCalledTimes(2);

    const failing = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('gone'));
    await expect(retryOnceIfUnanswered(failing, 200, async () => {})).rejects.toThrow('gone');
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('waits about 200 ms by default', async () => {
    expect(MESSAGE_RETRY_MS).toBe(200);
    vi.useFakeTimers();
    try {
      const send = vi
        .fn<() => Promise<string | undefined>>()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce('late');
      const pending = retryOnceIfUnanswered(send);
      await vi.advanceTimersByTimeAsync(199);
      expect(send).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toBe('late');
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Finding the popup's tab, and talking to its content scripts, on Safari.
 *
 * Both callers (the popup's page match and the inspect scan) take these paths
 * only in the Safari build; Chrome and Firefox keep their own.
 */

/** The two queries Safari's popup asks, in order. */
const SAFARI_ACTIVE_QUERIES = [
  { active: true, currentWindow: true },
  { active: true, lastFocusedWindow: true },
] as const;

export type ActiveTabQuery = (typeof SAFARI_ACTIVE_QUERIES)[number];

/**
 * The tab the popup was opened over, on Safari: the active tab of the
 * popup's own window, else of the last focused window, else null.
 *
 * The first tab is taken even when its `url` is empty. Safari reports `''`
 * for every page the user hasn't allowed the extension on, so "find a tab
 * with a url" fallbacks across windows would land on some other window's tab,
 * and every `tabs.query` or `windows.*` call that touches an ungranted tab can
 * make Safari ask the user for access and hold the call until they answer.
 * A query that throws counts as finding nothing.
 */
export async function activeTabOnSafari<T>(
  query: (info: ActiveTabQuery) => Promise<readonly T[] | undefined>
): Promise<T | null> {
  for (const info of SAFARI_ACTIVE_QUERIES) {
    let tabs: readonly T[] | undefined;
    try {
      tabs = await query(info);
    } catch {
      tabs = undefined;
    }
    if (tabs?.[0]) return tabs[0];
  }
  return null;
}

/**
 * How long to wait before asking a tab's content script a second time. The
 * popup's own click is what injects the content scripts on a site the user
 * granted only through `activeTab`, and that injection races the popup's
 * first message.
 */
export const MESSAGE_RETRY_MS = 200;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Send a message and, if nothing answered, send it once more after `delayMs`.
 *
 * Safari resolves `tabs.sendMessage` with undefined when no listener is
 * there yet instead of rejecting as Chrome does. Aturi's content scripts
 * always answer with an object, so undefined only ever means "nobody heard
 * it". A first attempt that rejects gets the same second try, since which of
 * the two Safari does for a tab still being injected hasn't been checked on
 * every version. The second attempt's answer or error is passed on as is.
 */
export async function retryOnceIfUnanswered<T>(
  send: () => Promise<T | undefined>,
  delayMs: number = MESSAGE_RETRY_MS,
  wait: (ms: number) => Promise<void> = sleep
): Promise<T | undefined> {
  let first: T | undefined;
  try {
    first = await send();
  } catch {
    first = undefined;
  }
  if (first !== undefined) return first;
  await wait(delayMs);
  return send();
}

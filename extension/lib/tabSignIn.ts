import { browser } from '#imports';
import { ATURI_BASE } from './aturiUrl';
import { resolveHandleToDid } from './handleResolver';
import { IS_SAFARI } from './platform';
import { endSession, loginUrl, newVerifier, putSession, redeem, type StoredSession } from './session';

/**
 * Signing in on Safari, in an ordinary tab.
 *
 * Safari has no `identity.launchWebAuthFlow`, and Apple's own guidance is to
 * "initiate an OAuth flow in a new tab". So the Safari build opens the same
 * `/api/oauth/login` URL Chrome and Firefox hand to launchWebAuthFlow, but in
 * a tab, with `return` set to a first-party page on aturi.to (TAB_RETURN_URL).
 * The callback sends that tab to `TAB_RETURN_URL#code=…`, the background
 * notices the tab arriving there, and redeems the code with the verifier it
 * kept. The binding is exactly the one `lib/session.ts` describes: the code is
 * worthless without the verifier, and the verifier never leaves this
 * extension. It is kept in storage.local, under its own key, until the flow
 * ends, and is never used after ten minutes. A flow nobody finishes is removed
 * the next time Settings > Account opens or the background starts. The
 * verifier goes to the server in one POST body; it is never put in a URL or a
 * log.
 *
 * Why the page has to be on aturi.to rather than inside the extension: Safari
 * gives an extension a new random base URL on every launch and does not let a
 * web page redirect into it. Why the user has to grant aturi.to first: Safari
 * blanks a tab's URL for any site the user has not allowed, so without the
 * grant the extension could never see the code arrive.
 *
 * Two independent paths report the arrival, because neither is guaranteed to
 * wake a background page that Safari has unloaded: `tabs.onUpdated` (Safari
 * supports no filter on it, so the URL is checked here) and a content script
 * on the return page (`entrypoints/signin-return.content.ts`). The options
 * page also asks for a check whenever it becomes visible again. All of them
 * funnel into one queue, and the pending flow is taken out of storage before
 * any network call, so whichever arrives first does the work and the rest find
 * nothing to do.
 *
 * A flow does not outlive the Safari launch it started in. Safari gives every
 * tab a new id when it relaunches and when the extension reloads, so after
 * either the stored tab ids name other tabs, or none. The pending record
 * therefore carries a token that is also kept in storage.session, which Safari
 * clears at those same moments (see LAUNCH_KEY). A record whose token no
 * longer matches is dropped and reported as a restart, and none of its tab
 * ids is used.
 *
 * The extension closes the sign-in tab only when it can see that the tab is
 * still in the flow: on the return page when the flow finishes, or on one of
 * the flow's own aturi.to pages (FLOW_PAGES) when the user presses Cancel.
 * A flow that runs out of time leaves its tab
 * open, because by then the user may be using that tab for something else.
 * Nothing here calls `tabs.get` on that tab either (see checkPendingTab).
 *
 * Chrome and Firefox never come here: they keep `signIn()` and
 * launchWebAuthFlow.
 */

/** Must equal `${origin}${EXTENSION_TAB_RETURN_PATH}` in src/app/api/oauth/login/route.ts. */
export const TAB_RETURN_URL = `${ATURI_BASE}/api/oauth/extension/return`;

/** The site access requested from the Account tab before the flow starts. */
export const ATURI_ORIGINS = [`${ATURI_BASE}/*`];

/**
 * The aturi.to pages the flow itself passes through: /api/oauth/login,
 * /api/oauth/callback and the return page. A sign-in tab on any other aturi.to
 * page is one the user has moved on in, and Cancel leaves it alone.
 */
const FLOW_PAGES = [`${ATURI_BASE}/api/oauth/*`];

/** Sent by the return page's content script. */
export const RETURN_MESSAGE = 'aturi:signin-return';
/** Sent by the options page: look at the pending tab now. */
export const CHECK_MESSAGE = 'aturi:signin-check';

/**
 * Deliberately NOT the prefs key, and deliberately storage.local.
 *
 * `lib/prefs.ts` writes the whole prefs object to storage.sync, and the
 * verifier must never leave the device. This record is the only place the
 * verifier is ever stored, and it is removed the moment the flow ends.
 */
const PENDING_KEY = 'aturi.signin.pending.v1';
/** How the last flow ended, for the options page to show. Holds no secret. */
const OUTCOME_KEY = 'aturi.signin.outcome.v1';

/**
 * In storage.session: a random token for the current Safari launch, made by
 * the first flow that needs one and copied into its pending record.
 *
 * storage.session lives in memory and is cleared when Safari quits and when
 * the extension reloads, which are exactly the times Safari hands out new tab
 * ids. So a pending record whose token is no longer here holds tab ids from an
 * earlier launch. Holds no secret.
 */
const LAUNCH_KEY = 'aturi.signin.launch.v1';

/**
 * Ten minutes, the same as the server's own authorization state. A code that
 * arrives after that came from a flow the server has already forgotten.
 */
export const PENDING_TTL_MS = 10 * 60_000;

/** An outcome older than this is stale news; the options page drops it. */
const OUTCOME_TTL_MS = 15 * 60_000;

/** Long enough for a slow lookup, short enough that sign-in never hangs on it. */
const RESOLVE_TIMEOUT_MS = 5_000;

const TIMED_OUT = 'That sign-in took too long. Try again.';
const RESTARTED = 'Safari or Aturi restarted while you were signing in. Try again.';

type PendingSignIn = {
  verifier: string;
  challenge: string;
  handle: string;
  tabId: number;
  optionsTabId?: number;
  /** The LAUNCH_KEY token when the flow started; absent if there was none. */
  launch?: string;
  startedAt: number;
};

/** What the options page may see of a pending flow: never the verifier. */
export type PendingView = { handle: string; startedAt: number; expiresAt: number };

export type SignInOutcome = { ok: true; at: number } | { ok: false; message: string; at: number };

export type TabSignInResult = 'ignored' | 'signed-in' | 'failed';

type StorageArea = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

function localArea(): StorageArea | null {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    return browser.storage.local as unknown as StorageArea;
  }
  return null;
}

function sessionArea(): StorageArea | null {
  if (typeof browser === 'undefined') return null;
  const storage = browser.storage as unknown as { session?: StorageArea } | undefined;
  return storage?.session ?? null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function readPending(): Promise<PendingSignIn | null> {
  const area = localArea();
  if (!area) return null;
  try {
    const raw = (await area.get(PENDING_KEY))[PENDING_KEY];
    if (!isRecord(raw)) return null;
    const { verifier, challenge, handle, tabId, optionsTabId, launch, startedAt } = raw;
    if (
      typeof verifier !== 'string' ||
      typeof challenge !== 'string' ||
      typeof handle !== 'string' ||
      typeof tabId !== 'number' ||
      typeof startedAt !== 'number'
    ) {
      return null;
    }
    return {
      verifier,
      challenge,
      handle,
      tabId,
      ...(typeof optionsTabId === 'number' ? { optionsTabId } : {}),
      ...(typeof launch === 'string' ? { launch } : {}),
      startedAt,
    };
  } catch {
    return null;
  }
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * This launch's token, made and stored on first use. Undefined when
 * storage.session is missing or fails: the flow then records no token, and
 * its tab ids are trusted the way they were before this check existed. Every
 * Safari this build supports has storage.session, so that is a fallback, not
 * the normal path.
 */
async function launchToken(): Promise<string | undefined> {
  const area = sessionArea();
  if (!area) return undefined;
  try {
    const existing = (await area.get(LAUNCH_KEY))[LAUNCH_KEY];
    if (typeof existing === 'string' && existing) return existing;
    const token = randomToken();
    await area.set({ [LAUNCH_KEY]: token });
    return token;
  } catch {
    return undefined;
  }
}

/**
 * Whether the pending flow started in this launch of Safari.
 *
 * A flow that recorded no token has nothing to compare, and counts as current.
 * A flow that did record one counts as current only if storage.session still
 * holds that same token. When it cannot be read back (the area is gone or the
 * read fails) the flow is treated as stale too: dropping a live flow costs the
 * user one retry, while trusting a stale tab id can close or focus a tab that
 * has nothing to do with signing in.
 */
async function sameLaunch(pending: PendingSignIn): Promise<boolean> {
  if (pending.launch === undefined) return true;
  const area = sessionArea();
  if (!area) return false;
  try {
    return (await area.get(LAUNCH_KEY))[LAUNCH_KEY] === pending.launch;
  } catch {
    return false;
  }
}

/**
 * The pending flow, if it started in this launch. A flow from an earlier
 * launch is removed here and comes back as 'stale', for the caller to report:
 * its tab ids now name other tabs, or none, so nothing may be done with them.
 */
async function currentPending(): Promise<PendingSignIn | 'stale' | null> {
  const pending = await readPending();
  if (!pending) return null;
  if (await sameLaunch(pending)) return pending;
  await localArea()?.remove(PENDING_KEY);
  return 'stale';
}

/**
 * Remove the pending flow and hand it back, but only to the tab it belongs to
 * (`tabId` undefined: any tab, for cancelling). Always called inside the queue
 * in the background, and always before the network, so a code can be redeemed
 * at most once however many reports of it arrive. A flow from an earlier
 * launch is removed whichever tab asks, and comes back as 'stale'.
 */
async function takePending(tabId?: number): Promise<PendingSignIn | 'stale' | null> {
  const pending = await currentPending();
  if (pending === null || pending === 'stale') return pending;
  if (tabId !== undefined && pending.tabId !== tabId) return null;
  await localArea()?.remove(PENDING_KEY);
  return pending;
}

function expired(pending: PendingSignIn): boolean {
  return Date.now() - pending.startedAt > PENDING_TTL_MS;
}

async function report(outcome: SignInOutcome): Promise<void> {
  await localArea()
    ?.set({ [OUTCOME_KEY]: outcome })
    .catch(() => {});
}

/* --------------------------------------------------------- options page */

/**
 * Start a sign-in. Called from the options page AFTER it has been granted
 * aturi.to (see AccountTab: the request has to happen inside the click).
 */
export async function beginTabSignIn(handle: string): Promise<void> {
  const area = localArea();
  if (!area || !browser.tabs?.create) {
    throw new Error('This browser cannot open the sign-in tab.');
  }
  const { verifier, challenge } = await newVerifier();
  const launch = await launchToken();
  const optionsTab = await Promise.resolve(browser.tabs.getCurrent?.()).catch(() => undefined);

  // Opened in the background and brought forward only once the pending record
  // exists. A record written after the switch could land late (iOS is free to
  // pause a page that is no longer in front), and a code that arrives before
  // its record is ignored.
  const tab = await browser.tabs.create({
    url: loginUrl(handle, challenge, TAB_RETURN_URL),
    active: false,
  });
  const tabId = tab?.id;
  if (typeof tabId !== 'number') throw new Error('Could not open the sign-in tab.');

  const pending: PendingSignIn = {
    verifier,
    challenge,
    handle: handle.trim(),
    tabId,
    ...(typeof optionsTab?.id === 'number' ? { optionsTabId: optionsTab.id } : {}),
    ...(launch !== undefined ? { launch } : {}),
    startedAt: Date.now(),
  };
  try {
    // The old outcome goes first: once the record exists the background may
    // finish and report at any moment, and that report must survive.
    await area.remove(OUTCOME_KEY);
    await area.set({ [PENDING_KEY]: pending });
  } catch (err) {
    await Promise.resolve(browser.tabs.remove(tabId)).catch(() => {});
    throw err;
  }
  await Promise.resolve(browser.tabs.update(tabId, { active: true })).catch(() => {});

  // The login route answers some failures (rate limited, unknown handle) by
  // sending the tab straight to the return page, which can beat the record
  // above. One check now covers that.
  requestTabSignInCheck();
}

/** Ask the background to look at the pending tab. Fire and forget. */
export function requestTabSignInCheck(): void {
  try {
    void Promise.resolve(browser.runtime.sendMessage({ type: CHECK_MESSAGE })).catch(() => {});
  } catch {
    /* no background to ask; the other paths still run */
  }
}

/**
 * What Cancel did: there was no flow, it closed the sign-in tab, or it had to
 * leave that tab open (so the page can tell the user to close it themselves).
 */
export type CancelResult = 'none' | 'closed' | 'left-open';

/**
 * The user pressed Cancel: abandon the pending flow, if any. The record goes
 * first, so the tab closing is not reported as a second cancellation.
 *
 * Its tab is closed only if it is still on one of the flow's own aturi.to
 * pages (FLOW_PAGES). Anywhere else the user may have moved on in that tab
 * (on iOS, by typing a new address into it), and closing it would lose their
 * page. While the tab is on the user's authorization server Aturi cannot see
 * it at all, so it is left open there too. A flow from an earlier launch is
 * dropped without touching any tab, and without a report: the user asked to
 * stop, and that is done.
 */
export async function cancelTabSignIn(): Promise<CancelResult> {
  const pending = await takePending();
  if (!pending) return 'none';
  if (pending === 'stale') return 'left-open';
  if (await findTab(FLOW_PAGES, pending.tabId)) {
    await Promise.resolve(browser.tabs.remove(pending.tabId)).catch(() => {});
    return 'closed';
  }
  return 'left-open';
}

/**
 * End the flow that started at `startedAt` because its ten minutes are up:
 * drop the record and report the timeout. Returns whether that flow was still
 * pending; a newer one started since is left alone. Its tab is left open,
 * because by now the user may be using it for something else.
 */
export async function expireTabSignIn(startedAt: number): Promise<boolean> {
  const pending = await readPending();
  if (!pending || pending.startedAt !== startedAt) return false;
  await localArea()?.remove(PENDING_KEY);
  await report({ ok: false, message: TIMED_OUT, at: Date.now() });
  return true;
}

type SeenTab = { id?: number; url?: string };

/**
 * Tab `tabId` if it is on a page matching `pattern`, otherwise undefined.
 *
 * Deliberately a URL-filtered `tabs.query`, never `tabs.get`. The sign-in tab
 * usually sits on the user's authorization server, a site Aturi has not been
 * granted, and `tabs.get` on it makes Safari ask the user for access to that
 * site and hold the call for up to two minutes. With a URL filter Safari
 * matches only tabs on sites Aturi already has, so it never asks. That also
 * means a miss says nothing about where the tab is.
 */
async function findTab(pattern: string | string[], tabId: number): Promise<SeenTab | undefined> {
  try {
    const tabs = (await browser.tabs.query({ url: pattern })) as SeenTab[] | undefined;
    return tabs?.find((tab) => tab.id === tabId);
  } catch {
    return undefined;
  }
}

export async function getPendingTabSignIn(): Promise<PendingView | null> {
  const pending = await readPending();
  if (!pending) return null;
  return {
    handle: pending.handle,
    startedAt: pending.startedAt,
    expiresAt: pending.startedAt + PENDING_TTL_MS,
  };
}

/** Read and clear how the last flow ended. Null when there is nothing recent. */
export async function takeTabSignInOutcome(): Promise<SignInOutcome | null> {
  const area = localArea();
  if (!area) return null;
  try {
    const raw = (await area.get(OUTCOME_KEY))[OUTCOME_KEY];
    if (raw === undefined) return null;
    await area.remove(OUTCOME_KEY);
    if (!isRecord(raw) || typeof raw.at !== 'number') return null;
    if (Date.now() - raw.at > OUTCOME_TTL_MS) return null;
    if (raw.ok === true) return { ok: true, at: raw.at };
    return {
      ok: false,
      message: typeof raw.message === 'string' && raw.message ? raw.message : 'Sign-in failed.',
      at: raw.at,
    };
  } catch {
    return null;
  }
}

/** Fires when a flow starts, ends or reports. Returns the unsubscribe. */
export function onTabSignInChanged(listener: () => void): () => void {
  const handler = (changes: Record<string, unknown>, area: string) => {
    if (area !== 'local') return;
    if (PENDING_KEY in changes || OUTCOME_KEY in changes) listener();
  };
  try {
    browser.storage.onChanged.addListener(handler);
  } catch {
    return () => {};
  }
  return () => {
    try {
      browser.storage.onChanged.removeListener(handler);
    } catch {
      /* ignore */
    }
  };
}

/* ----------------------------------------------------------- background */

type Landed = { code: string } | { error: string };

/**
 * What the return page's URL says, or null if `url` is not the return page.
 *
 * Origin and path must equal TAB_RETURN_URL's exactly: no prefix match, so
 * `/returnx`, `/return/` and other hosts are not it. A URL that is the page
 * but carries neither a code nor an error is also null, and does not use up
 * the pending flow.
 */
function readReturnUrl(url: string): Landed | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const expected = new URL(TAB_RETURN_URL);
  if (parsed.origin !== expected.origin || parsed.pathname !== expected.pathname) return null;
  // The code comes back in the fragment, which is never sent to a server.
  const code = new URLSearchParams(parsed.hash.replace(/^#/, '')).get('code');
  if (code) return { code };
  const error = parsed.searchParams.get('oauth_error');
  if (error !== null) return { error: error || 'Sign-in failed.' };
  return null;
}

/**
 * One queue for every report. Each task runs to the end before the next
 * starts, so two reports of the same code cannot both find the pending flow.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * The tab `tabId` has reached `url`. Finish the flow if it is the pending
 * flow's tab on the return page; otherwise do nothing at all (no storage
 * write, no network). Safe to call any number of times for the same arrival.
 */
export function completeTabSignIn(url: string, tabId: number): Promise<TabSignInResult> {
  const landed = readReturnUrl(url);
  if (!landed) return Promise.resolve('ignored');
  return serialized(() => finish(landed, tabId));
}

async function finish(landed: Landed, tabId: number): Promise<TabSignInResult> {
  const pending = await takePending(tabId);
  if (pending === 'stale') return restarted();
  if (!pending) return 'ignored';

  let outcome: SignInOutcome;
  try {
    if (expired(pending)) throw new Error(TIMED_OUT);
    if ('error' in landed) throw new Error(landed.error);
    const session = await redeem(landed.code, pending.verifier);
    await requireTypedAccount(pending.handle, session);
    await putSession(session);
    outcome = { ok: true, at: Date.now() };
  } catch (err) {
    outcome = {
      ok: false,
      message: err instanceof Error && err.message ? err.message : 'Sign-in failed.',
      at: Date.now(),
    };
  }
  await report(outcome);
  await backToOptions(pending);
  return outcome.ok ? 'signed-in' : 'failed';
}

/**
 * Defence in depth: the account that came back must be the one typed.
 *
 * The verifier already binds the code to this extension. What it cannot rule
 * out is a flow whose challenge leaked (it travels in the login URL, so it is
 * in server logs) being completed with somebody else's code. When the typed
 * handle or DID resolves, a different DID is refused and that session is ended
 * on the server rather than kept. A server URL names no account, and a failed
 * lookup proves nothing either way, so both are accepted as before.
 */
async function requireTypedAccount(typed: string, session: StoredSession): Promise<void> {
  const raw = typed.trim().replace(/^@/, '');
  if (!raw || /^https?:\/\//i.test(raw)) return;
  // Handles are case-insensitive; DIDs are not.
  const id = raw.startsWith('did:') ? raw : raw.toLowerCase();
  const expected = await withTimeout(resolveHandleToDid(id), RESOLVE_TIMEOUT_MS);
  if (!expected || expected === session.did) return;
  await endSession(session.token);
  throw new Error(
    `That signed in a different account from ${id}, so Aturi signed it straight back out. ` +
      `Try again, and choose ${id} on the sign-in page.`,
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** A flow was dropped because Safari restarted under it. No tab is touched. */
async function restarted(): Promise<TabSignInResult> {
  await report({ ok: false, message: RESTARTED, at: Date.now() });
  return 'failed';
}

/**
 * Close the sign-in tab, which `finish` has just seen on the return page, and
 * put the user back on the Account tab. Only `finish` calls this, after the
 * launch check, so neither id can belong to a tab from an earlier launch.
 */
async function backToOptions(pending: PendingSignIn): Promise<void> {
  if (pending.optionsTabId !== undefined) {
    try {
      const tab = await browser.tabs.update(pending.optionsTabId, { active: true });
      // The options tab can be in another window on macOS. iOS has no
      // windows.update at all, and needs none.
      const windows = (browser as unknown as {
        windows?: { update?: (id: number, info: { focused: boolean }) => Promise<unknown> };
      }).windows;
      if (typeof tab?.windowId === 'number' && windows?.update) {
        await windows.update(tab.windowId, { focused: true });
      }
    } catch {
      /* the options tab was closed; Safari picks the next tab itself */
    }
  }
  await Promise.resolve(browser.tabs.remove(pending.tabId)).catch(() => {});
}

/**
 * The options page asked for a look at the pending tab: covers a background
 * that slept through both reports, and the record that lost the race in
 * beginTabSignIn.
 *
 * The tab is looked for only among tabs on the return page (findTab), so this
 * never makes Safari ask about the site the sign-in tab is on, and never holds
 * up the queue that the real report of the code waits in. Not finding it there
 * is not taken to mean the tab is gone: tabs.onRemoved covers a closed tab,
 * and the ten-minute timeout covers the rest, dropping the flow but leaving
 * the tab open.
 */
function checkPendingTab(): Promise<TabSignInResult> {
  return serialized(async () => {
    const pending = await currentPending();
    if (pending === 'stale') return restarted();
    if (!pending) return 'ignored';
    const tab = await findTab(`${TAB_RETURN_URL}*`, pending.tabId);
    const landed = tab?.url ? readReturnUrl(tab.url) : null;
    if (landed) return finish(landed, pending.tabId);
    if (expired(pending)) {
      await expireTabSignIn(pending.startedAt);
      return 'failed';
    }
    return 'ignored';
  });
}

/**
 * A tab was closed. If it was the sign-in tab, the user gave up. After a
 * relaunch any tab closing also clears the old flow, whose tab ids can no
 * longer be matched.
 */
function abandonIfPending(tabId: number): Promise<void> {
  return serialized(async () => {
    const pending = await takePending(tabId);
    if (pending === 'stale') {
      await restarted();
      return;
    }
    if (!pending) return;
    await report({ ok: false, message: 'Sign-in was cancelled.', at: Date.now() });
  });
}

/**
 * At background start, end a flow whose ten minutes are up. Covers a flow
 * nobody finished while no Settings page was open to time it out. Safari
 * unloads an idle background page and starts it again for the next event it
 * listens to, so this runs often.
 *
 * This is queued before the event that woke the background, so it has to do
 * what that event would have: if the expired flow's tab is on the return page,
 * `finish` reports the timeout and closes that tab as it would for a late
 * report. Otherwise the record is dropped and no tab is touched. A flow from
 * an earlier launch is dropped and reported as a restart.
 */
function sweepExpired(): Promise<void> {
  return serialized(async () => {
    const pending = await currentPending();
    if (pending === 'stale') {
      await restarted();
      return;
    }
    if (!pending || !expired(pending)) return;
    const tab = await findTab(`${TAB_RETURN_URL}*`, pending.tabId);
    const landed = tab?.url ? readReturnUrl(tab.url) : null;
    if (landed) {
      await finish(landed, pending.tabId);
      return;
    }
    await expireTabSignIn(pending.startedAt);
  });
}

/**
 * Register the background listeners. Call once, synchronously, at the top
 * level of the background's main(), so Safari can wake a suspended background
 * page for these events. A no-op outside the Safari build. Also starts one
 * sweep for an expired flow, without waiting for it.
 *
 * The message listener answers only RETURN_MESSAGE and CHECK_MESSAGE. For
 * anything else it returns undefined and never touches sendResponse, so the
 * background's own listener answers its messages exactly as before.
 */
export function installTabSignIn(): void {
  if (!IS_SAFARI) return;

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Every tab's every update comes through here; the string check keeps it
    // to one comparison for all but the return page.
    const url = changeInfo.url ?? tab?.url;
    if (typeof url !== 'string' || !url.startsWith(TAB_RETURN_URL)) return;
    completeTabSignIn(url, tabId).catch(() => {});
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    abandonIfPending(tabId).catch(() => {});
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isRecord(message)) return undefined;
    if (message.type === RETURN_MESSAGE) {
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number' || typeof message.url !== 'string') return undefined;
      completeTabSignIn(message.url, tabId).then(
        (result) => sendResponse({ result }),
        () => sendResponse({ result: 'failed' }),
      );
      return true;
    }
    if (message.type === CHECK_MESSAGE) {
      checkPendingTab().then(
        (result) => sendResponse({ result }),
        () => sendResponse({ result: 'failed' }),
      );
      return true;
    }
    return undefined;
  });

  sweepExpired().catch(() => {});
}

/**
 * The mutuals' blocks tool's requests. What the answers mean is in
 * mutuals.ts.
 *
 * Everything goes straight from the browser:
 *
 *   - The public AppView, for the account, its follows and followers, which
 *     follows follow back, and what a profile or a list looks like.
 *   - Slingshot, for where each mutual's repository lives.
 *   - Each mutual's own PDS, for its block and listblock records.
 *
 * The cost of a scan lands mostly on the PDSes, a page of a hundred records
 * at a time. They are read a few mutuals at once, and a PDS that says it is
 * busy is waited for rather than pressed.
 */

import { APPVIEW } from '@/utils/atproto/config';
import { withDeadline } from '@/utils/requestDeadline';
import { mapWithConcurrency, resolveMiniDoc } from '@/utils/atproto/slingshot';
import { resolveActor } from './labelsClient';
import {
  BLOCK_COLLECTION,
  GRAPH_PAGE_LIMIT,
  GRAPH_PAGE_SIZE,
  LISTBLOCK_COLLECTION,
  RELATIONSHIPS_CHUNK,
  avatarThumb,
  cleanHandle,
  histogram,
  mutualStrategy,
  readBlockSubject,
  readListBlockSubject,
  readSnapshot,
  slimTally,
  tallyBlock,
  type MutualState,
  type MutualStrategy,
  type Person,
  type ScanSnapshot,
  type Tally,
} from './mutuals';

/** Mutuals read at once. */
const MUTUAL_CONCURRENCY = 6;
/** `getRelationships` and `getProfiles` requests at once. */
const APPVIEW_CONCURRENCY = 4;
/** Pages of one repository's listblocks read at most. A thousand lists is far more than anyone blocks. */
const LISTBLOCK_PAGE_LIMIT = 10;
/** The longest a PDS's "try again later" is waited out, and how often. */
const RATE_LIMIT_WAIT_MS = 60_000;
const RATE_LIMIT_RETRIES = 2;
/** How often a running scan redraws the page. */
const PUBLISH_EVERY_MS = 200;

export type ListInfo = {
  uri: string;
  name: string;
  description: string | null;
  avatar: string | null;
  memberCount: number | null;
  creator: Person;
};

export type Scan = {
  account: Person;
  followsCount: number;
  followersCount: number;
  /** How the mutuals were found. Null until the follows are listed. */
  strategy: MutualStrategy | null;
  /**
   * `follows` while the follows are listed, `mutuals` while the follow-backs
   * are found, `blocks` while the mutuals' repositories are read, `done`
   * when every one has been read or Stop was pressed.
   */
  phase: 'follows' | 'mutuals' | 'blocks' | 'done';
  stopped: boolean;
  /** Follows listed, then follows checked, for the progress line. */
  progress: number;
  /** Some follows or followers were past what is paged through. */
  partialMutuals: boolean;
  /** Every account the scanned one follows. */
  follows: Set<string>;
  /** Every account it blocks, or null when its own repository could not be read. */
  ownBlocks: Set<string> | null;
  mutuals: Person[];
  /** One per mutual, in the same order. */
  states: MutualState[];
  tally: Tally;
  /** Lists blocked wholesale, to the mutuals blocking them. */
  listBlocks: Tally;
  /** Block records read, across every mutual. */
  blocksRead: number;
  /**
   * Set when the scan came back from session storage, with the distribution
   * as it was before accounts with a single blocker were dropped.
   */
  restored: { savedAt: number; counts: number[] } | null;
  /** Bumped on every publish. */
  version: number;
};

/** Set `stop` to end a scan after the pages already in flight. */
export type ScanStopper = { stop: boolean };

/* -------------------------------------------------------------------------- *
 * Fetching
 * -------------------------------------------------------------------------- */

type Answer<T> =
  | { ok: true; body: T }
  | { ok: false; status: number; error: string | null; message: string | null; resetAt: number | null };

/** When a 429 says to come back, as epoch milliseconds. */
function resetFrom(res: Response): number | null {
  const reset = Number(res.headers.get('ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return reset * 1000;
  const after = Number(res.headers.get('retry-after'));
  if (Number.isFinite(after) && after > 0) return Date.now() + after * 1000;
  return null;
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<Answer<T>> {
  let res: Response;
  try {
    // A PDS address comes from a DID document anyone can write; a PDS
    // answering XRPC never needs to redirect, so a redirect is refused.
    res = await fetch(url, { signal: withDeadline(signal), redirect: 'error' });
  } catch (err) {
    if (signal.aborted) throw err;
    return { ok: false, status: 0, error: null, message: null, resetAt: null };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
    return {
      ok: false,
      status: res.status,
      error: typeof body?.error === 'string' ? body.error : null,
      message: typeof body?.message === 'string' && body.message ? body.message : null,
      resetAt: res.status === 429 ? resetFrom(res) : null,
    };
  }
  try {
    return { ok: true, body: (await res.json()) as T };
  } catch {
    return { ok: false, status: res.status, error: null, message: 'The answer was not JSON.', resetAt: null };
  }
}

/** A query to the AppView that has to succeed. One retry for a dropped connection or a 5xx. */
async function appview<T>(nsid: string, params: [string, string][], signal: AbortSignal, what: string): Promise<T> {
  const url = `${APPVIEW}/xrpc/${nsid}?${new URLSearchParams(params)}`;
  let answer = await getJson<T>(url, signal);
  if (!answer.ok && (answer.status === 0 || answer.status >= 500)) answer = await getJson<T>(url, signal);
  if (answer.ok) return answer.body;
  throw new Error(`Bluesky’s AppView did not answer while ${what}${answer.message ? `: ${answer.message}` : '.'}`);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

type ProfileView = {
  did?: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
  followsCount?: number;
  followersCount?: number;
};

function person(view: ProfileView & { did: string }): Person {
  return {
    did: view.did,
    handle: cleanHandle(view.handle),
    displayName: view.displayName?.trim() || null,
    avatar: avatarThumb(view.avatar ?? null),
  };
}

/* -------------------------------------------------------------------------- *
 * The account and its mutuals
 * -------------------------------------------------------------------------- */

async function loadAccount(actor: string, signal: AbortSignal) {
  const did = await resolveActor(actor);
  if (!did) throw new Error(`${actor} does not resolve to an account. Check the spelling, or use its DID.`);
  const answer = await getJson<ProfileView>(
    `${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`,
    signal,
  );
  if (!answer.ok) {
    if (answer.status === 400) {
      throw new Error('Bluesky’s AppView has no profile for this account, so it cannot say who its mutuals are.');
    }
    throw new Error('Bluesky’s AppView did not answer. Try again in a moment.');
  }
  const view = answer.body;
  return {
    account: person({ ...view, did }),
    followsCount: view.followsCount ?? 0,
    followersCount: view.followersCount ?? 0,
  };
}

/** Everyone the account follows, with their profiles. */
async function listFollows(did: string, signal: AbortSignal, stopper: ScanStopper, onPage: (read: number) => void) {
  const people: Person[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < GRAPH_PAGE_LIMIT; page++) {
    if (stopper.stop) return { people, partial: true };
    const params: [string, string][] = [['actor', did], ['limit', String(GRAPH_PAGE_SIZE)]];
    if (cursor) params.push(['cursor', cursor]);
    const body = await appview<{ follows?: ProfileView[]; cursor?: string }>(
      'app.bsky.graph.getFollows',
      params,
      signal,
      'listing who this account follows',
    );
    for (const view of body.follows ?? []) if (view.did) people.push(person(view as ProfileView & { did: string }));
    onPage(people.length);
    if (!body.cursor || !body.follows?.length) return { people, partial: false };
    cursor = body.cursor;
  }
  return { people, partial: true };
}

/** Everyone who follows the account, by DID. */
async function listFollowers(did: string, signal: AbortSignal, stopper: ScanStopper, onPage: (read: number) => void) {
  const dids = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < GRAPH_PAGE_LIMIT; page++) {
    if (stopper.stop) return { dids, partial: true };
    const params: [string, string][] = [['actor', did], ['limit', String(GRAPH_PAGE_SIZE)]];
    if (cursor) params.push(['cursor', cursor]);
    const body = await appview<{ followers?: ProfileView[]; cursor?: string }>(
      'app.bsky.graph.getFollowers',
      params,
      signal,
      'listing this account’s followers',
    );
    for (const view of body.followers ?? []) if (view.did) dids.add(view.did);
    onPage(dids.size);
    if (!body.cursor || !body.followers?.length) return { dids, partial: false };
    cursor = body.cursor;
  }
  return { dids, partial: true };
}

/** Which of `others` follow the account, asked thirty at a time. */
async function followBacks(
  did: string,
  others: readonly string[],
  signal: AbortSignal,
  stopper: ScanStopper,
  onChecked: (n: number) => void,
) {
  const back = new Set<string>();
  const chunks: string[][] = [];
  for (let i = 0; i < others.length; i += RELATIONSHIPS_CHUNK) chunks.push(others.slice(i, i + RELATIONSHIPS_CHUNK));
  let checked = 0;
  await mapWithConcurrency(chunks, APPVIEW_CONCURRENCY, async (chunk) => {
    if (stopper.stop) return;
    const params: [string, string][] = [['actor', did], ...chunk.map((other): [string, string] => ['others', other])];
    const body = await appview<{ relationships?: { did?: string; followedBy?: string }[] }>(
      'app.bsky.graph.getRelationships',
      params,
      signal,
      'checking which follows follow back',
    );
    for (const rel of body.relationships ?? []) if (rel.did && rel.followedBy) back.add(rel.did);
    checked += chunk.length;
    onChecked(checked);
  });
  return back;
}

/* -------------------------------------------------------------------------- *
 * Reading a repository
 * -------------------------------------------------------------------------- */

/** A repository that could not be read, and why, in words for the page. */
class Unreadable extends Error {}

const REPO_ERRORS: Record<string, string> = {
  RepoNotFound: 'its repository is gone',
  RepoDeactivated: 'the account is deactivated',
  RepoTakendown: 'the account was taken down',
  RepoSuspended: 'the account is suspended',
};

/** Where a repository lives. Only an https PDS is read. */
async function pdsFor(did: string, signal: AbortSignal): Promise<string> {
  const doc = await resolveMiniDoc(did, signal);
  if (signal.aborted) throw signal.reason;
  if (!doc?.pds) throw new Unreadable('its identity did not resolve');
  let url: URL;
  try {
    url = new URL(doc.pds);
  } catch {
    throw new Unreadable('its PDS address is not a URL');
  }
  if (url.protocol !== 'https:') throw new Unreadable('its PDS is not served over https');
  return url.origin;
}

/**
 * Read every record in one collection of a repository, a page at a time,
 * handing each page's values to `onPage`. Waits out a PDS's rate limit a
 * couple of times before giving up on it. Stops early when the stopper is
 * set, with what was read so far kept.
 */
async function readCollection(
  pds: string,
  did: string,
  collection: string,
  signal: AbortSignal,
  stopper: ScanStopper,
  onPage: (values: unknown[]) => void,
  pageLimit = Infinity,
): Promise<void> {
  let cursor: string | undefined;
  for (let page = 0; page < pageLimit; page++) {
    if (stopper.stop) return;
    const params = new URLSearchParams({ repo: did, collection, limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const url = `${pds}/xrpc/com.atproto.repo.listRecords?${params}`;

    let answer = await getJson<{ records?: { value?: unknown }[]; cursor?: string }>(url, signal);
    for (let retry = 0; !answer.ok && retry < RATE_LIMIT_RETRIES; retry++) {
      if (answer.status === 429) {
        const wait = answer.resetAt ? answer.resetAt - Date.now() : 10_000;
        if (wait > RATE_LIMIT_WAIT_MS) break;
        await sleep(Math.max(1000, wait), signal);
      } else if (answer.status === 0 || answer.status >= 500) {
        await sleep(1000 * (retry + 1), signal);
      } else {
        break;
      }
      if (stopper.stop) return;
      answer = await getJson(url, signal);
    }
    if (!answer.ok) {
      if (answer.error && REPO_ERRORS[answer.error]) throw new Unreadable(REPO_ERRORS[answer.error]);
      if (answer.status === 429) throw new Unreadable('its PDS asked to slow down');
      if (answer.status === 0) throw new Unreadable('its PDS did not answer');
      throw new Unreadable(`its PDS answered ${answer.status}${answer.message ? ` (${answer.message})` : ''}`);
    }
    const records = answer.body.records ?? [];
    onPage(records.map((record) => record.value));
    if (!answer.body.cursor || records.length === 0) return;
    cursor = answer.body.cursor;
  }
}

/* -------------------------------------------------------------------------- *
 * The scan
 * -------------------------------------------------------------------------- */

/** Finished scans, for the life of the page, by the input they answered. */
const memory = new Map<string, Scan>();
const SNAPSHOT_KEY = 'aturi:tools:mutuals';

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function keep(actor: string, scan: Scan) {
  memory.set(actor.toLowerCase(), scan);
  const store = storage();
  if (!store) return;
  const snapshot: ScanSnapshot = {
    v: 1,
    actor: actor.toLowerCase(),
    did: scan.account.did,
    savedAt: Date.now(),
    account: scan.account,
    mutuals: scan.mutuals,
    states: scan.states,
    follows: [...scan.follows],
    ownBlocks: scan.ownBlocks ? [...scan.ownBlocks] : null,
    tally: slimTally(scan.tally),
    counts: scan.restored?.counts ?? histogram(scan.tally),
    listBlocks: [...scan.listBlocks],
    blocksRead: scan.blocksRead,
    stopped: scan.stopped,
    partialMutuals: scan.partialMutuals,
  };
  try {
    store.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Over quota, or storage refused: the scan still stands for this page.
    try {
      store.removeItem(SNAPSHOT_KEY);
    } catch {
      // Nothing more to do.
    }
  }
}

function recall(actor: string): Scan | null {
  const kept = memory.get(actor.toLowerCase());
  if (kept) return kept;
  const snapshot = readSnapshot(storage()?.getItem(SNAPSHOT_KEY) ?? null, actor, Date.now());
  if (!snapshot) return null;
  const scan: Scan = {
    account: snapshot.account,
    followsCount: snapshot.follows.length,
    followersCount: 0,
    strategy: null,
    phase: 'done',
    stopped: snapshot.stopped,
    progress: 0,
    partialMutuals: snapshot.partialMutuals,
    follows: new Set(snapshot.follows),
    ownBlocks: snapshot.ownBlocks ? new Set(snapshot.ownBlocks) : null,
    mutuals: snapshot.mutuals,
    states: snapshot.states,
    tally: new Map(snapshot.tally),
    listBlocks: new Map(snapshot.listBlocks),
    blocksRead: snapshot.blocksRead,
    restored: { savedAt: snapshot.savedAt, counts: snapshot.counts },
    version: 0,
  };
  memory.set(actor.toLowerCase(), scan);
  return scan;
}

/** Forget a kept scan, so the next run reads everything again. */
export function forgetScan(actor: string) {
  memory.delete(actor.toLowerCase());
  const store = storage();
  try {
    const snapshot = readSnapshot(store?.getItem(SNAPSHOT_KEY) ?? null, actor, Date.now());
    if (snapshot) store?.removeItem(SNAPSHOT_KEY);
  } catch {
    // Nothing kept, or storage refused.
  }
}

/**
 * Scan an account's mutuals' blocks, publishing as it goes. A scan already
 * made for the same input on this page, or kept across a sign-in, is
 * returned as it was.
 */
export async function scanMutuals(
  actor: string,
  { signal, publish, stopper }: { signal: AbortSignal; publish: (scan: Scan) => void; stopper: ScanStopper },
): Promise<Scan> {
  const kept = recall(actor);
  if (kept) return kept;

  const { account, followsCount, followersCount } = await loadAccount(actor, signal);
  const scan: Scan = {
    account,
    followsCount,
    followersCount,
    strategy: null,
    phase: 'follows',
    stopped: false,
    progress: 0,
    partialMutuals: false,
    follows: new Set(),
    ownBlocks: null,
    mutuals: [],
    states: [],
    tally: new Map(),
    listBlocks: new Map(),
    blocksRead: 0,
    restored: null,
    version: 0,
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    scan.version += 1;
    publish({ ...scan, states: scan.states.slice() });
  };
  const soon = () => {
    if (!timer) timer = setTimeout(flush, PUBLISH_EVERY_MS);
  };
  signal.addEventListener('abort', () => timer && clearTimeout(timer), { once: true });
  flush();

  // The account's own blocks, read beside everything else: they only mark
  // which results it has already dealt with, so a failure costs nothing.
  const ownBlocks = (async () => {
    try {
      const pds = await pdsFor(account.did, signal);
      const blocks = new Set<string>();
      await readCollection(pds, account.did, BLOCK_COLLECTION, signal, { stop: false }, (values) => {
        for (const value of values) {
          const subject = readBlockSubject(value);
          if (subject) blocks.add(subject);
        }
      });
      return blocks;
    } catch (err) {
      if (signal.aborted) throw err;
      return null;
    }
  })();
  // Awaited at the end; marked handled now so an abort before then is not
  // reported as an unhandled rejection.
  ownBlocks.catch(() => undefined);

  const follows = await listFollows(account.did, signal, stopper, (read) => {
    scan.progress = read;
    soon();
  });
  scan.follows = new Set(follows.people.map((p) => p.did));
  scan.partialMutuals = follows.partial && !stopper.stop;

  const strategy = mutualStrategy(follows.people.length, followersCount);
  scan.strategy = strategy;
  scan.phase = 'mutuals';
  scan.progress = 0;
  flush();

  const others = follows.people.filter((p) => p.did !== account.did);
  let back: Set<string>;
  if (strategy === 'followers') {
    const followers = await listFollowers(account.did, signal, stopper, (read) => {
      scan.progress = read;
      soon();
    });
    back = followers.dids;
    if (followers.partial && !stopper.stop) scan.partialMutuals = true;
  } else {
    back = await followBacks(
      account.did,
      others.map((p) => p.did),
      signal,
      stopper,
      (checked) => {
        scan.progress = checked;
        soon();
      },
    );
  }

  scan.mutuals = others.filter((p) => back.has(p.did));
  scan.states = scan.mutuals.map((): MutualState => ({ status: 'queued' }));
  scan.phase = 'blocks';
  scan.progress = 0;
  flush();

  await mapWithConcurrency(scan.mutuals, MUTUAL_CONCURRENCY, async (mutual, index) => {
    if (stopper.stop) return;
    const seen = new Set<string>();
    let blocks = 0;
    scan.states[index] = { status: 'reading', blocks };
    soon();
    try {
      const pds = await pdsFor(mutual.did, signal);
      await readCollection(pds, mutual.did, BLOCK_COLLECTION, signal, stopper, (values) => {
        for (const value of values) {
          const subject = readBlockSubject(value);
          if (!subject || subject === account.did) continue;
          if (tallyBlock(scan.tally, seen, index, subject)) blocks += 1;
        }
        scan.blocksRead += values.length;
        scan.states[index] = { status: 'reading', blocks };
        soon();
      });
      const lists = new Set<string>();
      await readCollection(
        pds,
        mutual.did,
        LISTBLOCK_COLLECTION,
        signal,
        stopper,
        (values) => {
          for (const value of values) {
            const subject = readListBlockSubject(value);
            if (subject) tallyBlock(scan.listBlocks, lists, index, subject);
          }
        },
        LISTBLOCK_PAGE_LIMIT,
      );
      scan.states[index] = stopper.stop
        ? { status: 'skipped', blocks, reason: 'stopped before it was read to the end', stopped: true }
        : { status: 'done', blocks, listBlocks: lists.size };
    } catch (err) {
      if (signal.aborted) throw err;
      const reason = err instanceof Unreadable ? err.message : 'its repository could not be read';
      scan.states[index] = { status: 'skipped', blocks, reason };
    }
    scan.progress += 1;
    soon();
  });

  for (let i = 0; i < scan.states.length; i++) {
    if (scan.states[i].status === 'queued') {
      scan.states[i] = { status: 'skipped', blocks: 0, reason: 'stopped before it was read', stopped: true };
    }
  }
  scan.ownBlocks = await ownBlocks;
  scan.stopped = stopper.stop;
  scan.phase = 'done';
  flush();
  const done = { ...scan, states: scan.states.slice() };
  keep(actor, done);
  return done;
}

/* -------------------------------------------------------------------------- *
 * Describing what the page shows
 * -------------------------------------------------------------------------- */

/**
 * Profiles for some accounts, keyed by DID. An account the AppView does not
 * know is absent; one in a chunk that failed is absent too, but listed in
 * `failed` so it is not called missing.
 */
export async function loadProfiles(
  dids: readonly string[],
  signal: AbortSignal,
): Promise<{ profiles: Map<string, Person>; failed: Set<string> }> {
  const profiles = new Map<string, Person>();
  const failed = new Set<string>();
  const chunks: string[][] = [];
  for (let i = 0; i < dids.length; i += 25) chunks.push(dids.slice(i, i + 25));
  await mapWithConcurrency(chunks, APPVIEW_CONCURRENCY, async (chunk) => {
    const params = new URLSearchParams();
    for (const did of chunk) params.append('actors', did);
    const answer = await getJson<{ profiles?: ProfileView[] }>(
      `${APPVIEW}/xrpc/app.bsky.actor.getProfiles?${params}`,
      signal,
    );
    if (!answer.ok) {
      for (const did of chunk) failed.add(did);
      return;
    }
    for (const view of answer.body.profiles ?? []) {
      if (view.did) profiles.set(view.did, person(view as ProfileView & { did: string }));
    }
  });
  return { profiles, failed };
}

type ListViewBody = {
  list?: {
    uri?: string;
    name?: string;
    description?: string;
    avatar?: string;
    listItemCount?: number;
    creator?: ProfileView;
  };
};

/** What each list is called, who made it and how big it is. Null for a list the AppView will not describe. */
export async function describeLists(uris: readonly string[], signal: AbortSignal): Promise<Map<string, ListInfo | null>> {
  const out = new Map<string, ListInfo | null>();
  await mapWithConcurrency(uris, APPVIEW_CONCURRENCY, async (uri) => {
    const answer = await getJson<ListViewBody>(
      `${APPVIEW}/xrpc/app.bsky.graph.getList?${new URLSearchParams({ list: uri, limit: '1' })}`,
      signal,
    );
    const list = answer.ok ? answer.body.list : undefined;
    out.set(
      uri,
      list?.creator?.did
        ? {
            uri,
            name: list.name?.trim() || 'Untitled list',
            description: list.description?.trim() || null,
            avatar: avatarThumb(list.avatar ?? null),
            memberCount: typeof list.listItemCount === 'number' ? list.listItemCount : null,
            creator: person(list.creator as ProfileView & { did: string }),
          }
        : null,
    );
  });
  return out;
}

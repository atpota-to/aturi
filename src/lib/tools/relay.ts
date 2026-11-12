/**
 * The relay crawl check's logic: which relays to ask about a PDS, and how to
 * read what each one says.
 *
 * A PDS reaches the rest of the network through relays. A relay learns of a
 * host when the host asks to be crawled (`com.atproto.sync.requestCrawl`),
 * subscribes to its event stream, and from then on answers
 * `com.atproto.sync.getHostStatus?hostname=<host>` with what it knows: a
 * status, how many of the host's accounts it has seen, and how far through
 * the host's event sequence it has read. A host it has never heard of gets a
 * `HostNotFound` error.
 *
 * Everything here is pure. The asking is done from the browser
 * (RelayStatusList.tsx): the relays below all allow cross-origin reads.
 */

import { RELAY } from '@/utils/atproto/config';

export type Relay = {
  /** The relay's hostname, as `https://<host>/xrpc/…` is asked. */
  host: string;
  operator: string;
  /** Where it runs, as its operator describes it. */
  where: string;
};

/**
 * The relays asked. Each one was checked by hand before it was listed: it
 * answers `getHostStatus` for a known host and `HostNotFound` for an unknown
 * one, and sends `Access-Control-Allow-Origin: *` on both, so a browser can
 * read either answer.
 *
 * The first is the relay the rest of the explorer already asks (config.ts).
 * The two microcosm relays are the ones microcosm.blue lists as its public
 * full-network relays.
 *
 * Left out on purpose: `bsky.network`, which answered with the same figures
 * as the US West relay and would only repeat it; and several third-party
 * relays that answer the method but send no CORS header (atproto.africa,
 * relay.waow.tech), or whose operator could not be confirmed. A relay is
 * added here once it passes the same checks.
 */
export const RELAYS: Relay[] = [
  { host: new URL(RELAY).host, operator: 'Bluesky', where: 'US East' },
  { host: 'relay1.us-west.bsky.network', operator: 'Bluesky', where: 'US West' },
  { host: 'relay.fire.hose.cam', operator: 'microcosm', where: 'Montreal' },
  { host: 'relay3.fr.hose.cam', operator: 'microcosm', where: 'France' },
];

/* -------------------------------------------------------------------------- *
 * Input
 * -------------------------------------------------------------------------- */

export type RelayInput =
  /** A URL was given, so this is certainly a host. */
  | { ok: true; kind: 'host'; host: string }
  /** A DID, or a handle marked as one with @ or at://. Its PDS is looked up. */
  | { ok: true; kind: 'account'; identifier: string }
  /** A bare domain: a PDS hostname, or a handle. The page asks to find out. */
  | { ok: true; kind: 'either'; host: string }
  | { ok: false; reason: string };

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\d{1,5})?$/;

/** Read what was typed as a PDS host, or as an account whose PDS to look up. */
export function normalizeRelayInput(raw: string): RelayInput {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter a PDS hostname.' };

  if (/^did:/i.test(value)) {
    return /^did:(plc|web):\S+$/.test(value)
      ? { ok: true, kind: 'account', identifier: value }
      : { ok: false, reason: 'That DID could not be read. Only did:plc and did:web have a PDS to look up.' };
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      return { ok: true, kind: 'host', host: new URL(value).host.toLowerCase() };
    } catch {
      return { ok: false, reason: 'That URL could not be read. Enter a hostname such as pds.example.com.' };
    }
  }

  const marked = /^(at:\/\/|@)/i.test(value);
  const bare = value
    .replace(/^at:\/\//i, '')
    .replace(/^@/, '')
    .split('/')[0]
    .replace(/\.$/, '')
    .toLowerCase();
  if (/^did:(plc|web):\S+$/.test(bare)) return { ok: true, kind: 'account', identifier: bare };
  if (!HOSTNAME.test(bare)) {
    return {
      ok: false,
      reason: 'Enter a PDS hostname such as pds.example.com, or a handle or DID to look up its PDS.',
    };
  }
  return marked ? { ok: true, kind: 'account', identifier: bare } : { ok: true, kind: 'either', host: bare };
}

/** The hostname of a PDS endpoint from a DID document (`https://pds.example.com`). */
export function hostOfEndpoint(endpoint: string): string | null {
  try {
    return new URL(endpoint).host.toLowerCase() || null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- *
 * What a relay answers
 * -------------------------------------------------------------------------- */

export type RelayAnswer =
  /** The relay has a record of the host. Only `hostname` is required of it. */
  | { state: 'known'; status: string | null; accountCount: number | null; seq: number | null }
  /** `HostNotFound`: the relay has never been asked to crawl this host. */
  | { state: 'unknown' }
  /** The relay did not answer, or answered something else. */
  | { state: 'error'; message: string };

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Read a relay's response to `getHostStatus`. */
export function readHostStatus(httpStatus: number, body: unknown): RelayAnswer {
  const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (httpStatus >= 200 && httpStatus < 300 && typeof data.hostname === 'string') {
    const seq = integer(data.seq);
    return {
      state: 'known',
      status: typeof data.status === 'string' ? data.status : null,
      accountCount: integer(data.accountCount),
      // The reference relay stores -1 until it has persisted a cursor.
      seq: seq !== null && seq >= 0 ? seq : null,
    };
  }
  if (data.error === 'HostNotFound') return { state: 'unknown' };
  const named = typeof data.error === 'string' ? data.error : null;
  return { state: 'error', message: named ? `${named} (HTTP ${httpStatus})` : `HTTP ${httpStatus}` };
}

export type StatusReading = {
  /** How the row is marked: fine, worth a look, or broken. */
  tone: 'pass' | 'warn' | 'fail';
  label: string;
  /** What the status means for the host, in a sentence. */
  meaning: string;
  /** Whether asking to be crawled again is the way out. */
  recrawl: boolean;
};

/**
 * A host status in words. The five values are the lexicon's
 * (`com.atproto.sync.defs#hostStatus`); what each means is how the reference
 * relay uses it. `idle` and `offline` are both left by a dropped connection
 * and both end when the host asks to be crawled again; `banned` does not.
 */
export function readStatus(status: string | null): StatusReading {
  switch (status) {
    case 'active':
      return {
        tone: 'pass',
        label: 'Active',
        meaning: 'Connected to this host and reading its events.',
        recrawl: false,
      };
    case 'idle':
      return {
        tone: 'warn',
        label: 'Idle',
        meaning: 'Knows this host, but dropped its connection and is not reading from it. A new crawl request starts it again.',
        recrawl: true,
      };
    case 'offline':
      return {
        tone: 'fail',
        label: 'Offline',
        meaning: 'Could not connect to this host after repeated tries and has stopped trying. A new crawl request starts it again.',
        recrawl: true,
      };
    case 'throttled':
      return {
        tone: 'warn',
        label: 'Throttled',
        meaning: 'Reading from this host, but limiting how much it takes.',
        recrawl: false,
      };
    case 'banned':
      return {
        tone: 'fail',
        label: 'Banned',
        meaning: 'Refuses this host. A crawl request will not change that. Only the relay’s operator can lift it.',
        recrawl: false,
      };
    case null:
      return {
        tone: 'warn',
        label: 'Known',
        meaning: 'Has a record of this host, but reported no status for it.',
        recrawl: false,
      };
    default:
      return {
        tone: 'warn',
        label: status,
        meaning: 'Reported a status this page does not know.',
        recrawl: false,
      };
  }
}

/* -------------------------------------------------------------------------- *
 * The verdict
 * -------------------------------------------------------------------------- */

/** One relay and its answer. `answer` is undefined while it is still on its way. */
export type RelayResult = { relay: Relay; answer?: RelayAnswer };

/** What the host says for itself. Undefined while it is being asked. */
export type PdsProbe = {
  /** `describeServer` answered, so something is serving XRPC as a PDS. */
  reachable: boolean;
  did?: string;
  version?: string;
};

export type RelayVerdict = {
  tone: 'pass' | 'warn' | 'fail' | 'pending';
  title: string;
  text: string;
  /** Whether the page should explain how to ask for a crawl. */
  explainCrawl: boolean;
};

export function relayVerdict(host: string, results: RelayResult[], pds: PdsProbe | undefined): RelayVerdict {
  if (results.some((r) => r.answer === undefined)) {
    return {
      tone: 'pending',
      title: `Asking ${results.length} relays about ${host}`,
      text: 'Each one is asked what it knows about this host.',
      explainCrawl: false,
    };
  }
  const answered = results.filter((r) => r.answer && r.answer.state !== 'error');
  const known = answered.filter((r) => r.answer?.state === 'known');
  const active = known.filter((r) => r.answer?.state === 'known' && r.answer.status === 'active');
  const stalled = known.filter((r) => r.answer?.state === 'known' && readStatus(r.answer.status).recrawl);
  const banned = known.some((r) => r.answer?.state === 'known' && r.answer.status === 'banned');
  const silent = results.length - answered.length;
  const tail = silent > 0 ? ` ${silent === 1 ? 'One relay' : `${silent} relays`} did not answer.` : '';

  if (answered.length === 0) {
    return {
      tone: 'warn',
      title: 'None of the relays answered',
      text: 'That says nothing about the host. Try again in a moment.',
      explainCrawl: false,
    };
  }
  if (known.length === 0) {
    return {
      tone: 'fail',
      title: `No relay knows ${host}`,
      text:
        (pds?.reachable === false
          ? 'It does not answer as a PDS either, so check the hostname first.'
          : 'The PDS answers, but no relay has been asked to crawl it, so nothing it writes reaches the network.') + tail,
      explainCrawl: pds?.reachable !== false,
    };
  }
  if (active.length === answered.length) {
    return {
      tone: 'pass',
      title: `${host} is being crawled by ${answered.length === 1 ? 'the relay that answered' : `all ${answered.length} relays`}`,
      text: `Each one is connected and reading its events.${tail}`,
      explainCrawl: false,
    };
  }
  if (active.length > 0) {
    return {
      tone: 'warn',
      title: `${host} is being crawled by ${active.length} of ${answered.length} relays`,
      text: `Apps that read from the others will not see what it writes.${tail}`,
      explainCrawl: stalled.length > 0 || known.length < answered.length,
    };
  }
  return {
    tone: 'fail',
    title: `Relays know ${host}, but none is reading it`,
    text:
      (banned && stalled.length === 0
        ? 'It has been refused, which only a relay’s operator can undo.'
        : pds?.reachable === false
          ? 'It does not answer as a PDS right now, which is the likely reason.'
          : 'Their connections to it dropped. Asking to be crawled again reconnects them.') + tail,
    explainCrawl: stalled.length > 0 && pds?.reachable !== false,
  };
}

/** The request a host sends to be crawled, as a command to run by hand. */
export function requestCrawlCommand(relayHost: string, host: string): string {
  return [
    `curl -X POST https://${relayHost}/xrpc/com.atproto.sync.requestCrawl \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"hostname":"${host}"}'`,
  ].join('\n');
}

const NUMBER = new Intl.NumberFormat('en-US');

export function formatCount(value: number): string {
  return NUMBER.format(value);
}

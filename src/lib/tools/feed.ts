/**
 * The feed inspector's logic: what a custom feed is made of, and how to read
 * the evidence for each part.
 *
 * A feed is two things that have to agree. A record
 * (`app.bsky.feed.generator`, in anybody's repository) gives it a name and
 * names the service that computes it, by DID. That service's DID document
 * then says where it lives, in a `#bsky_fg` service entry, and the service
 * answers `app.bsky.feed.getFeedSkeleton` with nothing but a list of post
 * URIs: the skeleton. The AppView fetches the skeleton and fills in the
 * posts, which is all an app ever shows.
 *
 * Everything here is pure: it takes what was observed and says what it
 * means. The observing is split by who can do it. The generator is an
 * arbitrary host, and most generators send no CORS headers (two of eight
 * popular ones did when this was written), so the record, the service's DID
 * document and the generator's two answers are read on the server
 * (src/app/api/tools/feed). The AppView answers a browser directly, so the
 * page asks it itself.
 */

import { matchSupportedUrl } from '@/utils/reverseParsers';

export const FEED_COLLECTION = 'app.bsky.feed.generator';

/** Posts asked for in one skeleton page. One AppView getPosts call hydrates this many. */
export const FEED_PAGE_SIZE = 25;

export type FeedTarget =
  | { ok: true; authority: string; rkey: string }
  | { ok: false; reason: string };

/**
 * Record keys allow a wider alphabet than this tool needs to refuse, so this
 * only rules out what could not be one: empty, too long, `.` and `..`, or a
 * character outside the record key set.
 */
function isRecordKey(value: string): boolean {
  return /^[A-Za-z0-9._:~-]{1,512}$/.test(value) && value !== '.' && value !== '..';
}

function isAuthority(value: string): boolean {
  return /^did:(plc:[a-z2-7]{24}|web:[A-Za-z0-9.%-]+)$/.test(value) || /^([a-z0-9-]+\.)+[a-z0-9-]+$/i.test(value);
}

function target(authority: string, rkey: string): FeedTarget {
  const clean = authority.replace(/^@/, '');
  if (!isAuthority(clean)) return { ok: false, reason: `"${authority}" is not a handle or a DID.` };
  if (!isRecordKey(rkey)) return { ok: false, reason: `"${rkey}" is not a valid record key.` };
  return { ok: true, authority: clean.startsWith('did:') ? clean : clean.toLowerCase(), rkey };
}

/**
 * Read what was pasted as a feed's address: an at:// URI of a feed generator
 * record, or a link to the feed in any client that uses Bluesky's
 * `/profile/<actor>/feed/<rkey>` path.
 */
export function parseFeedInput(raw: string): FeedTarget {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter a feed link or at:// URI.' };

  if (/^at:\/\//i.test(value)) {
    const [authority, collection, rkey] = value.slice('at://'.length).split(/[/?#]/);
    if (!authority || !collection || !rkey) {
      return { ok: false, reason: `A feed's URI has three parts: at://<account>/${FEED_COLLECTION}/<key>.` };
    }
    if (collection !== FEED_COLLECTION) {
      return { ok: false, reason: `That is a ${collection} record. A feed is an ${FEED_COLLECTION} record.` };
    }
    return target(authority, rkey);
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, reason: 'That could not be read as a link or an at:// URI.' };
  }

  // Bluesky's own path shape, on whichever client's host.
  const parts = url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  if (parts[0] === 'profile' && parts[2] === 'feed' && parts[1] && parts[3]) {
    return target(parts[1], parts[3]);
  }

  // Links this site and the other explorers make, which spell the collection out.
  const match = matchSupportedUrl(url)?.parsed;
  if (match?.collection === FEED_COLLECTION && match.rkey) return target(match.handle, match.rkey);
  if (parts[0] === 'profile' && parts[2] === 'post') {
    return { ok: false, reason: 'That is a post, not a feed. The post inspector reads posts.' };
  }
  if (parts[0] === 'profile' && parts[2] === 'lists') {
    return { ok: false, reason: 'That is a list, not a feed.' };
  }
  return {
    ok: false,
    reason: 'That link does not point at a feed. A feed link looks like bsky.app/profile/<account>/feed/<key>.',
  };
}

export function feedUri(did: string, rkey: string): string {
  return `at://${did}/${FEED_COLLECTION}/${rkey}`;
}

/* -------------------------------------------------------------------------- *
 * What the server route reports
 * -------------------------------------------------------------------------- */

export type FeedRecordProbe =
  | { status: 'found'; cid: string; value: Record<string, unknown> }
  /** The repository answered, and has no record at this address. */
  | { status: 'missing' }
  | { status: 'error'; error: string };

export type FeedServiceProbe = {
  /** The `did` field of the record: the service that computes the feed. */
  did: string;
  /** `unsupported`: not a did:web on a plain host or a did:plc, so it was not fetched. */
  status: 'resolved' | 'error' | 'unsupported';
  /** Every service the document lists, so a wrong id or type can be seen. */
  services: { id: string; type?: string; serviceEndpoint?: string }[];
  /** The `#bsky_fg` endpoint, when the document has one. */
  endpoint: string | null;
  error?: string;
};

/** One request to the generator: whether it answered, and with what. */
type GeneratorAnswer = {
  url: string;
  status: 'answered' | 'error';
  httpStatus?: number;
  /** The XRPC error name and message, when it answered with one. */
  xrpcError?: string;
  message?: string;
  /** It answered 200 with something that is not the JSON the lexicon describes. */
  unreadable?: boolean;
  /** Why there was no answer at all. */
  error?: string;
};

export type FeedDescribeProbe = GeneratorAnswer & {
  /** The DID the generator says it is. */
  did?: string;
  /** How many feeds it says it serves. */
  feedCount?: number;
  /** Whether this feed is among them. */
  listsFeed?: boolean;
};

export type SkeletonItem = {
  post: string;
  /** Why the post is here when it is not the author's own: a repost, a pin. */
  reason?: { type: string; repost?: string };
  /** Opaque context the generator wants back with interactions. */
  feedContext?: string;
};

export type FeedSkeletonProbe = GeneratorAnswer & {
  items?: SkeletonItem[];
  cursor?: string;
  reqId?: string;
};

export type FeedProbe = {
  feed: string;
  record: FeedRecordProbe;
  service?: FeedServiceProbe;
  describe?: FeedDescribeProbe;
  skeleton?: FeedSkeletonProbe;
};

/* -------------------------------------------------------------------------- *
 * The check list
 * -------------------------------------------------------------------------- */

export type FeedCheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'skip' | 'pending';

export type FeedCheck = {
  id: 'record' | 'service' | 'describe' | 'skeleton' | 'appview';
  status: FeedCheckStatus;
  title: string;
  summary: string;
  /** Evidence, one line each. */
  detail?: string[];
  /** What to change, one paragraph each. */
  fix?: string[];
};

/** The AppView's own account of the feed (app.bsky.feed.getFeedGenerator). */
export type FeedAppView = {
  displayName?: string;
  likeCount?: number;
  isOnline?: boolean;
  isValid?: boolean;
  error?: string;
};

/**
 * What has been observed so far. A field left undefined is still on its way;
 * `null` means the lookup was made and failed.
 */
export type FeedEvidence = {
  /** What was asked for, as typed. */
  authority: string;
  rkey: string;
  /** The account the feed belongs to. Null when a handle would not resolve. */
  did?: string | null;
  probe?: FeedProbe | null;
  probeError?: string;
  appview?: FeedAppView | null;
};

export type FeedVerdict = {
  tone: 'pass' | 'warn' | 'fail' | 'info' | 'pending';
  title: string;
  text: string;
};

const TITLES: Record<FeedCheck['id'], string> = {
  record: 'Feed record',
  service: 'Service identity',
  describe: 'Generator description',
  skeleton: 'Feed skeleton',
  appview: 'Bluesky AppView',
};

const pending = (id: FeedCheck['id']): FeedCheck => ({ id, status: 'pending', title: TITLES[id], summary: 'Checking…' });
const skipped = (id: FeedCheck['id'], why: string): FeedCheck => ({ id, status: 'skip', title: TITLES[id], summary: why });

function host(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** True when a generator turned the request away for want of a signed-in viewer. */
export function needsViewer(answer: { httpStatus?: number; xrpcError?: string } | undefined): boolean {
  if (!answer) return false;
  return answer.httpStatus === 401 || answer.httpStatus === 403 || /auth/i.test(answer.xrpcError ?? '');
}

function answerLine(answer: GeneratorAnswer): string {
  if (answer.status === 'error') return `→ ${answer.error ?? 'no answer'}`;
  const named = answer.xrpcError ? `, ${answer.xrpcError}` : '';
  const said = answer.message ? `: ${answer.message}` : '';
  return `→ HTTP ${answer.httpStatus}${named}${said}`;
}

function recordCheck(feed: string, record: FeedRecordProbe): FeedCheck {
  const id = 'record';
  const title = TITLES[id];
  if (record.status === 'missing') {
    return {
      id,
      status: 'fail',
      title,
      summary: 'The repository answered, and it has no feed generator record at this address.',
      detail: [feed],
      fix: ['Check the link. A feed that was deleted leaves its old links behind.'],
    };
  }
  if (record.status === 'error') {
    return { id, status: 'fail', title, summary: `The record could not be read: ${record.error}.`, detail: [feed] };
  }
  const { value } = record;
  const service = typeof value.did === 'string' ? value.did : null;
  if (!service) {
    return {
      id,
      status: 'fail',
      title,
      summary: 'The record has no did field, so it names no service to compute the feed.',
      detail: [feed],
      fix: ['Publish the record again with did set to the feed generator service’s DID.'],
    };
  }
  const missing = ['displayName', 'createdAt'].filter((key) => typeof value[key] !== 'string');
  const wrongType = value.$type !== FEED_COLLECTION;
  return {
    id,
    status: missing.length || wrongType ? 'warn' : 'pass',
    title,
    summary: wrongType
      ? `The record exists, but its $type is ${String(value.$type)} rather than ${FEED_COLLECTION}.`
      : missing.length
        ? `The record exists and names ${service}, but it is missing ${missing.join(' and ')}, which the lexicon requires.`
        : `The record exists and names ${service} as the service that computes the feed.`,
    detail: [feed, `cid ${record.cid}`],
  };
}

function serviceCheck(service: FeedServiceProbe): FeedCheck {
  const id = 'service';
  const title = TITLES[id];
  const listed = service.services.map((s) => `${s.id}${s.type ? ` (${s.type})` : ''} → ${s.serviceEndpoint ?? 'no endpoint'}`);
  if (service.status === 'unsupported') {
    return {
      id,
      status: 'fail',
      title,
      summary: `${service.did} is not a did:web on a plain hostname or a did:plc, so it cannot be resolved.`,
      fix: ['A feed generator is usually a did:web, such as did:web:feeds.example.com.'],
    };
  }
  if (service.status === 'error') {
    return {
      id,
      status: 'fail',
      title,
      summary: `${service.did} could not be resolved: ${service.error ?? 'no answer'}.`,
      fix: [
        service.did.startsWith('did:web:')
          ? `A did:web document is served from https://${service.did.slice('did:web:'.length)}/.well-known/did.json. Check that it is reachable.`
          : 'Check the DID in the record is spelled exactly as the PLC directory has it.',
      ],
    };
  }
  if (!service.endpoint) {
    return {
      id,
      status: 'fail',
      title,
      summary: `${service.did} resolves, but its DID document has no #bsky_fg service, so nothing says where the generator is.`,
      detail: listed.length ? listed : ['service: none'],
      fix: ['Add a service with the id #bsky_fg and the type BskyFeedGenerator, whose serviceEndpoint is the generator’s https address.'],
    };
  }
  const entry = service.services.find((s) => s.id.endsWith('#bsky_fg'));
  const typed = entry?.type === 'BskyFeedGenerator';
  return {
    id,
    status: typed ? 'pass' : 'warn',
    title,
    summary: typed
      ? `${service.did} resolves, and its #bsky_fg service is ${host(service.endpoint)}.`
      : `${service.did} resolves and has a #bsky_fg service, but its type is ${entry?.type ?? 'missing'} rather than BskyFeedGenerator.`,
    detail: listed,
  };
}

function describeCheck(feed: string, describe: FeedDescribeProbe, service: FeedServiceProbe): FeedCheck {
  const id = 'describe';
  const title = TITLES[id];
  const detail = [`GET ${describe.url}`, answerLine(describe)];
  if (describe.status === 'error') {
    return { id, status: 'warn', title, summary: `The generator did not answer: ${describe.error ?? 'no answer'}.`, detail };
  }
  if (describe.httpStatus !== 200) {
    return {
      id,
      status: 'info',
      title,
      summary: `The generator does not answer describeFeedGenerator (HTTP ${describe.httpStatus}). Many do not, and a feed works without it.`,
      detail,
    };
  }
  if (describe.unreadable) {
    return {
      id,
      status: 'info',
      title,
      summary: 'The generator answered, but with more than this tool reads or with something other than a feed list.',
      detail,
    };
  }
  const count = describe.feedCount ?? 0;
  const feeds = `${count.toLocaleString('en-US')} ${count === 1 ? 'feed' : 'feeds'}`;
  if (describe.did && describe.did !== service.did) {
    return {
      id,
      status: 'warn',
      title,
      summary: `The generator says it is ${describe.did}, but the record names ${service.did}.`,
      detail,
    };
  }
  return {
    id,
    status: describe.listsFeed ? 'pass' : 'warn',
    title,
    summary: describe.listsFeed
      ? `The generator lists this feed among the ${feeds} it serves.`
      : `The generator answers and lists ${feeds}, but this one is not among them.`,
    detail: describe.listsFeed ? detail : [...detail, `looked for ${feed}`],
  };
}

function skeletonCheck(skeleton: FeedSkeletonProbe): FeedCheck {
  const id = 'skeleton';
  const title = TITLES[id];
  const detail = [`GET ${skeleton.url}`, answerLine(skeleton)];
  if (skeleton.status === 'error') {
    return {
      id,
      status: 'fail',
      title,
      summary: `The generator did not answer: ${skeleton.error ?? 'no answer'}.`,
      detail,
      fix: ['Check the service is running and reachable over https at the address in its DID document.'],
    };
  }
  if (needsViewer(skeleton)) {
    return {
      id,
      status: 'info',
      title,
      summary: 'The generator only answers a signed-in viewer, so the feed is personalised. This tool asks without one, and gets no skeleton.',
      detail,
    };
  }
  if (skeleton.httpStatus !== 200) {
    return {
      id,
      status: 'fail',
      title,
      summary:
        skeleton.xrpcError === 'UnknownFeed'
          ? 'The generator answers, but says it does not know this feed.'
          : `The generator answered with HTTP ${skeleton.httpStatus} rather than a skeleton.`,
      detail,
      fix:
        skeleton.xrpcError === 'UnknownFeed'
          ? ['The record points at a service that does not serve it. Check the did in the record, and the feed’s key on the service.']
          : undefined,
    };
  }
  if (skeleton.unreadable || !skeleton.items) {
    return {
      id,
      status: 'fail',
      title,
      summary: 'The generator answered 200, but not with a feed skeleton: there is no feed array in it.',
      detail,
    };
  }
  const count = skeleton.items.length;
  if (count === 0) {
    return {
      id,
      status: 'warn',
      title,
      summary: 'The generator answered with an empty feed. That can be right for a quiet feed, or one that needs a viewer to have anything to show.',
      detail,
    };
  }
  return {
    id,
    status: 'pass',
    title,
    summary: `The generator returned ${count} ${count === 1 ? 'post' : 'posts'}${skeleton.cursor ? ' and a cursor for more' : ''}.`,
    detail,
  };
}

function appviewCheck(appview: FeedAppView | null): FeedCheck {
  const id = 'appview';
  const title = TITLES[id];
  if (appview === null || appview.error) {
    return {
      id,
      status: 'warn',
      title,
      summary: `Bluesky's AppView has no view of this feed${appview?.error ? ` (${appview.error})` : ''}, so Bluesky apps cannot open it.`,
    };
  }
  const likes =
    typeof appview.likeCount === 'number'
      ? ` It has ${appview.likeCount.toLocaleString('en-US')} ${appview.likeCount === 1 ? 'like' : 'likes'}.`
      : '';
  if (appview.isOnline === false || appview.isValid === false) {
    return {
      id,
      status: 'warn',
      title,
      summary: `Bluesky's AppView has indexed the feed, but reports it as ${[
        appview.isOnline === false ? 'offline' : null,
        appview.isValid === false ? 'not valid' : null,
      ]
        .filter(Boolean)
        .join(' and ')}.${likes}`,
      detail: [`isOnline ${String(appview.isOnline)}`, `isValid ${String(appview.isValid)}`],
    };
  }
  return {
    id,
    status: 'pass',
    title,
    summary: `Bluesky's AppView has indexed the feed, and reports it online and valid.${likes}`,
    detail: [`isOnline ${String(appview.isOnline)}`, `isValid ${String(appview.isValid)}`],
  };
}

/** Build the check list from whatever has been observed so far. */
export function buildFeedChecks(evidence: FeedEvidence): FeedCheck[] {
  const { probe, appview } = evidence;
  const appviewRow = appview === undefined ? pending('appview') : appviewCheck(appview);

  if (evidence.did === null) {
    const why = `Not checked, because ${evidence.authority} did not resolve to an account.`;
    return [
      { id: 'record', status: 'fail', title: TITLES.record, summary: `${evidence.authority} did not resolve to an account, so there is no repository to read.` },
      skipped('service', why),
      skipped('describe', why),
      skipped('skeleton', why),
      skipped('appview', why),
    ];
  }
  if (probe === undefined) {
    return [pending('record'), pending('service'), pending('describe'), pending('skeleton'), appviewRow];
  }
  if (probe === null) {
    const why = evidence.probeError ?? 'The lookup could not be made.';
    return [
      { id: 'record', status: 'fail', title: TITLES.record, summary: why },
      skipped('service', 'Not checked, because the record could not be read.'),
      skipped('describe', 'Not checked, because the record could not be read.'),
      skipped('skeleton', 'Not checked, because the record could not be read.'),
      appviewRow,
    ];
  }

  const checks: FeedCheck[] = [recordCheck(probe.feed, probe.record)];
  if (!probe.service) {
    const why =
      probe.record.status === 'found'
        ? 'Not checked, because the record names no service.'
        : 'Not checked, because there is no record to read.';
    return [...checks, skipped('service', why), skipped('describe', why), skipped('skeleton', why), appviewRow];
  }
  checks.push(serviceCheck(probe.service));
  if (!probe.service.endpoint || !probe.describe || !probe.skeleton) {
    const why = 'Not checked, because the service has no address to ask.';
    return [...checks, skipped('describe', why), skipped('skeleton', why), appviewRow];
  }
  checks.push(describeCheck(probe.feed, probe.describe, probe.service), skeletonCheck(probe.skeleton), appviewRow);
  return checks;
}

/** The one-line answer above the list. */
export function feedVerdict(evidence: FeedEvidence, checks: FeedCheck[], name: string): FeedVerdict {
  const by = (id: FeedCheck['id']) => checks.find((check) => check.id === id);
  if (checks.some((check) => check.status === 'pending')) {
    return { tone: 'pending', title: `Checking ${name}`, text: 'Reading the record and asking its generator.' };
  }
  const failed = checks.find((check) => check.status === 'fail');
  if (failed) {
    const title =
      failed.id === 'record'
        ? `${name} has no readable feed record`
        : failed.id === 'service'
          ? `${name} names a service that cannot be found`
          : `${name} is not answering`;
    return { tone: 'fail', title, text: failed.summary };
  }
  const skeleton = by('skeleton');
  if (needsViewer(evidence.probe?.skeleton)) {
    return {
      tone: 'info',
      title: `${name} answers only for a signed-in viewer`,
      text: 'Its record and service check out. The generator personalises the feed, so it returns nothing to an anonymous request.',
    };
  }
  const warnings = checks.filter((check) => check.status === 'warn');
  if (warnings.length > 0) {
    return {
      tone: 'warn',
      title: `${name} answers, with ${warnings.length === 1 ? 'one thing' : `${warnings.length} things`} to look at`,
      text: warnings[0].summary,
    };
  }
  const endpoint = evidence.probe?.service?.endpoint;
  return {
    tone: 'pass',
    title: `${name} is answering`,
    text: `${skeleton?.summary ?? 'The generator returned a skeleton.'}${endpoint ? ` It is served from ${host(endpoint)}.` : ''}`,
  };
}

/** `app.bsky.feed.defs#skeletonReasonRepost` → "Repost". */
export function reasonLabel(type: string): string {
  const name = type.split('#').pop() ?? type;
  const word = name.replace(/^skeletonReason/, '');
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : 'Reason';
}

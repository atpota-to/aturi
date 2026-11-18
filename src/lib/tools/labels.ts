/**
 * The label checker's logic: what was asked about, which labelers to ask,
 * and how to read what comes back.
 *
 * A label is a signed statement by a labeler about an account or a record:
 * `{ src, uri, val }`, "this DID says this thing is `val`". Labelers are
 * independent, and an app only shows labels from the ones its user
 * subscribes to, so "what labels are on this?" has no single answer. The
 * checker asks Bluesky's AppView on behalf of every labeler in turn.
 *
 * The AppView attaches labels to the profiles and posts it returns, limited
 * to the labelers named in the request's `atproto-accept-labelers` header.
 * Three things about that header were checked against the live service and
 * are encoded here rather than left to call sites:
 *
 *   - Only `api.bsky.app` reads it. `public.api.bsky.app` is the cached
 *     front of the same service and answers every request as if the header
 *     named Bluesky's own labeler and nothing else.
 *   - One malformed entry makes the AppView ignore the whole header and fall
 *     back to that default, so entries are validated before they are sent.
 *   - Naming labelers replaces the default rather than adding to it, so
 *     Bluesky's own labeler has to be listed like any other.
 *
 * A labeler the AppView has never indexed is dropped without a word, and the
 * response header that says which ones were honoured is not readable across
 * origins, so "no labels" from an obscure labeler can also mean "not asked".
 *
 * Everything here is pure. The requests are in labelsClient.ts.
 */

import { parseAccountToken } from '@/lib/streamMonitor';
import { matchSupportedUrl } from '@/utils/reverseParsers';
import { isValidDid } from '@/utils/atproto/spaceUri';
import { parseAtUri } from '@/utils/atproto/urls';

/**
 * Bluesky's own moderation service, moderation.bsky.app. The one labeler
 * every Bluesky user is subscribed to and cannot turn off, so it is always
 * checked first.
 */
export const BLUESKY_MODERATION_DID = 'did:plc:ar7c4by46qjdydhdevvrndac';

/** The AppView host that honours `atproto-accept-labelers` (see above). */
export const LABEL_APPVIEW = 'https://api.bsky.app';

/** The record a labeler declares itself with, at rkey `self`. */
export const LABELER_COLLECTION = 'app.bsky.labeler.service';

/**
 * Labelers named per request. The AppView accepted three times this when
 * tried, but twenty is the most the official client ever sends, and staying
 * inside what the service sees every day is the polite place to be.
 */
export const LABELERS_PER_REQUEST = 20;

/** Requests in flight at once during a scan of every labeler. */
export const SCAN_CONCURRENCY = 3;

/** Labelers a person may add by hand, on top of Bluesky's. */
export const MAX_ADDED_LABELERS = 20;

const POST_COLLECTION = 'app.bsky.feed.post';
const PROFILE_COLLECTION = 'app.bsky.actor.profile';

/* -------------------------------------------------------------------------- *
 * What was asked about
 * -------------------------------------------------------------------------- */

/** An account or a post, with the account still as typed (a handle or a DID). */
export type LabelTarget =
  | { kind: 'account'; actor: string }
  | { kind: 'post'; actor: string; rkey: string };

export type LabelInput = { ok: true; target: LabelTarget } | { ok: false; reason: string };

/** The reason given for a record that is neither an account nor a post. */
export const NOT_LABELLED =
  'Apps show labels on accounts and posts. Enter a handle, a DID, or a link to a post.';

function targetFrom(actor: string, collection?: string, rkey?: string): LabelInput {
  const token = parseAccountToken(actor);
  if (!token) return { ok: false, reason: `“${actor}” is not a handle or a DID.` };
  const account = token.kind === 'did' ? token.did : token.handle;
  if (!collection || collection === PROFILE_COLLECTION) {
    return { ok: true, target: { kind: 'account', actor: account } };
  }
  if (collection === POST_COLLECTION && rkey) {
    return { ok: true, target: { kind: 'post', actor: account, rkey } };
  }
  return { ok: false, reason: NOT_LABELLED };
}

/**
 * Read a handle, a DID, an at:// URI, or a profile or post link from any
 * client the link resolver knows (bsky.app and the rest of that family).
 */
export function parseSubjectInput(raw: string): LabelInput {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter a handle, a DID, or a link to a post.' };

  if (/^at:\/\//i.test(value)) {
    const parsed = parseAtUri(value);
    if (!parsed || parsed.space) return { ok: false, reason: 'That at:// URI could not be read.' };
    return targetFrom(parsed.repo, parsed.collection, parsed.rkey);
  }

  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return { ok: false, reason: 'That link could not be read.' };
    }
    const match = matchSupportedUrl(url);
    if (!match) {
      return { ok: false, reason: 'That link is not a profile or a post this tool recognises. Paste the handle instead.' };
    }
    return targetFrom(match.parsed.handle, match.parsed.collection, match.parsed.rkey);
  }

  return targetFrom(value);
}

/** A stable string for a target, to key a run on. */
export function targetKey(target: LabelTarget): string {
  return target.kind === 'post' ? `post:${target.actor}/${target.rkey}` : `account:${target.actor}`;
}

/** The target once its account is resolved: what the AppView is asked about. */
export type LabelSubject =
  | { kind: 'account'; did: string }
  | { kind: 'post'; did: string; uri: string };

export function subjectFor(target: LabelTarget, did: string): LabelSubject {
  return target.kind === 'post'
    ? { kind: 'post', did, uri: `at://${did}/${POST_COLLECTION}/${target.rkey}` }
    : { kind: 'account', did };
}

/* -------------------------------------------------------------------------- *
 * Which labelers to ask
 * -------------------------------------------------------------------------- */

/** The labelers a person added, as the `labelers` query parameter holds them. */
export function parseLabelersParam(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const token = parseAccountToken(part);
    if (!token) continue;
    const value = token.kind === 'did' ? token.did : token.handle;
    if (!out.includes(value)) out.push(value);
    if (out.length >= MAX_ADDED_LABELERS) break;
  }
  return out;
}

/** Valid DIDs only, each once, in the order given. */
export function cleanLabelerDids(dids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const did of dids) {
    if (!isValidDid(did) || seen.has(did)) continue;
    seen.add(did);
    out.push(did);
  }
  return out;
}

/** The value of `atproto-accept-labelers` for a batch. */
export function labelersHeader(dids: readonly string[]): string {
  return cleanLabelerDids(dids).join(', ');
}

/** Split labelers into the batches one request each can carry. */
export function batchLabelers(dids: readonly string[], size: number = LABELERS_PER_REQUEST): string[][] {
  const clean = cleanLabelerDids(dids);
  const batches: string[][] = [];
  for (let i = 0; i < clean.length; i += size) batches.push(clean.slice(i, i + size));
  return batches;
}

/* -------------------------------------------------------------------------- *
 * Reading labels
 * -------------------------------------------------------------------------- */

export type Label = {
  /** The DID that applied it. The subject's own DID for a self-label. */
  src: string;
  /** What it is on: a DID for an account, an at:// URI for a record. */
  uri: string;
  cid?: string;
  val: string;
  /** When it was created. */
  cts?: string;
  /** When it stops applying. */
  exp?: string;
  /** True for a negation, which withdraws an earlier label of the same value. */
  neg?: boolean;
  ver?: number;
};

/** Keep what reads as a label; an upstream answer is not trusted to be one. */
export function readLabels(raw: unknown): Label[] {
  if (!Array.isArray(raw)) return [];
  const out: Label[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { src, uri, val, cid, cts, exp, neg, ver } = entry as Record<string, unknown>;
    if (typeof src !== 'string' || typeof uri !== 'string' || typeof val !== 'string') continue;
    out.push({
      src,
      uri,
      val,
      cid: typeof cid === 'string' ? cid : undefined,
      cts: typeof cts === 'string' ? cts : undefined,
      exp: typeof exp === 'string' ? exp : undefined,
      neg: neg === true ? true : undefined,
      ver: typeof ver === 'number' ? ver : undefined,
    });
  }
  return out;
}

const labelKey = (label: Label) => `${label.src}\n${label.uri}\n${label.val}`;

/**
 * Fold batches of labels into one list. The same label can arrive twice
 * (the first check and a later scan both ask Bluesky's labeler), and a label
 * is identified by who said what about which thing, so the newer statement
 * replaces the older one.
 */
export function mergeLabels(existing: readonly Label[], incoming: readonly Label[]): Label[] {
  const byKey = new Map<string, Label>();
  for (const label of [...existing, ...incoming]) {
    const key = labelKey(label);
    const held = byKey.get(key);
    if (!held || (label.cts ?? '') >= (held.cts ?? '')) byKey.set(key, label);
  }
  return [...byKey.values()];
}

export function isExpired(label: Label, now: number): boolean {
  if (!label.exp) return false;
  const at = Date.parse(label.exp);
  return Number.isFinite(at) && at <= now;
}

/** What a label is attached to, in words. */
export function labelScope(label: Label): 'account' | 'profile' | 'post' | 'record' {
  if (label.uri.startsWith('did:')) return 'account';
  const collection = parseAtUri(label.uri)?.collection;
  if (collection === PROFILE_COLLECTION) return 'profile';
  if (collection === POST_COLLECTION) return 'post';
  return 'record';
}

export type LabelGroup = {
  /** The labeler's DID. */
  src: string;
  /** The subject labelled itself. */
  self: boolean;
  labels: Label[];
};

/**
 * Labels by who applied them: the subject's own first, then Bluesky's
 * labeler, then the rest with the most labels first. Within a group, newest
 * first.
 */
export function groupLabels(labels: readonly Label[], subjectDid: string): LabelGroup[] {
  const bySrc = new Map<string, Label[]>();
  for (const label of labels) {
    const list = bySrc.get(label.src);
    if (list) list.push(label);
    else bySrc.set(label.src, [label]);
  }
  const rank = (src: string) => (src === subjectDid ? 0 : src === BLUESKY_MODERATION_DID ? 1 : 2);
  return [...bySrc.entries()]
    .map(([src, list]) => ({
      src,
      self: src === subjectDid,
      labels: [...list].sort((a, b) => (b.cts ?? '').localeCompare(a.cts ?? '')),
    }))
    .sort(
      (a, b) =>
        rank(a.src) - rank(b.src) || b.labels.length - a.labels.length || a.src.localeCompare(b.src),
    );
}

/* -------------------------------------------------------------------------- *
 * What a label means
 * -------------------------------------------------------------------------- */

export type LabelLocale = { lang: string; name: string; description: string };

/** A labeler's definition of one of its values (`labelValueDefinition`). */
export type LabelDefinition = {
  identifier: string;
  /** How loudly a client should show it: `alert`, `inform` or `none`. */
  severity?: string;
  /** What it hides: `content`, `media` or `none`. */
  blurs?: string;
  /** What a subscriber gets before changing anything: `hide`, `warn` or `ignore`. */
  defaultSetting?: string;
  adultOnly?: boolean;
  locales: LabelLocale[];
};

/** Read `policies.labelValueDefinitions` from a labeler's service view. */
export function readDefinitions(raw: unknown): LabelDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: LabelDefinition[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const def = entry as Record<string, unknown>;
    if (typeof def.identifier !== 'string') continue;
    const locales: LabelLocale[] = [];
    if (Array.isArray(def.locales)) {
      for (const locale of def.locales) {
        if (!locale || typeof locale !== 'object') continue;
        const { lang, name, description } = locale as Record<string, unknown>;
        if (typeof lang !== 'string' || typeof name !== 'string') continue;
        locales.push({ lang, name, description: typeof description === 'string' ? description : '' });
      }
    }
    out.push({
      identifier: def.identifier,
      severity: typeof def.severity === 'string' ? def.severity : undefined,
      blurs: typeof def.blurs === 'string' ? def.blurs : undefined,
      defaultSetting: typeof def.defaultSetting === 'string' ? def.defaultSetting : undefined,
      adultOnly: def.adultOnly === true,
      locales,
    });
  }
  return out;
}

/**
 * The label values the protocol itself defines, with what the labels guide
 * says each does (atproto.com/guides/labels, "Global label values"). They
 * need no definition from a labeler, and they are the only values an account
 * may put on its own content.
 */
export const GLOBAL_LABELS: Record<string, { name: string; description: string }> = {
  '!hide': {
    name: 'Hide',
    description: 'Puts a warning on the content that cannot be clicked through, and filters it from listings. A subscriber cannot turn this off.',
  },
  '!warn': {
    name: 'Warn',
    description: 'Puts a warning on the content that can be clicked through. A subscriber cannot turn this off.',
  },
  '!no-unauthenticated': {
    name: 'Signed-in users only',
    description: 'Asks apps not to show the content to people who are not signed in.',
  },
  porn: {
    name: 'Adult content',
    description: 'Puts a warning on images, which can only be clicked through by adults who have enabled adult content.',
  },
  sexual: {
    name: 'Sexually suggestive',
    description: 'Handled like adult content, and meant for less explicit material.',
  },
  'graphic-media': {
    name: 'Graphic media',
    description: 'Handled like adult content, and meant for violence and gore.',
  },
  nudity: {
    name: 'Nudity',
    description: 'Puts a warning on images. It is not restricted to adults, and is ignored unless a subscriber turns it on.',
  },
  bot: {
    name: 'Bot',
    description: 'Marks the account as automated.',
  },
};

/**
 * The locale to show: the reader's language where the labeler wrote one,
 * then English, then whatever comes first.
 */
export function pickLocale(locales: readonly LabelLocale[], languages: readonly string[]): LabelLocale | null {
  if (locales.length === 0) return null;
  for (const language of languages) {
    const lower = language.toLowerCase();
    const base = lower.split('-')[0];
    const hit =
      locales.find((l) => l.lang.toLowerCase() === lower) ??
      locales.find((l) => l.lang.toLowerCase().split('-')[0] === base);
    if (hit) return hit;
  }
  return locales.find((l) => l.lang.toLowerCase().startsWith('en')) ?? locales[0];
}

export type LabelMeaning = {
  /** The label's name for a reader. The raw value when nothing defines it. */
  name: string;
  description: string | null;
  severity: string | null;
  blurs: string | null;
  defaultSetting: string | null;
  adultOnly: boolean;
  /** Who the wording comes from. */
  source: 'labeler' | 'protocol' | 'none';
};

/**
 * What a label value means when this labeler applies it.
 *
 * A labeler's own definition comes first: it may redefine any global value
 * for itself, except the ones that start with `!`, which are reserved and
 * always mean what the protocol says.
 */
export function describeLabel(
  val: string,
  definitions: readonly LabelDefinition[],
  languages: readonly string[],
): LabelMeaning {
  const global = GLOBAL_LABELS[val];
  const own = val.startsWith('!') ? undefined : definitions.find((d) => d.identifier === val);
  if (own) {
    const locale = pickLocale(own.locales, languages);
    return {
      name: locale?.name || global?.name || val,
      description: locale?.description || global?.description || null,
      severity: own.severity ?? null,
      blurs: own.blurs ?? null,
      defaultSetting: own.defaultSetting ?? null,
      adultOnly: own.adultOnly === true,
      source: 'labeler',
    };
  }
  if (global) {
    return {
      name: global.name,
      description: global.description,
      severity: null,
      blurs: null,
      defaultSetting: null,
      adultOnly: false,
      source: 'protocol',
    };
  }
  return { name: val, description: null, severity: null, blurs: null, defaultSetting: null, adultOnly: false, source: 'none' };
}

/**
 * What an app does with a label, from the two attributes that decide it
 * (the labels guide's table of nine behaviours). Null when the definition
 * gives neither.
 */
export function labelEffect(blurs: string | null, severity: string | null): string | null {
  if (!blurs && !severity) return null;
  const how = severity === 'alert' ? 'behind a warning' : severity === 'inform' ? 'behind a notice' : '';
  if (blurs === 'content') return `Hides the content${how ? ` ${how}` : ''}`;
  if (blurs === 'media') return `Hides images${how ? ` ${how}` : ''}`;
  if (severity === 'alert') return 'Shows a warning badge';
  if (severity === 'inform') return 'Shows an informational badge';
  return 'No visual effect';
}

/* -------------------------------------------------------------------------- *
 * A scan of every labeler
 * -------------------------------------------------------------------------- */

export type ScanProgress = {
  /** Labelers to ask. */
  total: number;
  /** Labelers whose batch has answered. */
  checked: number;
  /** Labelers whose batch failed and could not be asked. */
  failed: number;
};

/** Progress as a whole percentage, for the bar. */
export function scanPercent(progress: ScanProgress): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.round(((progress.checked + progress.failed) / progress.total) * 100));
}

/** `1,234`, in the reader's locale. */
export function formatCount(n: number): string {
  return n.toLocaleString();
}

/**
 * The post inspector's logic: reading an `app.bsky.feed.post` record for the
 * things an app does not show.
 *
 * Most of it is about facets. A facet marks a stretch of the text as a link,
 * a mention or a tag, and says where the stretch is with two numbers,
 * `byteStart` and `byteEnd`. Those count bytes of the text encoded as UTF-8.
 * JavaScript strings index by UTF-16 code unit, so a client that takes its
 * offsets straight from a string gets them right for plain ASCII and wrong
 * after the first emoji or accented letter: every such character before the
 * facet shifts it. That is the commonest bug in posts written by new clients,
 * and the reason this file does its own byte arithmetic rather than slicing
 * strings.
 *
 * Everything here is pure. The page (PostInspector.tsx) fetches the record,
 * the AppView's view of it, and the two gate records that can sit beside it,
 * and hands them over.
 *
 * The limits come from the published lexicons (app.bsky.feed.post,
 * app.bsky.richtext.facet), read when this was written: 300 graphemes and
 * 3000 bytes of text, 3 languages, 8 tags of 64 graphemes each.
 */

import { matchSupportedUrl, parseAtUri as parseRecordUri } from '@/utils/reverseParsers';
import { tidToDate } from '@/utils/atproto/tid';

export const POST_COLLECTION = 'app.bsky.feed.post';
export const THREADGATE_COLLECTION = 'app.bsky.feed.threadgate';
export const POSTGATE_COLLECTION = 'app.bsky.feed.postgate';

export const POST_LIMITS = {
  graphemes: 300,
  bytes: 3000,
  langs: 3,
  tags: 8,
  tagGraphemes: 64,
} as const;

/* -------------------------------------------------------------------------- *
 * Input
 * -------------------------------------------------------------------------- */

export type PostTarget =
  | { ok: true; authority: string; rkey: string }
  | { ok: false; reason: string };

function postTarget(authority: string | undefined, rkey: string | undefined): PostTarget {
  const clean = (authority ?? '').replace(/^@/, '');
  if (!clean || !rkey) return { ok: false, reason: 'A post’s address needs an account and a record key.' };
  if (!/^[A-Za-z0-9._:~-]{1,512}$/.test(rkey)) return { ok: false, reason: `"${rkey}" is not a valid record key.` };
  if (!/^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(clean) && !/^([a-z0-9-]+\.)+[a-z0-9-]+$/i.test(clean)) {
    return { ok: false, reason: `"${clean}" is not a handle or a DID.` };
  }
  return { ok: true, authority: clean.startsWith('did:') ? clean : clean.toLowerCase(), rkey };
}

/**
 * Read what was pasted as a post's address: an at:// URI, or a link to the
 * post in any client this site knows how to read (bsky.app and the apps
 * that share its paths, the other explorers, aturi.to itself).
 */
export function parsePostInput(raw: string): PostTarget {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter a post link or at:// URI.' };

  if (/^at:\/\//i.test(value)) {
    const parsed = parseRecordUri(value)?.parsed;
    if (!parsed?.collection || !parsed.rkey) {
      return { ok: false, reason: `A post’s URI has three parts: at://<account>/${POST_COLLECTION}/<key>.` };
    }
    if (parsed.collection !== POST_COLLECTION) {
      return { ok: false, reason: `That is a ${parsed.collection} record. This tool reads ${POST_COLLECTION} records.` };
    }
    return postTarget(parsed.handle, parsed.rkey);
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, reason: 'That could not be read as a link or an at:// URI.' };
  }
  const match = matchSupportedUrl(url)?.parsed;
  if (match?.collection === POST_COLLECTION && match.rkey) return postTarget(match.handle, match.rkey);

  // Bluesky's path shape on a host this site has no entry for.
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'profile' && parts[2] === 'post' && parts[1] && parts[3]) {
    return postTarget(parts[1].replace(/%3A/gi, ':'), parts[3]);
  }
  if (parts[0] === 'profile' && parts[2] === 'feed') {
    return { ok: false, reason: 'That is a feed, not a post. The feed inspector reads feeds.' };
  }
  if (match?.collection) {
    return { ok: false, reason: `That is a ${match.collection} record. This tool reads ${POST_COLLECTION} records.` };
  }
  return {
    ok: false,
    reason: 'That link does not point at a post. A post link looks like bsky.app/profile/<account>/post/<key>.',
  };
}

/* -------------------------------------------------------------------------- *
 * Text, three ways of counting it
 * -------------------------------------------------------------------------- */

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

/** The text as the user-perceived characters the grapheme limit counts. */
export function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (part) => part.segment);
  }
  // No segmenter: code points, which over-counts joined emoji but never
  // splits a surrogate pair.
  return Array.from(text);
}

export type TextMeasure = { bytes: number; utf16: number; graphemes: number };

export function measureText(text: string): TextMeasure {
  return { bytes: utf8Length(text), utf16: text.length, graphemes: graphemes(text).length };
}

/**
 * Where each character starts, in both encodings: for every UTF-8 byte
 * offset that begins a character (and the offset just past the end), the
 * UTF-16 index of the same place; -1 for an offset inside a character.
 *
 * This is the table the rest needs. A facet's offsets are valid exactly when
 * both land on entries that are not -1, and those entries are where to cut
 * the JavaScript string to get the text the facet covers.
 */
export function byteIndex(text: string): Int32Array {
  const map = new Int32Array(utf8Length(text) + 1).fill(-1);
  let byte = 0;
  for (let i = 0; i < text.length; ) {
    const point = text.codePointAt(i) as number;
    map[byte] = i;
    // A lone surrogate is encoded as U+FFFD, three bytes, which is also what
    // its own value falls under here.
    byte += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    i += point > 0xffff ? 2 : 1;
  }
  map[byte] = text.length;
  return map;
}

/** The text between two byte offsets, or null when either splits a character or lies outside the text. */
export function sliceBytes(text: string, start: number, end: number, map: Int32Array = byteIndex(text)): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= map.length) return null;
  const from = map[start];
  const to = map[end];
  return from < 0 || to < 0 ? null : text.slice(from, to);
}

/**
 * The bytes between two offsets decoded as they are, for showing what a
 * broken range covers: a split character comes out as U+FFFD.
 */
export function decodeBytes(text: string, start: number, end: number): string {
  const bytes = encoder.encode(text);
  return decoder.decode(bytes.slice(Math.max(0, start), Math.max(0, Math.min(end, bytes.length))));
}

/* -------------------------------------------------------------------------- *
 * Facets
 * -------------------------------------------------------------------------- */

export type FacetFeature =
  | { kind: 'mention'; did: string }
  | { kind: 'link'; uri: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'unknown'; type: string };

export type FacetProblem = {
  /** `error`: the facet cannot be drawn as written. `warn`: it can, but something is off. */
  level: 'error' | 'warn';
  code: 'shape' | 'empty' | 'range' | 'boundary' | 'overlap' | 'units' | 'feature';
  message: string;
};

export type FacetReading = {
  /** Its place in the record's `facets` array, from 0. */
  position: number;
  byteStart: number | null;
  byteEnd: number | null;
  features: FacetFeature[];
  /** The text the byte range covers. Null when the range cannot be cut from the text. */
  covered: string | null;
  /** The same range as UTF-16 indices, for marking up the text. Null when it cannot be drawn. */
  utf16: [number, number] | null;
  problems: FacetProblem[];
};

function readFeature(raw: unknown): FacetFeature {
  const feature = (raw ?? {}) as Record<string, unknown>;
  const type = typeof feature.$type === 'string' ? feature.$type : '';
  if (type === 'app.bsky.richtext.facet#mention') return { kind: 'mention', did: String(feature.did ?? '') };
  if (type === 'app.bsky.richtext.facet#link') return { kind: 'link', uri: String(feature.uri ?? '') };
  if (type === 'app.bsky.richtext.facet#tag') return { kind: 'tag', tag: String(feature.tag ?? '') };
  return { kind: 'unknown', type: type || 'no $type' };
}

function featureProblem(feature: FacetFeature): string | null {
  if (feature.kind === 'mention') {
    return /^did:[a-z]+:\S+$/.test(feature.did) ? null : 'The mention has no DID. A mention points at an account by DID, not by handle.';
  }
  if (feature.kind === 'link') {
    try {
      new URL(feature.uri);
      return null;
    } catch {
      return 'The link’s uri is not a complete URL. It needs its scheme, such as https://.';
    }
  }
  if (feature.kind === 'tag') {
    if (!feature.tag) return 'The tag is empty.';
    return graphemes(feature.tag).length > POST_LIMITS.tagGraphemes
      ? `The tag is longer than ${POST_LIMITS.tagGraphemes} characters.`
      : null;
  }
  return null;
}

/**
 * Whether a stretch of text looks like what a feature marks: `yes`, `no`, or
 * `unknown` when it could be either. A link can sit on any words at all, so
 * only its obvious cases are judged; a mention and a tag carry their prefix.
 */
function fits(covered: string, features: FacetFeature[]): 'yes' | 'no' | 'unknown' {
  const feature = features.find((f) => f.kind !== 'unknown');
  if (!feature || !covered) return covered ? 'unknown' : 'no';
  if (feature.kind === 'mention') return /^@[^\s@]+$/u.test(covered) ? 'yes' : 'no';
  if (feature.kind === 'tag') return /^[#＃]\S+$/u.test(covered) ? 'yes' : 'no';
  if (covered !== covered.trim()) return 'no';
  return /^(https?:\/\/)?[^\s/@]+\.[^\s]+$/iu.test(covered) ? 'yes' : 'unknown';
}

type Unit = { name: string; cut: (start: number, end: number) => string | null };

/**
 * The other things a client might have counted in, most likely first. Each
 * cuts the text at the same two numbers read in its own unit.
 */
function otherUnits(text: string): Unit[] {
  const points = Array.from(text);
  const clusters = graphemes(text);
  const within = (length: number, start: number, end: number) => start >= 0 && start < end && end <= length;
  return [
    { name: 'UTF-16 code units', cut: (s, e) => (within(text.length, s, e) ? text.slice(s, e) : null) },
    { name: 'code points', cut: (s, e) => (within(points.length, s, e) ? points.slice(s, e).join('') : null) },
    { name: 'graphemes', cut: (s, e) => (within(clusters.length, s, e) ? clusters.slice(s, e).join('') : null) },
  ];
}

/**
 * Read a record's facets against its text: what each covers, whether it can
 * be drawn, and what is wrong with it when it cannot.
 */
export function readFacets(text: string, facets: unknown): FacetReading[] {
  if (!Array.isArray(facets)) return [];
  const map = byteIndex(text);
  const byteLength = map.length - 1;
  const ascii = byteLength === text.length;
  const units = ascii ? [] : otherUnits(text);

  const readings = facets.map((raw, position): FacetReading => {
    const facet = (raw ?? {}) as { index?: { byteStart?: unknown; byteEnd?: unknown }; features?: unknown };
    const features = Array.isArray(facet.features) ? facet.features.map(readFeature) : [];
    const problems: FacetProblem[] = [];
    const start = facet.index?.byteStart;
    const end = facet.index?.byteEnd;
    const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

    if (!whole(start) || !whole(end)) {
      problems.push({
        level: 'error',
        code: 'shape',
        message: 'The facet has no usable index. byteStart and byteEnd must both be whole numbers, zero or more.',
      });
      return { position, byteStart: null, byteEnd: null, features, covered: null, utf16: null, problems };
    }

    let covered: string | null = null;
    let utf16: [number, number] | null = null;
    if (start >= end) {
      problems.push({
        level: 'error',
        code: 'empty',
        message:
          start === end
            ? 'The range is empty: byteStart and byteEnd are the same.'
            : 'The range runs backwards: byteStart is past byteEnd.',
      });
    } else if (end > byteLength) {
      problems.push({
        level: 'error',
        code: 'range',
        message: `The range runs past the end of the text, which is ${byteLength} bytes long.`,
      });
    } else if (map[start] < 0 || map[end] < 0) {
      problems.push({
        level: 'error',
        code: 'boundary',
        message: `${map[start] < 0 ? 'byteStart' : 'byteEnd'} lands in the middle of a character, so the range cannot be cut from the text.`,
      });
    } else {
      covered = text.slice(map[start], map[end]);
      utf16 = [map[start], map[end]];
    }

    // Offsets counted in the wrong unit. Only worth asking when the text is
    // not plain ASCII (every unit agrees when it is) and the bytes reading
    // is broken or covers the wrong thing, and only said when another unit
    // would cover exactly what the feature marks.
    if (!ascii && (covered === null || fits(covered, features) === 'no')) {
      for (const unit of units) {
        const other = unit.cut(start, end);
        if (other !== null && other !== covered && fits(other, features) === 'yes') {
          problems.push({
            level: 'error',
            code: 'units',
            message: `These offsets fit if they are counted in ${unit.name}: they would cover “${other}”. Facet offsets count UTF-8 bytes, so each character before the facet that is not plain ASCII moves it.`,
          });
          break;
        }
      }
    }

    if (features.length === 0) {
      problems.push({ level: 'warn', code: 'feature', message: 'The facet has no features, so it marks the text without saying what it is.' });
    }
    for (const feature of features) {
      const problem = featureProblem(feature);
      if (problem) problems.push({ level: 'warn', code: 'feature', message: problem });
    }
    return { position, byteStart: start, byteEnd: end, features, covered, utf16, problems };
  });

  // Overlaps, among the facets that can be drawn, in the order they start.
  const drawable = readings.filter((r) => r.utf16).sort((a, b) => (a.byteStart as number) - (b.byteStart as number));
  let last: FacetReading | null = null;
  for (const reading of drawable) {
    if (last && (reading.byteStart as number) < (last.byteEnd as number)) {
      reading.problems.push({
        level: 'warn',
        code: 'overlap',
        message: `Overlaps facet ${last.position + 1}, so the two cannot both be drawn.`,
      });
      continue;
    }
    last = reading;
  }
  return readings;
}

export type TextSegment = {
  text: string;
  /** The facet this stretch belongs to, by its place in the record's array; null for plain text. */
  facet: number | null;
};

/** The text cut into plain stretches and facets, for marking it up. Overlapping and broken facets are left out. */
export function segmentText(text: string, readings: FacetReading[]): TextSegment[] {
  const drawable = readings
    .filter((r) => r.utf16 && !r.problems.some((p) => p.code === 'overlap'))
    .sort((a, b) => (a.utf16 as [number, number])[0] - (b.utf16 as [number, number])[0]);
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const reading of drawable) {
    const [from, to] = reading.utf16 as [number, number];
    if (from < cursor) continue;
    if (from > cursor) segments.push({ text: text.slice(cursor, from), facet: null });
    segments.push({ text: text.slice(from, to), facet: reading.position });
    cursor = to;
  }
  if (cursor < text.length || segments.length === 0) segments.push({ text: text.slice(cursor), facet: null });
  return segments;
}

export type LooseToken = { kind: 'link' | 'mention' | 'tag'; text: string };

/**
 * Things in the text that read as a link, a mention or a tag and have no
 * facet over them. An app shows these as plain text: the facet is what makes
 * a link a link.
 */
export function looseTokens(text: string, readings: FacetReading[]): LooseToken[] {
  const covered = readings.filter((r) => r.utf16).map((r) => r.utf16 as [number, number]);
  const free = (from: number, to: number) => !covered.some(([a, b]) => from < b && to > a);
  const found: LooseToken[] = [];
  const scan = (kind: LooseToken['kind'], pattern: RegExp, group: number) => {
    for (const match of text.matchAll(pattern)) {
      const token = match[group].replace(/[.,;:!?)\]}'"’”]+$/u, '');
      const from = (match.index ?? 0) + match[0].indexOf(match[group]);
      if (token.length > 1 && free(from, from + token.length)) found.push({ kind, text: token });
    }
  };
  scan('link', /(^|\s|\()(https?:\/\/[^\s]+)/giu, 2);
  scan('mention', /(^|\s|\()(@(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*)/giu, 2);
  // A tag needs something that is not a digit after its sign: "#1" is a number.
  scan('tag', /(^|\s)([#＃](?=[^\s#＃]*[^\d\s\p{P}])[^\s#＃]+)/gu, 2);
  return found;
}

/* -------------------------------------------------------------------------- *
 * Timestamps
 * -------------------------------------------------------------------------- */

/** How far apart two of a post's times can be before it is worth saying. */
const TIME_TOLERANCE_MS = 5 * 60_000;

export function formatSpan(ms: number): string {
  const abs = Math.abs(ms);
  const units: [number, string][] = [
    [365 * 86_400_000, 'year'],
    [30 * 86_400_000, 'month'],
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
  ];
  for (const [size, name] of units) {
    if (abs >= size) {
      const n = Math.round(abs / size);
      return `${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  const seconds = Math.max(1, Math.round(abs / 1000));
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

export type PostTimes = {
  /** What the client said, as written and as a date. */
  createdAtRaw: string | null;
  createdAt: Date | null;
  /** When the record was written, from its record key. Null when the key is not a TID. */
  keyTime: Date | null;
  /** When the AppView indexed it. */
  indexedAt: Date | null;
  /**
   * What is worth saying about how they compare. Empty when they agree. A
   * `warn` is something about the record itself; an `info` is only about
   * when Bluesky got to it.
   */
  notes: { level: 'warn' | 'info'; message: string }[];
};

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Compare the three times a post has. `createdAt` is whatever the client put
 * there and can be any date. The record key is a TID, minted when the record
 * was written, so it is the nearest thing to when the post was really made.
 */
export function readTimes(input: { createdAt: unknown; rkey: string; indexedAt?: unknown }): PostTimes {
  const createdAt = toDate(input.createdAt);
  const keyTime = tidToDate(input.rkey);
  const indexedAt = toDate(input.indexedAt);
  const notes: PostTimes['notes'] = [];
  const warn = (message: string) => notes.push({ level: 'warn', message });

  if (!createdAt) {
    warn(
      typeof input.createdAt === 'string'
        ? `createdAt is “${input.createdAt}”, which is not a date.`
        : 'The record has no createdAt, which the lexicon requires.',
    );
  }
  if (!keyTime) warn('The record key is not a TID, so it carries no time of its own.');
  if (createdAt && keyTime) {
    const gap = createdAt.getTime() - keyTime.getTime();
    if (gap < -TIME_TOLERANCE_MS) {
      warn(
        `createdAt is ${formatSpan(gap)} earlier than the record key, which is set when the record is written. The post was backdated, or imported from somewhere else.`,
      );
    } else if (gap > TIME_TOLERANCE_MS) {
      warn(
        `createdAt is ${formatSpan(gap)} later than the record key. The client’s clock was ahead, or the date was set by hand.`,
      );
    }
  }
  const written = keyTime ?? createdAt;
  if (indexedAt && written && indexedAt.getTime() - written.getTime() > TIME_TOLERANCE_MS) {
    notes.push({
      level: 'info',
      message: `Bluesky indexed the post ${formatSpan(indexedAt.getTime() - written.getTime())} after it was written.`,
    });
  }
  return {
    createdAtRaw: typeof input.createdAt === 'string' ? input.createdAt : null,
    createdAt,
    keyTime,
    indexedAt,
    notes,
  };
}

/* -------------------------------------------------------------------------- *
 * Gates, embeds, labels
 * -------------------------------------------------------------------------- */

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function typeName(value: unknown): string {
  const type = (value as { $type?: unknown } | null)?.$type;
  return typeof type === 'string' ? type : '';
}

export type GateReading = { summary: string; detail: string[] };

/** A threadgate record in words: who may reply, and how many replies the author has hidden. */
export function describeThreadgate(value: Record<string, unknown>): GateReading {
  const detail: string[] = [];
  let summary: string;
  if (!Array.isArray(value.allow)) {
    summary = 'Anyone can reply. The record sets no rule.';
  } else if (value.allow.length === 0) {
    summary = 'Nobody can reply.';
  } else {
    const who = value.allow.map((rule) => {
      const type = typeName(rule);
      if (type.endsWith('#mentionRule')) return 'accounts mentioned in the post';
      if (type.endsWith('#followerRule')) return 'accounts that follow the author';
      if (type.endsWith('#followingRule')) return 'accounts the author follows';
      if (type.endsWith('#listRule')) {
        const uri = String((rule as { list?: unknown }).list ?? '');
        detail.push(`list ${uri}`);
        return 'accounts on a list';
      }
      return type ? `an unrecognised rule (${type})` : 'an unrecognised rule';
    });
    summary = `Replies are limited to ${list([...new Set(who)])}.`;
  }
  const hidden = Array.isArray(value.hiddenReplies) ? value.hiddenReplies.length : 0;
  if (hidden > 0) summary += ` The author has hidden ${hidden} ${hidden === 1 ? 'reply' : 'replies'}.`;
  return { summary, detail };
}

/** A postgate record in words: whether the post can be quoted, and the quotes it was detached from. */
export function describePostgate(value: Record<string, unknown>): GateReading {
  const rules = Array.isArray(value.embeddingRules) ? value.embeddingRules : [];
  const disabled = rules.some((rule) => typeName(rule).endsWith('#disableRule'));
  const detached = Array.isArray(value.detachedEmbeddingUris) ? (value.detachedEmbeddingUris as unknown[]) : [];
  let summary = disabled ? 'Quoting is turned off for this post.' : 'Anyone can quote this post. The record sets no rule.';
  if (detached.length > 0) {
    summary += ` The author has detached it from ${detached.length} ${detached.length === 1 ? 'quote' : 'quotes'}.`;
  }
  return { summary, detail: detached.slice(0, 5).map((uri) => `detached from ${String(uri)}`) };
}

const RECORD_NAMES: Record<string, string> = {
  'app.bsky.feed.post': 'a post',
  'app.bsky.feed.generator': 'a feed',
  'app.bsky.graph.list': 'a list',
  'app.bsky.graph.starterpack': 'a starter pack',
  'app.bsky.labeler.service': 'a labeler',
};

function quoted(embed: unknown): { uri: string; what: string } | null {
  const uri = (embed as { record?: { uri?: unknown } } | null)?.record?.uri;
  if (typeof uri !== 'string') return null;
  const collection = uri.split('/')[3] ?? '';
  return { uri, what: RECORD_NAMES[collection] ?? `a ${collection || 'record'}` };
}

function describeMedia(embed: unknown): GateReading | null {
  const type = typeName(embed);
  const media = embed as Record<string, unknown>;
  if (type === 'app.bsky.embed.images') {
    const images = Array.isArray(media.images) ? (media.images as { alt?: unknown }[]) : [];
    const described = images.filter((image) => typeof image?.alt === 'string' && image.alt.trim()).length;
    const count = `${images.length} ${images.length === 1 ? 'image' : 'images'}`;
    return {
      summary:
        described === images.length
          ? `${count}, ${images.length === 1 ? 'with' : 'all with'} alt text.`
          : `${count}, ${described} of them with alt text.`,
      detail: [],
    };
  }
  if (type === 'app.bsky.embed.video') {
    const alt = typeof media.alt === 'string' && media.alt.trim();
    return { summary: `A video, ${alt ? 'with' : 'without'} alt text.`, detail: [] };
  }
  if (type === 'app.bsky.embed.external') {
    const external = (media.external ?? {}) as { uri?: unknown; title?: unknown };
    return {
      summary: `A link card${typeof external.title === 'string' && external.title ? ` titled “${external.title}”` : ''}.`,
      detail: typeof external.uri === 'string' ? [external.uri] : [],
    };
  }
  return null;
}

/** A post's embed in words. Null when it has none. */
export function describeEmbed(embed: unknown): GateReading | null {
  const type = typeName(embed);
  if (!type) return null;
  if (type === 'app.bsky.embed.record') {
    const quote = quoted(embed);
    return quote
      ? { summary: `Quotes ${quote.what}.`, detail: [quote.uri] }
      : { summary: 'A record embed that names no record.', detail: [] };
  }
  if (type === 'app.bsky.embed.recordWithMedia') {
    const both = embed as { record?: unknown; media?: unknown };
    const quote = quoted(both.record);
    const media = describeMedia(both.media);
    return {
      summary: `Quotes ${quote?.what ?? 'a record'}, with media: ${media?.summary ?? typeName(both.media)}`,
      detail: [...(quote ? [quote.uri] : []), ...(media?.detail ?? [])],
    };
  }
  return describeMedia(embed) ?? { summary: `An embed of a type this tool does not read (${type}).`, detail: [] };
}

export type PostLabel = { val: string; src: string; negated: boolean };

export function selfLabels(record: Record<string, unknown>): string[] {
  const values = (record.labels as { values?: unknown } | undefined)?.values;
  if (!Array.isArray(values)) return [];
  return values.map((entry) => String((entry as { val?: unknown } | null)?.val ?? '')).filter(Boolean);
}

/* -------------------------------------------------------------------------- *
 * Findings
 * -------------------------------------------------------------------------- */

export type GateProbe =
  | { status: 'found'; uri: string; value: Record<string, unknown> }
  | { status: 'none' }
  /** The lookup failed, which says nothing about whether the record exists. */
  | { status: 'error' };

export type PostFindingStatus = 'pass' | 'warn' | 'fail' | 'info' | 'pending';

export type PostFinding = {
  id: 'length' | 'facets' | 'times' | 'reply' | 'threadgate' | 'postgate' | 'embed' | 'langs' | 'labels';
  status: PostFindingStatus;
  title: string;
  summary: string;
  detail?: string[];
};

/**
 * What has been fetched so far. `view`, `threadgate` and `postgate` are
 * undefined while on their way.
 */
export type PostEvidence = {
  /** The post's address, with the account as a DID. */
  uri: string;
  rkey: string;
  record: Record<string, unknown>;
  /** The AppView's view of the post. Null when it has none. */
  view?: { indexedAt?: string; labels?: { val?: string; src?: string; neg?: boolean }[] } | null;
  threadgate?: GateProbe;
  postgate?: GateProbe;
};

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

function replyRef(record: Record<string, unknown>): { root?: string; parent?: string } | null {
  const reply = record.reply as { root?: { uri?: unknown }; parent?: { uri?: unknown } } | undefined;
  if (!reply || typeof reply !== 'object') return null;
  return {
    root: typeof reply.root?.uri === 'string' ? reply.root.uri : undefined,
    parent: typeof reply.parent?.uri === 'string' ? reply.parent.uri : undefined,
  };
}

/** The post a thread's reply rules hang off: the root for a reply, the post itself otherwise. */
export function threadRoot(evidence: Pick<PostEvidence, 'uri' | 'record'>): string {
  return replyRef(evidence.record)?.root ?? evidence.uri;
}

/** The address of a gate record for a post: same repository, same record key. */
export function gateUri(postUri: string, collection: string): string | null {
  const [did, , rkey] = postUri.slice('at://'.length).split('/');
  return did && rkey ? `at://${did}/${collection}/${rkey}` : null;
}

function facetsFinding(text: string, readings: FacetReading[]): PostFinding {
  const id = 'facets';
  const title = 'Facets';
  const loose = looseTokens(text, readings);
  const looseNote = loose.length
    ? ` ${count(loose.length, 'thing')} in the text ${loose.length === 1 ? 'reads' : 'read'} as a ${list([...new Set(loose.map((t) => t.kind))])} but ${loose.length === 1 ? 'has' : 'have'} no facet, so apps show ${loose.length === 1 ? 'it' : 'them'} as plain text.`
    : '';
  const looseDetail = loose.slice(0, 6).map((token) => `no facet over ${token.text}`);
  if (readings.length === 0) {
    return {
      id,
      status: loose.length ? 'warn' : 'info',
      title,
      summary: `No facets: nothing in the text is marked as a link, a mention or a tag.${looseNote}`,
      detail: looseDetail.length ? looseDetail : undefined,
    };
  }
  const broken = readings.filter((r) => r.problems.some((p) => p.level === 'error'));
  const doubtful = readings.filter((r) => !broken.includes(r) && r.problems.length > 0);
  if (broken.length > 0) {
    return {
      id,
      status: 'fail',
      title,
      summary: `${broken.length} of ${count(readings.length, 'facet')} ${broken.length === 1 ? 'does' : 'do'} not fit the text.${looseNote}`,
      detail: [
        ...broken.map((r) => `facet ${r.position + 1}: ${r.problems.find((p) => p.level === 'error')?.message}`),
        ...looseDetail,
      ],
    };
  }
  if (doubtful.length > 0 || loose.length > 0) {
    return {
      id,
      status: 'warn',
      title,
      summary: `${count(readings.length, 'facet')}, all inside the text and on character boundaries${doubtful.length ? `, with ${count(doubtful.length, 'thing')} to look at` : ''}.${looseNote}`,
      detail: [...doubtful.map((r) => `facet ${r.position + 1}: ${r.problems[0].message}`), ...looseDetail],
    };
  }
  return {
    id,
    status: 'pass',
    title,
    summary: `${count(readings.length, 'facet')}, all inside the text and on character boundaries.`,
  };
}

function gateFinding(
  id: 'threadgate' | 'postgate',
  title: string,
  probe: GateProbe | undefined,
  open: string,
  describe: (value: Record<string, unknown>) => GateReading,
  prefix = '',
): PostFinding {
  if (probe === undefined) return { id, status: 'pending', title, summary: 'Checking…' };
  if (probe.status === 'error') {
    return { id, status: 'info', title, summary: 'The rule record could not be looked up, so this is not known.' };
  }
  if (probe.status === 'none') return { id, status: 'info', title, summary: `${prefix}${open}` };
  const reading = describe(probe.value);
  return { id, status: 'info', title, summary: `${prefix}${reading.summary}`, detail: [probe.uri, ...reading.detail] };
}

/** Everything the record says, as a list of findings. */
export function buildPostFindings(evidence: PostEvidence): PostFinding[] {
  const { record } = evidence;
  const text = typeof record.text === 'string' ? record.text : '';
  const measure = measureText(text);
  const readings = readFacets(text, record.facets);
  const findings: PostFinding[] = [];

  // ── Length ──
  const over = measure.graphemes > POST_LIMITS.graphemes || measure.bytes > POST_LIMITS.bytes;
  const lengthDetail = [
    `${measure.graphemes} graphemes of ${POST_LIMITS.graphemes}`,
    `${measure.bytes} UTF-8 bytes of ${POST_LIMITS.bytes}`,
    `${measure.utf16} UTF-16 code units`,
  ];
  if (typeof record.text !== 'string') {
    findings.push({ id: 'length', status: 'fail', title: 'Text', summary: 'The record has no text field, which the lexicon requires. A post with only an embed still carries an empty string.' });
  } else if (over) {
    findings.push({
      id: 'length',
      status: 'fail',
      title: 'Text',
      summary: `The text is over the limit of ${POST_LIMITS.graphemes} graphemes and ${POST_LIMITS.bytes} bytes.`,
      detail: lengthDetail,
    });
  } else {
    findings.push({
      id: 'length',
      status: !text && !record.embed ? 'warn' : 'pass',
      title: 'Text',
      summary: !text
        ? record.embed
          ? 'The text is empty, which is fine for a post that is only an embed.'
          : 'The text is empty and there is no embed, so the post shows nothing.'
        : `${count(measure.graphemes, 'grapheme')} of ${POST_LIMITS.graphemes} and ${count(measure.bytes, 'byte')} of ${POST_LIMITS.bytes.toLocaleString('en-US')}.`,
      detail: lengthDetail,
    });
  }

  findings.push(facetsFinding(text, readings));

  // ── Timestamps ──
  const times = readTimes({ createdAt: record.createdAt, rkey: evidence.rkey, indexedAt: evidence.view?.indexedAt });
  const timeDetail = [
    `createdAt   ${times.createdAtRaw ?? 'missing'}`,
    `record key  ${times.keyTime ? times.keyTime.toISOString() : 'not a TID'}`,
    ...(evidence.view === undefined
      ? []
      : [`indexedAt   ${times.indexedAt ? times.indexedAt.toISOString() : 'not indexed'}`]),
  ];
  const timeWarnings = times.notes.filter((note) => note.level === 'warn');
  findings.push({
    id: 'times',
    status: !times.createdAt ? 'fail' : timeWarnings.length ? 'warn' : 'pass',
    title: 'Timestamps',
    summary: [
      ...(timeWarnings.length ? [] : ['createdAt and the time in the record key agree to within a few minutes.']),
      ...times.notes.map((note) => note.message),
    ].join(' '),
    detail: timeDetail,
  });

  // ── Reply ──
  const reply = replyRef(record);
  if (!reply) {
    findings.push({ id: 'reply', status: 'info', title: 'Thread', summary: 'Not a reply. This post starts its own thread.' });
  } else if (!reply.root || !reply.parent) {
    findings.push({
      id: 'reply',
      status: 'fail',
      title: 'Thread',
      summary: `The reply names no ${!reply.parent ? 'parent' : 'root'}. A reply has to point at both the post it answers and the thread’s first post.`,
    });
  } else {
    findings.push({
      id: 'reply',
      status: 'info',
      title: 'Thread',
      summary:
        reply.root === reply.parent
          ? 'A reply to the first post of its thread.'
          : 'A reply to a reply, further down its thread.',
      detail: [`parent ${reply.parent}`, `root   ${reply.root}`],
    });
  }

  // ── Who can reply, who can quote ──
  findings.push(
    gateFinding(
      'threadgate',
      'Who can reply',
      evidence.threadgate,
      'Anyone can reply. There is no threadgate record.',
      describeThreadgate,
      reply ? 'Set on the thread’s first post: ' : '',
    ),
    gateFinding(
      'postgate',
      'Who can quote',
      evidence.postgate,
      'Anyone can quote this post. There is no postgate record.',
      describePostgate,
    ),
  );

  // ── Embed ──
  const embed = describeEmbed(record.embed);
  findings.push({
    id: 'embed',
    status: 'info',
    title: 'Embed',
    summary: embed?.summary ?? 'No embed.',
    detail: embed?.detail.length ? embed.detail : undefined,
  });

  // ── Languages and tags ──
  const langs = Array.isArray(record.langs) ? record.langs.map(String) : [];
  const tags = Array.isArray(record.tags) ? record.tags.map(String) : [];
  const tooMany = langs.length > POST_LIMITS.langs || tags.length > POST_LIMITS.tags;
  findings.push({
    id: 'langs',
    status: tooMany ? 'fail' : 'info',
    title: 'Languages and tags',
    summary: `${langs.length ? `Marked as ${list(langs)}.` : 'No language is set.'} ${
      tags.length ? `${count(tags.length, 'tag')} outside the text: ${list(tags)}.` : 'No tags outside the text.'
    }${tooMany ? ` The lexicon allows ${POST_LIMITS.langs} languages and ${POST_LIMITS.tags} tags.` : ''}`,
  });

  // ── Labels ──
  const own = selfLabels(record);
  if (evidence.view === undefined) {
    findings.push({ id: 'labels', status: 'pending', title: 'Labels', summary: 'Checking…' });
  } else {
    const applied = (evidence.view?.labels ?? []).filter((label) => label.val && !label.neg && !own.includes(label.val));
    findings.push({
      id: 'labels',
      status: 'info',
      title: 'Labels',
      summary: `${own.length ? `The author labelled it ${list(own)}.` : 'No self-labels.'} ${
        evidence.view === null
          ? 'Bluesky’s AppView has no view of the post, so its labels are not known.'
          : applied.length
            ? `Bluesky’s AppView shows ${count(applied.length, 'label')} from labelers: ${list(applied.map((l) => String(l.val)))}.`
            : 'Bluesky’s AppView shows none from its default labelers.'
      }`,
      detail: applied.length ? applied.map((label) => `${label.val} from ${label.src}`) : undefined,
    });
  }

  return findings;
}

export type PostVerdict = { tone: 'pass' | 'warn' | 'fail' | 'pending'; title: string; text: string };

/** The one-line answer above the findings. */
export function postVerdict(findings: PostFinding[]): PostVerdict {
  const failed = findings.filter((f) => f.status === 'fail');
  if (failed.length > 0) {
    return {
      tone: 'fail',
      title: `This record has ${failed.length === 1 ? 'a problem' : `${failed.length} problems`}`,
      text: failed[0].summary,
    };
  }
  if (findings.some((f) => f.status === 'pending')) {
    return { tone: 'pending', title: 'Reading the record', text: 'Looking up the AppView’s view and the reply and quote rules.' };
  }
  const warned = findings.filter((f) => f.status === 'warn');
  if (warned.length > 0) {
    return {
      tone: 'warn',
      title: `This record reads cleanly, with ${warned.length === 1 ? 'one thing' : `${warned.length} things`} to look at`,
      text: warned[0].summary,
    };
  }
  const facets = findings.find((f) => f.id === 'facets');
  return {
    tone: 'pass',
    title: 'This record reads cleanly',
    text:
      facets?.status === 'pass'
        ? 'Every facet lines up with the text, the text is inside its limits, and the timestamps agree.'
        : 'The text is inside its limits and the timestamps agree.',
  };
}

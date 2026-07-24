/**
 * AT Tags — the community proposal for mapping a web page to the atproto
 * records and identities it references, via `<meta>` tags in the `at:`
 * namespace. See https://tangled.org/chrisshank.com/at-tags/.
 *
 * A page declares its relationships with a handful of standard properties:
 *
 *   <meta name="at:canonical" content="at://did:plc:abc/site.standard.document/rkey" />
 *   <meta name="at:alternate" content="at://did:plc:xyz/app.bsky.feed.post/rkey" />
 *   <meta name="at:author"    content="at://did:plc:author" />
 *   <meta name="at:me"        content="at://did:plc:my-did" />
 *
 * Non-standard properties are carried under a namespace:
 *
 *   <meta name="at:standard.site:comments" content="at://did:plc:abc/..." />
 *
 * Two rules from the proposal shape the parser:
 *   - Array semantics: repeating a property name accumulates values.
 *   - Any `at:` property that is neither a standard property nor namespaced
 *     (`at:{namespace}:{property}`) is ignored.
 *
 * This module is pure and dependency-light so it can run in three places:
 *   - the aturi.to web app (build tags in `generateMetadata`),
 *   - the browser extension's page scanner (parse tags off the live DOM),
 *   - and the shared test suite.
 */

import { parseAtUri } from './urls';

/** The four properties defined by the proposal itself. */
export type AtTagStandardRelation = 'canonical' | 'alternate' | 'author' | 'me';

export const AT_TAG_STANDARD_RELATIONS: readonly AtTagStandardRelation[] = [
  'canonical',
  'alternate',
  'author',
  'me',
];

/** The parsed shape of a meta tag's `name` attribute. */
export type AtTagName =
  | { kind: 'standard'; relation: AtTagStandardRelation }
  | { kind: 'namespaced'; namespace: string; property: string };

/** One recognized `at:` meta tag with its validated AT URI. */
export type AtTag = AtTagName & {
  /** The normalized `name` attribute, e.g. `at:canonical`. */
  name: string;
  /** The validated AT URI from the `content` attribute. */
  uri: string;
};

/**
 * The full result of parsing a page's AT Tags. Standard properties get their
 * own arrays; everything namespaced is nested `namespace -> property -> uris`.
 * `tags` is a flat, source-ordered list handy for UI that wants to show every
 * relationship with its label.
 */
export type AtTagsResult = {
  canonical: string[];
  alternate: string[];
  author: string[];
  me: string[];
  namespaces: Record<string, Record<string, string[]>>;
  tags: AtTag[];
};

/** A meta tag reduced to the two attributes AT Tags cares about. */
export type MetaEntry = {
  name?: string | null;
  content?: string | null;
};

/**
 * Validate an AT URI for use as an AT Tags `content` value. Deliberately
 * lenient about the record path (the proposal buckets by declared relation,
 * not by URI shape) but strict enough to reject junk: the authority must look
 * like a DID or a dotted handle.
 */
export function isValidAtUri(uri: string | null | undefined): boolean {
  if (typeof uri !== 'string') return false;
  const trimmed = uri.trim();
  if (!trimmed.startsWith('at://')) return false;
  const parsed = parseAtUri(trimmed);
  if (!parsed) return false;
  const repo = parsed.repo;
  if (!repo) return false;
  // DID (`did:method:...`) or a handle with at least one dot.
  const isDid = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(repo);
  const isHandle = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(repo);
  return isDid || isHandle;
}

/**
 * Whether an AT URI references only a DID (no collection/rkey). `at:author`
 * and `at:me` are expected to be DID-only per the proposal; callers can use
 * this to sanity-check but the parser does not enforce it.
 */
export function isDidOnlyAtUri(uri: string | null | undefined): boolean {
  if (!isValidAtUri(uri)) return false;
  const parsed = parseAtUri(uri!.trim());
  return !!parsed && parsed.repo.startsWith('did:') && !parsed.collection && !parsed.rkey;
}

/**
 * Interpret a meta tag's `name` attribute. Returns null for anything that is
 * not a recognized AT Tag (no `at:` prefix, or an `at:` property that is
 * neither standard nor namespaced — which the proposal says to ignore).
 */
export function parseAtTagName(rawName: string | null | undefined): AtTagName | null {
  if (typeof rawName !== 'string') return null;
  const name = rawName.trim();
  // The `at:` prefix and the standard relation keywords are matched
  // case-insensitively, but the namespace and property segments keep their
  // original case: an NSID is lowercase by spec, yet a property name may be
  // case-sensitive (e.g. `syndicatedBy`), and force-lowercasing it would break
  // the build -> parse round-trip.
  if (!/^at:/i.test(name)) return null;
  const rest = name.slice(3);
  if (!rest) return null;

  const relation = rest.toLowerCase();
  if ((AT_TAG_STANDARD_RELATIONS as readonly string[]).includes(relation)) {
    return { kind: 'standard', relation: relation as AtTagStandardRelation };
  }

  // Namespaced: `at:{namespace}:{property}`. The namespace (e.g. an NSID like
  // `standard.site`) has no colon; the property is everything after the first
  // colon. Both segments must be non-empty.
  const colon = rest.indexOf(':');
  if (colon <= 0 || colon >= rest.length - 1) return null;
  const namespace = rest.slice(0, colon);
  const property = rest.slice(colon + 1);
  if (!namespace || !property) return null;
  return { kind: 'namespaced', namespace, property };
}

/** Append `value` if absent; returns whether it was newly added. */
function pushUnique(arr: string[], value: string): boolean {
  if (arr.includes(value)) return false;
  arr.push(value);
  return true;
}

/**
 * Parse a collection of meta `{ name, content }` entries into structured AT
 * Tags. Invalid AT URIs and unrecognized properties are dropped. This is the
 * DOM-agnostic core; see {@link parseAtTagsFromDocument} for the browser path.
 */
export function parseAtTags(entries: Iterable<MetaEntry>): AtTagsResult {
  const result: AtTagsResult = {
    canonical: [],
    alternate: [],
    author: [],
    me: [],
    namespaces: {},
    tags: [],
  };

  for (const entry of entries) {
    const parsedName = parseAtTagName(entry?.name);
    if (!parsedName) continue;

    const raw = typeof entry?.content === 'string' ? entry.content.trim() : '';
    if (!isValidAtUri(raw)) continue;
    const uri = raw;

    if (parsedName.kind === 'standard') {
      if (pushUnique(result[parsedName.relation], uri)) {
        result.tags.push({ ...parsedName, name: `at:${parsedName.relation}`, uri });
      }
    } else {
      const { namespace, property } = parsedName;
      const ns = (result.namespaces[namespace] ??= {});
      const bucket = (ns[property] ??= []);
      if (pushUnique(bucket, uri)) {
        result.tags.push({ ...parsedName, name: `at:${namespace}:${property}`, uri });
      }
    }
  }

  return result;
}

/**
 * Parse AT Tags off a live DOM. Reads every `<meta name="at:...">` in the
 * document (meta tags are only valid in `<head>`, but scanning document-wide
 * is harmless and more robust against apps that inject them late).
 */
export function parseAtTagsFromDocument(doc: Document): AtTagsResult {
  const entries: MetaEntry[] = [];
  try {
    // Select every named meta tag and let `parseAtTagName` decide. A CSS
    // `[name^="at:"]` prefix match is case-sensitive, so it would silently drop
    // an `AT:canonical` that the string parser accepts; scanning all named
    // metas keeps the DOM path in lockstep with `parseAtTags`.
    doc.querySelectorAll('meta[name]').forEach((el) => {
      entries.push({ name: el.getAttribute('name'), content: el.getAttribute('content') });
    });
  } catch {
    /* invalid selector environment — return whatever we gathered */
  }
  return parseAtTags(entries);
}

/** True when a parse result carries no recognized AT Tags. */
export function isEmptyAtTags(result: AtTagsResult): boolean {
  return result.tags.length === 0;
}

/** Input to {@link buildAtTagsMetadata}: each property may be one URI or many. */
export type AtTagsInput = {
  canonical?: string | string[] | null;
  alternate?: string | string[] | null;
  author?: string | string[] | null;
  me?: string | string[] | null;
  /** Namespaced properties: `{ 'standard.site': { comments: 'at://...' } }`. */
  namespaces?: Record<string, Record<string, string | string[] | null | undefined>>;
};

function toValidList(value: string | string[] | null | undefined): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (isValidAtUri(trimmed) && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/**
 * Build a Next.js `Metadata.other`-compatible map of AT Tags. Each property
 * becomes `<meta name="at:{prop}" content="...">`; multiple values repeat the
 * tag (array semantics). Invalid AT URIs are dropped, and properties with no
 * valid value are omitted entirely so the page never emits an empty tag.
 */
export function buildAtTagsMetadata(input: AtTagsInput): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const add = (name: string, value: string | string[] | null | undefined) => {
    const values = toValidList(value);
    if (values.length === 1) out[name] = values[0];
    else if (values.length > 1) out[name] = values;
  };

  add('at:canonical', input.canonical);
  add('at:alternate', input.alternate);
  add('at:author', input.author);
  add('at:me', input.me);

  if (input.namespaces) {
    for (const [namespace, props] of Object.entries(input.namespaces)) {
      if (!namespace || !props) continue;
      for (const [property, value] of Object.entries(props)) {
        if (!property) continue;
        add(`at:${namespace}:${property}`, value);
      }
    }
  }

  return out;
}

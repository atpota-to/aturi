import { parseAtUri } from './reverseParsers';
import {
  WAYPOINT_DESTINATIONS_DATA,
  type RedirectCompatFamily,
  type WaypointData,
} from './waypoints.data';

/**
 * Preferred clients: an account's public declaration of which app it wants
 * each kind of atproto link opened in.
 *
 * Aturi's own favorites (`favoriteByFamily` in `to.aturi.actor.preferences`)
 * answer that question for aturi.to alone. This record answers it for any app
 * that links out to atproto content: read
 * `at://<did>/to.aturi.client.declaration/self` for the signed-in viewer
 * and send their Bluesky links to Blacksky rather than bsky.app, or their
 * record links to the explorer they actually use, without showing a picker.
 * The schema is `lexicons/to/aturi/client/declaration.json`.
 *
 * Each declared client carries its own URL templates, so a reader needs
 * nothing from this module, or from Aturi's catalog, to act on it. The
 * catalog id rides along as a hint for readers that do have the catalog, and
 * `clientFromWaypoint` writes the templates out of it.
 *
 * Everything here is pure and synchronous. Nothing fetches: a reader already
 * holds an agent for the signed-in account, and one `getRecord` is the whole
 * read.
 */

export const PREFERRED_CLIENTS_NSID = 'to.aturi.client.declaration';
export const PREFERRED_CLIENTS_RKEY = 'self';

/**
 * The kinds of link a preference is declared for. The lexicon leaves
 * `category` open, so a record may carry others; these are the ones Aturi
 * writes and documents. The ids are compat family ids, so a declared
 * preference and an Aturi auto-redirect favorite for the same family mean the
 * same thing, and a catalog waypoint is a candidate for a category exactly
 * when its `redirectCompat` names it.
 */
export type PreferredClientCategory = Extract<
  RedirectCompatFamily,
  'bluesky-social' | 'atproto-explorer'
>;

export const PREFERRED_CLIENT_CATEGORIES: readonly PreferredClientCategory[] = [
  'bluesky-social',
  'atproto-explorer',
];

/** The device split a preference can declare. */
export type ClientPlatform = 'mobile' | 'desktop';

export const CLIENT_PLATFORMS: readonly ClientPlatform[] = ['mobile', 'desktop'];

/**
 * Which half of a device split applies to the device a user agent describes,
 * for readers that have nothing better to go on. Tablets count as mobile, as
 * the lexicon says. iPadOS asks for desktop sites and reports itself as a
 * Mac, so a "Macintosh" with a touchscreen is read as the tablet it is: pass
 * `navigator.maxTouchPoints` in a browser to get that right.
 */
export function clientPlatformFromUserAgent(
  userAgent: string,
  maxTouchPoints = 0,
): ClientPlatform {
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(userAgent)) return 'mobile';
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'mobile';
  return 'desktop';
}

export type ClientLinkTemplateKind = 'profile' | 'post' | 'list' | 'record';

/**
 * URL templates with `{handle}`, `{did}`, `{actor}`, `{collection}` and
 * `{rkey}` placeholders, the same vocabulary custom waypoints use. See
 * `expandLinkTemplate` for how each one is filled.
 */
export type ClientLinkTemplates = Partial<Record<ClientLinkTemplateKind, string>>;

export type DeclaredClient = {
  /** The client's web address, e.g. `https://blacksky.community`. */
  url: string;
  name?: string;
  /** Id in Aturi's waypoint catalog, when the client is a catalog entry. */
  waypoint?: string;
  templates?: ClientLinkTemplates;
};

export type ClientPreference = {
  category: string;
  /** Any device, unless `mobile` or `desktop` applies. */
  client?: DeclaredClient;
  mobile?: DeclaredClient;
  desktop?: DeclaredClient;
};

export type PreferredClientsRecord = {
  $type: typeof PREFERRED_CLIENTS_NSID;
  preferences: ClientPreference[];
  updatedAt?: string;
};

/**
 * What a link points at. A `ParsedURI` fits, and so does anything carrying
 * the same fields. `handle` may hold a DID when no handle is known, which is
 * how the catalog's own `getUrl` is called too.
 */
export type ClientLinkTarget = {
  handle?: string;
  did?: string;
  collection?: string;
  rkey?: string;
};

// Limits from the lexicon. A record over them is still read, trimmed to fit,
// rather than refused: it is the viewer's own declaration, and dropping it
// whole for one oversized field would throw away the parts that are fine.
const MAX_PREFERENCES = 32;
const MAX_CATEGORY_LENGTH = 64;
const MAX_URL_LENGTH = 512;
const MAX_NAME_LENGTH = 640;
const MAX_WAYPOINT_LENGTH = 128;
const MAX_TEMPLATE_LENGTH = 1024;

const TEMPLATE_KINDS: readonly ClientLinkTemplateKind[] = ['profile', 'post', 'list', 'record'];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    ? value
    : undefined;
}

/**
 * Whether a string is an absolute http(s) URL. Everything a declaration
 * produces is checked against this before it is handed back, because the
 * record is writable by anything holding a token for the account's PDS and
 * readers put the result straight into an `href`. It is what keeps
 * `javascript:` and `data:` out.
 */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseTemplates(value: unknown): ClientLinkTemplates | undefined {
  if (!isObject(value)) return undefined;
  const out: ClientLinkTemplates = {};
  for (const kind of TEMPLATE_KINDS) {
    const template = boundedString(value[kind], MAX_TEMPLATE_LENGTH);
    if (template) out[kind] = template;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseClient(value: unknown): DeclaredClient | undefined {
  if (!isObject(value)) return undefined;
  const url = boundedString(value.url, MAX_URL_LENGTH);
  if (!url || !isHttpUrl(url)) return undefined;
  const client: DeclaredClient = { url };
  const name = boundedString(value.name, MAX_NAME_LENGTH);
  if (name) client.name = name;
  const waypoint = boundedString(value.waypoint, MAX_WAYPOINT_LENGTH);
  if (waypoint) client.waypoint = waypoint;
  const templates = parseTemplates(value.templates);
  if (templates) client.templates = templates;
  return client;
}

function parsePreference(value: unknown): ClientPreference | null {
  if (!isObject(value)) return null;
  const category = boundedString(value.category, MAX_CATEGORY_LENGTH);
  if (!category) return null;
  const preference: ClientPreference = { category };
  const client = parseClient(value.client);
  if (client) preference.client = client;
  for (const platform of CLIENT_PLATFORMS) {
    const forPlatform = parseClient(value[platform]);
    if (forPlatform) preference[platform] = forPlatform;
  }
  return hasAnyClient(preference) ? preference : null;
}

function hasAnyClient(preference: ClientPreference): boolean {
  return Boolean(preference.client || preference.mobile || preference.desktop);
}

/**
 * Read a `to.aturi.client.declaration` record value (what `getRecord`
 * returns as `value`) into a typed declaration. Returns null when the value
 * isn't one at all: not an object, another `$type`, or no `preferences`
 * array. Malformed entries inside an otherwise valid record are dropped one
 * by one, as are clients whose `url` isn't http(s), so whatever comes back
 * is safe to act on.
 */
export function parsePreferredClients(value: unknown): PreferredClientsRecord | null {
  if (!isObject(value)) return null;
  if (value.$type !== undefined && value.$type !== PREFERRED_CLIENTS_NSID) return null;
  if (!Array.isArray(value.preferences)) return null;
  const preferences: ClientPreference[] = [];
  for (const raw of value.preferences.slice(0, MAX_PREFERENCES)) {
    const preference = parsePreference(raw);
    if (preference) preferences.push(preference);
  }
  const record: PreferredClientsRecord = { $type: PREFERRED_CLIENTS_NSID, preferences };
  if (typeof value.updatedAt === 'string') record.updatedAt = value.updatedAt;
  return record;
}

/**
 * The client a declaration names for one category and device.
 *
 * Takes the first entry for the category, as the lexicon says to. With a
 * `platform`, that platform's client wins when one is declared and `client`
 * is the fallback; without one, only `client` counts, because a reader that
 * doesn't know the device has no business guessing between the other two.
 * Accepts null for the common "this account has no declaration" case.
 */
export function getPreferredClient(
  record: PreferredClientsRecord | null | undefined,
  category: string,
  options: { platform?: ClientPlatform } = {},
): DeclaredClient | null {
  const entry = record?.preferences.find((p) => p.category === category);
  if (!entry) return null;
  if (options.platform && entry[options.platform]) return entry[options.platform] ?? null;
  return entry.client ?? null;
}

/**
 * Percent-encode a substituted value, keeping `:` literal. Colons are legal
 * in a URL path segment, and DIDs read far better with them left in.
 */
function encodeTemplateValue(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ':');
}

const PLACEHOLDER = /\{(handle|did|actor|collection|rkey)\}/g;

/**
 * Fill a link template. Returns null when a placeholder has no value to fill
 * it with, rather than a URL with a hole in it.
 *
 * `{handle}` falls back to the DID, matching how the catalog's `getUrl` is
 * called when no handle is known, and every client that takes a handle in
 * its URLs accepts a DID in the same place. `{did}` has no fallback, since
 * the templates that name it do so because a handle won't work there.
 * `{actor}` is the reverse of `{handle}`: the DID, else the handle.
 *
 * Substitution is a single pass, so a value that happens to contain `{rkey}`
 * is never expanded a second time.
 */
function expandLinkTemplate(template: string, target: ClientLinkTarget): string | null {
  const values: Record<string, string | undefined> = {
    handle: target.handle || target.did,
    did: target.did,
    actor: target.did || target.handle,
    collection: target.collection,
    rkey: target.rkey,
  };
  let missing = false;
  const out = template.replace(PLACEHOLDER, (_, name: string) => {
    const value = values[name];
    if (!value) {
      missing = true;
      return '';
    }
    return encodeTemplateValue(value);
  });
  return missing ? null : out;
}

/**
 * Which templates can open a target, best first. A post or list prefers its
 * own template and falls back to the generic record one; any other record has
 * only the generic one; no record at all means the profile.
 *
 * There is deliberately no fall back to the profile for a record. A "view
 * post" link that lands on the author's profile is wrong in a way the reader
 * can't see, and returning null lets them use their own default instead.
 */
function templateKindsFor(target: ClientLinkTarget): ClientLinkTemplateKind[] {
  if (target.collection && target.rkey) {
    if (target.collection === 'app.bsky.feed.post') return ['post', 'record'];
    if (target.collection === 'app.bsky.graph.list') return ['list', 'record'];
    return ['record'];
  }
  return ['profile'];
}

function targetFromAtUri(uri: string): ClientLinkTarget | null {
  const match = parseAtUri(uri);
  if (!match) return null;
  const { handle, did, collection, rkey } = match.parsed;
  return { handle, did, collection, rkey };
}

/**
 * The URL that opens `target` in a declared client, or null when the client
 * can't open it.
 *
 * `target` is an AT URI string (`at://did:plc:…/app.bsky.feed.post/…`) or
 * a `ClientLinkTarget`. Pass the DID when you have it: explorer templates
 * tend to need one.
 *
 * The record's own templates come first. When it leaves a kind out and names
 * a catalog waypoint, the catalog's template for that kind fills the gap, so
 * a declaration written by an app that only recorded a profile link still
 * opens posts. Whatever comes out must be an http(s) URL, or the next
 * candidate is tried.
 */
export function getPreferredClientUrl(
  client: DeclaredClient,
  target: string | ClientLinkTarget,
): string | null {
  const resolved = typeof target === 'string' ? targetFromAtUri(target) : target;
  if (!resolved) return null;
  const catalog = client.waypoint ? getWaypointLinkTemplates(client.waypoint) : null;
  for (const kind of templateKindsFor(resolved)) {
    for (const template of [client.templates?.[kind], catalog?.[kind]]) {
      if (!template) continue;
      const url = expandLinkTemplate(template, resolved);
      if (url && isHttpUrl(url)) return url;
    }
  }
  return null;
}

/**
 * Build a declaration ready for `putRecord`: stamps `$type` and `updatedAt`,
 * keeps the first entry per category, and drops entries that declare no
 * client, so what is written always reads back the same.
 */
export function buildPreferredClientsRecord(
  preferences: readonly ClientPreference[],
  now: Date = new Date(),
): PreferredClientsRecord {
  const seen = new Set<string>();
  const kept: ClientPreference[] = [];
  for (const preference of preferences) {
    if (seen.has(preference.category) || !hasAnyClient(preference)) continue;
    seen.add(preference.category);
    kept.push(preference);
    if (kept.length === MAX_PREFERENCES) break;
  }
  return {
    $type: PREFERRED_CLIENTS_NSID,
    preferences: kept,
    updatedAt: now.toISOString(),
  };
}

// --- Templates from the catalog --------------------------------------------

/**
 * Probe values for reading templates back out of a waypoint's `getUrl`. Each
 * one is distinct and none contains another, so every occurrence in a probed
 * URL can be swapped for its placeholder without ambiguity. Anything that
 * still says "probe" afterwards came from somewhere the swap didn't reach,
 * and that template is discarded.
 */
const PROBE = {
  handle: 'handle-probe.invalid',
  did: 'did:plc:didprobe',
  collection: 'invalid.collection.probe',
  rkey: 'rkeyprobe',
};

/**
 * A second, ordinary-looking target, used to check a derived template by
 * expanding it and comparing against what `getUrl` builds for the same input.
 */
const CHECK = {
  handle: 'alice.example.com',
  did: 'did:plc:abc234def567',
  collection: 'com.example.note',
  rkey: '3kcheckrkey2',
};

/** The collection a template kind is probed with; `record` uses the probe's own. */
const FIXED_COLLECTION: Partial<Record<ClientLinkTemplateKind, string>> = {
  post: 'app.bsky.feed.post',
  list: 'app.bsky.graph.list',
};

function swapAll(source: string, find: string, replacement: string): string {
  return source.split(find).join(replacement);
}

function tokenizeProbe(url: string): string | null {
  let out = url;
  out = swapAll(out, PROBE.did, '{did}');
  out = swapAll(out, encodeURIComponent(PROBE.did), '{did}');
  out = swapAll(out, PROBE.handle, '{handle}');
  out = swapAll(out, PROBE.collection, '{collection}');
  out = swapAll(out, PROBE.rkey, '{rkey}');
  return /probe/i.test(out) ? null : out;
}

function callGetUrl(
  waypoint: WaypointData,
  kind: ClientLinkTemplateKind,
  target: { handle: string; did?: string; collection: string; rkey: string },
): string | null {
  if (kind === 'profile') return waypoint.getUrl(target.handle, undefined, undefined, target.did);
  const collection = FIXED_COLLECTION[kind] ?? target.collection;
  return waypoint.getUrl(target.handle, collection, target.rkey, target.did);
}

/**
 * Read one template kind back out of a waypoint's URL builder, or null when
 * the builder doesn't produce a faithful one.
 *
 * A template has to actually address what its kind says: a record template
 * that never mentions `{collection}` is a builder falling back to the
 * profile for collections it doesn't render, and declaring that as a record
 * link would send people to the wrong page. It also has to agree with
 * `getUrl` on an input it wasn't derived from, which catches builders that
 * branch on the value rather than just placing it.
 *
 * A builder that uses the DID when given one and the handle otherwise is
 * written as `{actor}`, so the template keeps that fallback.
 */
function deriveTemplate(waypoint: WaypointData, kind: ClientLinkTemplateKind): string | null {
  const withDid = callGetUrl(waypoint, kind, PROBE);
  if (!withDid) return null;
  let template = tokenizeProbe(withDid);
  if (!template) return null;

  if (template.includes('{did}')) {
    const withoutDid = callGetUrl(waypoint, kind, { ...PROBE, did: undefined });
    const handleOnly = withoutDid ? tokenizeProbe(withoutDid) : null;
    if (handleOnly === swapAll(template, '{did}', '{handle}')) {
      template = swapAll(template, '{did}', '{actor}');
    }
  }

  const derived = template;
  const required =
    kind === 'profile' ? [] : kind === 'record' ? ['{collection}', '{rkey}'] : ['{rkey}'];
  if (!required.every((token) => derived.includes(token))) return null;
  if (!/\{(handle|did|actor)\}/.test(derived)) return null;

  const checks = derived.includes('{actor}') ? [CHECK, { ...CHECK, did: undefined }] : [CHECK];
  for (const check of checks) {
    const expected = callGetUrl(waypoint, kind, check);
    const actual = expandLinkTemplate(derived, {
      ...check,
      collection: FIXED_COLLECTION[kind] ?? check.collection,
    });
    if (!expected || actual !== expected || !isHttpUrl(actual)) return null;
  }
  return derived;
}

const templateCache = new Map<string, ClientLinkTemplates | null>();

/**
 * URL templates for a catalog waypoint, in the form a declaration stores
 * them, or null for an unknown id or one with no derivable template.
 *
 * Derived from the waypoint's `getUrl` rather than kept by hand beside it, so
 * the two can't drift. Only kinds the waypoint supports are derived, and only
 * templates that reproduce `getUrl` exactly are kept (see `deriveTemplate`).
 */
export function getWaypointLinkTemplates(waypointId: string): ClientLinkTemplates | null {
  const cached = templateCache.get(waypointId);
  if (cached !== undefined) return cached;
  const waypoint = WAYPOINT_DESTINATIONS_DATA[waypointId];
  let templates: ClientLinkTemplates | null = null;
  if (waypoint) {
    const derived: ClientLinkTemplates = {};
    for (const kind of TEMPLATE_KINDS) {
      if (!waypoint.supportedTypes.includes(kind)) continue;
      const template = deriveTemplate(waypoint, kind);
      if (template) derived[kind] = template;
    }
    if (Object.keys(derived).length > 0) templates = derived;
  }
  templateCache.set(waypointId, templates);
  return templates;
}

/**
 * A catalog waypoint as a declared client: its name, its id, its templates,
 * and its origin as `url`. Null for an unknown id, or for one whose links
 * can't be written as templates, since a client a reader can't link to is
 * not worth declaring.
 */
export function clientFromWaypoint(waypointId: string): DeclaredClient | null {
  const waypoint = WAYPOINT_DESTINATIONS_DATA[waypointId];
  const templates = getWaypointLinkTemplates(waypointId);
  if (!waypoint || !templates) return null;
  const sample = TEMPLATE_KINDS.map((kind) => templates[kind])
    .map((template) => (template ? expandLinkTemplate(template, CHECK) : null))
    .find((url): url is string => Boolean(url));
  if (!sample) return null;
  return {
    url: new URL(sample).origin,
    name: waypoint.name,
    waypoint: waypoint.id,
    templates,
  };
}

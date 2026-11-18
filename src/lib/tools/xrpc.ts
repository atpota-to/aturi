/**
 * The XRPC console's logic: which methods it lists, what a method's
 * parameters are, where a request goes, and how a request is written into a
 * link and read back out.
 *
 * Everything here is pure. The page (XrpcConsole.tsx) loads the method index,
 * looks up lexicons, resolves an account's PDS and sends the request; this
 * says what to do with what came back.
 *
 * Queries only. A procedure writes, needs a signed-in session and takes a
 * body, and the site's keyless tools do none of that; a subscription is a
 * WebSocket, which the stream monitor already covers. Both are left out of
 * the list rather than shown as things the console cannot run.
 */

import { APPVIEW, RELAY } from '@/utils/atproto/config';

/** The part of an API manifest entry (src/lib/mcp/apiManifest.ts) the console reads. */
export type XrpcMethod = {
  nsid: string;
  type: string;
  description: string;
  /** Parameter names, without their types. */
  params: string[];
  /** Where the lexicon was indexed from. Empty for a method typed in by hand. */
  raw: string;
};

/* -------------------------------------------------------------------------- *
 * NSIDs
 * -------------------------------------------------------------------------- */

const NSID_SHAPE = /^[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

/** Whether `value` could name an XRPC method: three or more segments, the last one a name. */
export function looksLikeMethodNsid(value: string): boolean {
  if (value.length > 317 || !NSID_SHAPE.test(value)) return false;
  const segments = value.split('.');
  return segments.length >= 3 && /^[a-zA-Z][a-zA-Z0-9]*$/.test(segments[segments.length - 1]);
}

/** `app.bsky.feed.getAuthorFeed` → `app.bsky.feed`. */
export function namespaceOf(nsid: string): string {
  const cut = nsid.lastIndexOf('.');
  return cut === -1 ? nsid : nsid.slice(0, cut);
}

/** `app.bsky.feed.getAuthorFeed` → `app.bsky`, the family a namespace filter picks. */
export function familyOf(nsid: string): string {
  return nsid.split('.').slice(0, 2).join('.');
}

/** `app.bsky.feed.getAuthorFeed` → `getAuthorFeed`. */
export function nameOf(nsid: string): string {
  return nsid.slice(nsid.lastIndexOf('.') + 1);
}

/* -------------------------------------------------------------------------- *
 * The method list
 * -------------------------------------------------------------------------- */

/** The queries in a manifest, in NSID order. */
export function queriesFrom(methods: XrpcMethod[]): XrpcMethod[] {
  return methods.filter((method) => method.type === 'query').sort((a, b) => a.nsid.localeCompare(b.nsid));
}

export type MethodGroup = { namespace: string; methods: XrpcMethod[] };

/** Methods by namespace (`app.bsky.feed`), each group and the groups themselves in order. */
export function groupMethods(methods: XrpcMethod[]): MethodGroup[] {
  const groups = new Map<string, XrpcMethod[]>();
  for (const method of methods) {
    const namespace = namespaceOf(method.nsid);
    const group = groups.get(namespace);
    if (group) group.push(method);
    else groups.set(namespace, [method]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, list]) => ({ namespace, methods: list }));
}

/** The families present in a list (`app.bsky`, `com.atproto`, …), in order. */
export function familiesOf(methods: XrpcMethod[]): string[] {
  return [...new Set(methods.map((method) => familyOf(method.nsid)))].sort();
}

/**
 * Methods matching what was typed, best first.
 *
 * Every word has to appear somewhere in the NSID or the description. The
 * method's own name counts most, because that is what people remember
 * ("getProfile", "listRecords"), then the rest of the NSID, then the
 * description, which is how a method is found by what it does.
 */
export function searchMethods(methods: XrpcMethod[], query: string, limit = 50): XrpcMethod[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return methods.slice(0, limit);

  const scored: { method: XrpcMethod; score: number }[] = [];
  for (const method of methods) {
    const nsid = method.nsid.toLowerCase();
    const name = nameOf(nsid);
    const description = method.description.toLowerCase();
    let score = 0;
    let matched = true;
    for (const word of words) {
      if (nsid === word) score += 100;
      else if (name === word) score += 60;
      else if (name.startsWith(word)) score += 40;
      else if (name.includes(word)) score += 25;
      else if (nsid.includes(word)) score += 15;
      else if (description.includes(word)) score += 5;
      else {
        matched = false;
        break;
      }
    }
    if (matched) scored.push({ method, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.method.nsid.localeCompare(b.method.nsid))
    .slice(0, limit)
    .map((entry) => entry.method);
}

/* -------------------------------------------------------------------------- *
 * Parameters
 * -------------------------------------------------------------------------- */

export type XrpcParamKind = 'string' | 'integer' | 'boolean' | 'array' | 'unknown';

export type XrpcParamSpec = {
  name: string;
  kind: XrpcParamKind;
  /** For an array, what each item is. */
  itemKind?: Exclude<XrpcParamKind, 'array'>;
  required: boolean;
  description?: string;
  /** The lexicon's default, as it would be typed. */
  defaultValue?: string;
  /** A closed set: nothing else is accepted. */
  enumValues?: string[];
  /** An open set: these are suggestions. */
  knownValues?: string[];
  /** A string's format (`at-identifier`, `nsid`, `datetime`, …). */
  format?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  /** Not one of the method's own parameters: it came with the link, or was added by hand. */
  extra?: boolean;
};

export type XrpcParamSet = {
  specs: XrpcParamSpec[];
  /**
   * `lexicon`: read from the method's lexicon, so types and required-ness
   * are known. `names`: only the names are known, and every field is text.
   */
  source: 'lexicon' | 'names';
};

type LexiconProperty = {
  type?: unknown;
  description?: unknown;
  default?: unknown;
  enum?: unknown;
  knownValues?: unknown;
  format?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  maxLength?: unknown;
  items?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof item));
  return list.length ? list.map(String) : undefined;
}

function kindOf(type: unknown): XrpcParamKind {
  return type === 'string' || type === 'integer' || type === 'boolean' || type === 'array' ? type : 'unknown';
}

/** The `main` definition of a lexicon document, when it has one. */
function mainDef(doc: unknown): Record<string, unknown> | null {
  if (!isObject(doc) || !isObject(doc.defs) || !isObject(doc.defs.main)) return null;
  return doc.defs.main;
}

/**
 * A method's parameters, from its lexicon when one is in hand.
 *
 * Required parameters come first, in the order the lexicon lists them as
 * required, then the rest alphabetically: published lexicon records have
 * their keys sorted, so the document's own order says nothing.
 *
 * Without a lexicon the names alone are used and every field is free text,
 * which still lets a request be made; the host reports what it did not like.
 */
export function paramSetFromLexicon(doc: unknown, fallbackNames: string[]): XrpcParamSet {
  const main = mainDef(doc);
  if (!main) {
    return {
      source: 'names',
      specs: fallbackNames.map((name) => ({ name, kind: 'unknown', required: false })),
    };
  }
  const parameters = isObject(main.parameters) ? main.parameters : {};
  const properties = isObject(parameters.properties) ? parameters.properties : {};
  const required = Array.isArray(parameters.required)
    ? parameters.required.filter((name): name is string => typeof name === 'string')
    : [];

  const specs: XrpcParamSpec[] = Object.entries(properties).map(([name, raw]) => {
    const property: LexiconProperty = isObject(raw) ? raw : {};
    const kind = kindOf(property.type);
    const items: LexiconProperty = isObject(property.items) ? property.items : {};
    const source = kind === 'array' ? items : property;
    const itemKind = kindOf(items.type);
    return {
      name,
      kind,
      itemKind: kind === 'array' && itemKind !== 'array' ? itemKind : undefined,
      required: required.includes(name),
      description: typeof property.description === 'string' ? property.description : undefined,
      defaultValue:
        property.default === undefined || isObject(property.default) || Array.isArray(property.default)
          ? undefined
          : String(property.default),
      enumValues: stringList(source.enum),
      knownValues: stringList(source.knownValues),
      format: typeof source.format === 'string' ? source.format : undefined,
      minimum: typeof property.minimum === 'number' ? property.minimum : undefined,
      maximum: typeof property.maximum === 'number' ? property.maximum : undefined,
      maxLength: typeof property.maxLength === 'number' ? property.maxLength : undefined,
    };
  });

  const rank = (spec: XrpcParamSpec) => (spec.required ? required.indexOf(spec.name) : required.length);
  specs.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { source: 'lexicon', specs };
}

export type LexiconSummary = {
  /** `query`, `procedure`, `record`, … or null when the document has no main definition. */
  type: string | null;
  description: string | null;
  /** The response's media type. Null when the method returns nothing or does not say. */
  outputEncoding: string | null;
  /** The errors the method names, for reading a failure. */
  errors: { name: string; description?: string }[];
};

export function summarizeMethodLexicon(doc: unknown): LexiconSummary {
  const main = mainDef(doc);
  if (!main) return { type: null, description: null, outputEncoding: null, errors: [] };
  const output = isObject(main.output) ? main.output : {};
  const errors = Array.isArray(main.errors)
    ? main.errors
        .filter(isObject)
        .filter((entry) => typeof entry.name === 'string')
        .map((entry) => ({
          name: entry.name as string,
          description: typeof entry.description === 'string' ? entry.description : undefined,
        }))
    : [];
  return {
    type: typeof main.type === 'string' ? main.type : null,
    description: typeof main.description === 'string' ? main.description : null,
    outputEncoding: typeof output.encoding === 'string' ? output.encoding : null,
    errors,
  };
}

/** Parameter values as the console holds them: every value a list, so an array needs no second shape. */
export type XrpcParamValues = Record<string, string[]>;

/**
 * The fields to draw: the method's parameters, then any other name that has
 * a value. A link can carry a parameter the lexicon does not list, and it is
 * sent, so it has to be on the page where it can be seen and removed.
 */
export function withExtraParams(specs: XrpcParamSpec[], values: XrpcParamValues): XrpcParamSpec[] {
  const known = new Set(specs.map((spec) => spec.name));
  const extras = Object.keys(values)
    .filter((name) => !known.has(name))
    .sort()
    .map((name): XrpcParamSpec => ({ name, kind: 'unknown', required: false, extra: true }));
  return extras.length ? [...specs, ...extras] : specs;
}

/** Whether `name` can be a parameter name: what a lexicon would allow as a property key. */
export function isParamName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name);
}

/** The values worth sending: trimmed, with empty ones dropped. */
export function cleanValues(values: XrpcParamValues): XrpcParamValues {
  const out: XrpcParamValues = {};
  for (const [name, list] of Object.entries(values)) {
    const kept = list.map((value) => value.trim()).filter(Boolean);
    if (kept.length) out[name] = kept;
  }
  return out;
}

/** Required parameters that have no value yet. */
export function missingRequired(specs: XrpcParamSpec[], values: XrpcParamValues): string[] {
  const clean = cleanValues(values);
  return specs.filter((spec) => spec.required && !clean[spec.name]).map((spec) => spec.name);
}

/* -------------------------------------------------------------------------- *
 * Where a request goes
 * -------------------------------------------------------------------------- */

export type HostChoice = 'appview' | 'pds' | 'relay' | 'other';

export const HOST_CHOICES: { value: HostChoice; label: string; hint: string }[] = [
  { value: 'appview', label: 'AppView', hint: `Bluesky’s public AppView, ${hostnameOf(APPVIEW)}` },
  { value: 'pds', label: 'PDS', hint: 'The PDS that hosts an account' },
  { value: 'relay', label: 'Relay', hint: `Bluesky’s relay, ${hostnameOf(RELAY)}` },
  { value: 'other', label: 'Other', hint: 'Any host that serves XRPC' },
];

function hostnameOf(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

export function isHostChoice(value: string): value is HostChoice {
  return value === 'appview' || value === 'pds' || value === 'relay' || value === 'other';
}

/**
 * Relay-side methods under com.atproto.sync: they describe the hosts a relay
 * crawls, which a PDS has no answer for. The rest of the namespace is served
 * by a PDS (and mirrored by a relay), so it defaults to the PDS.
 */
const RELAY_METHODS = new Set([
  'com.atproto.sync.getHostStatus',
  'com.atproto.sync.listHosts',
  'com.atproto.sync.listReposByCollection',
]);

/**
 * Where a method is most likely to be answered.
 *
 * `app.bsky.*` is the AppView's own API, except the two methods a feed
 * generator serves. Identity lookups are answered by the AppView too. The
 * repo, sync and server namespaces belong to a PDS. Everything else (a
 * labeler's `com.atproto.label.*`, Ozone, chat, a lexicon this index has
 * never seen) lives on a service only its caller can name.
 */
export function defaultHostFor(nsid: string): HostChoice {
  if (RELAY_METHODS.has(nsid)) return 'relay';
  if (nsid === 'app.bsky.feed.getFeedSkeleton' || nsid === 'app.bsky.feed.describeFeedGenerator') return 'other';
  if (nsid.startsWith('app.bsky.')) return 'appview';
  if (nsid.startsWith('com.atproto.identity.')) return 'appview';
  if (/^com\.atproto\.(repo|sync|server)\./.test(nsid)) return 'pds';
  return 'other';
}

export type HostUrl = { ok: true; origin: string } | { ok: false; reason: string };

/**
 * Tidy a typed host into an origin. A bare name gets https. Plain http is
 * kept only for this machine, which is where a PDS under development runs
 * and the one place a browser will send it from a secure page.
 */
export function normalizeHostUrl(raw: string): HostUrl {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter the host to send the request to, such as pds.example.com.' };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, reason: 'That is not a host name or URL.' };
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol === 'http:' && !local) {
    return { ok: false, reason: 'Use https. A browser will not send this request over plain http.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'XRPC is served over https.' };
  }
  if (url.username || url.password) return { ok: false, reason: 'Leave credentials out of the host.' };
  return { ok: true, origin: url.origin };
}

/* -------------------------------------------------------------------------- *
 * A request, in the link
 * -------------------------------------------------------------------------- */

/**
 * One request, as the query string holds it:
 *
 *   ?method=app.bsky.feed.getPosts&host=appview&p.uris=at://…&p.uris=at://…
 *
 * `acct` is the account whose PDS to ask (host `pds`) and `url` the host
 * typed for `other`. Parameters carry a `p.` prefix so a method's own names
 * (`method`, `host` and `url` are all plausible ones) cannot collide with
 * the console's.
 */
export type ConsoleRequest = {
  method: string;
  host: HostChoice;
  acct: string;
  url: string;
  params: XrpcParamValues;
};

const PARAM_PREFIX = 'p.';

export function requestFromSearch(search: URLSearchParams): ConsoleRequest {
  const method = (search.get('method') ?? '').trim();
  const host = search.get('host') ?? '';
  const params: XrpcParamValues = {};
  for (const [key, value] of search.entries()) {
    if (!key.startsWith(PARAM_PREFIX) || key.length === PARAM_PREFIX.length) continue;
    (params[key.slice(PARAM_PREFIX.length)] ??= []).push(value);
  }
  return {
    method,
    host: isHostChoice(host) ? host : defaultHostFor(method),
    acct: (search.get('acct') ?? '').trim(),
    url: (search.get('url') ?? '').trim(),
    params,
  };
}

/**
 * The query string for a request. The host is written only when it is not
 * the method's default, and `acct` and `url` only for the host that reads
 * them, so the common link is the method and its parameters and nothing
 * else.
 */
export function requestToSearch(request: ConsoleRequest): string {
  const search = new URLSearchParams();
  if (!request.method) return '';
  search.set('method', request.method);
  if (request.host !== defaultHostFor(request.method)) search.set('host', request.host);
  if (request.host === 'pds' && request.acct) search.set('acct', request.acct);
  if (request.host === 'other' && request.url) search.set('url', request.url);
  const params = cleanValues(request.params);
  for (const name of Object.keys(params).sort()) {
    for (const value of params[name]) search.append(`${PARAM_PREFIX}${name}`, value);
  }
  return search.toString();
}

/**
 * The account whose PDS a `pds` request goes to: the one named, or failing
 * that the repository the request is about, since a read of a repo is
 * answered by the PDS that hosts it.
 */
export function pdsAccountFor(request: Pick<ConsoleRequest, 'acct' | 'params'>): string | null {
  if (request.acct) return request.acct.replace(/^@/, '');
  const clean = cleanValues(request.params);
  for (const name of ['repo', 'did', 'actor']) {
    const value = clean[name]?.[0];
    if (value) return value.replace(/^@/, '');
  }
  return null;
}

/**
 * Whether a request arriving by link can be sent without asking: it names a
 * method, every required parameter has a value, and there is a host to send
 * it to. Needs the lexicon; with only parameter names nothing is known to be
 * required, so nothing is assumed complete.
 */
export function isComplete(request: ConsoleRequest, paramSet: XrpcParamSet | null): boolean {
  if (!request.method || !paramSet || paramSet.source !== 'lexicon') return false;
  if (missingRequired(paramSet.specs, request.params).length > 0) return false;
  if (request.host === 'pds') return pdsAccountFor(request) !== null;
  if (request.host === 'other') return normalizeHostUrl(request.url).ok;
  return true;
}

/* -------------------------------------------------------------------------- *
 * The request itself
 * -------------------------------------------------------------------------- */

/**
 * The URL a request is sent to. Parameters go in the lexicon's order when it
 * is known, then any others by name; an array repeats its key, which is how
 * XRPC spells a list.
 */
export function buildRequestUrl(
  origin: string,
  nsid: string,
  values: XrpcParamValues,
  specs: XrpcParamSpec[] = [],
): string {
  const clean = cleanValues(values);
  const known = specs.map((spec) => spec.name).filter((name) => clean[name]);
  const extra = Object.keys(clean)
    .filter((name) => !known.includes(name))
    .sort();
  const search = new URLSearchParams();
  for (const name of [...known, ...extra]) {
    for (const value of clean[name]) search.append(name, value);
  }
  const query = search.toString();
  return `${origin.replace(/\/$/, '')}/xrpc/${nsid}${query ? `?${query}` : ''}`;
}

/** The same request for a terminal. Single-quoted, so the shell leaves `&` and `?` alone. */
export function curlFor(url: string): string {
  return `curl '${url.replace(/'/g, `'\\''`)}'`;
}

/** The static host for a choice, or null when it has to be resolved or typed. */
export function fixedOriginFor(host: HostChoice): string | null {
  if (host === 'appview') return APPVIEW;
  if (host === 'relay') return RELAY;
  return null;
}

/* -------------------------------------------------------------------------- *
 * The response
 * -------------------------------------------------------------------------- */

/** Whether a media type is one the console shows as text: JSON, or anything textual. */
export function isTextual(contentType: string | null): boolean {
  if (!contentType) return true;
  return /json|^text\//i.test(contentType);
}

export type XrpcFailure = { error: string; message: string | null };

/** The `{ error, message }` an XRPC host answers a failure with, when the body is one. */
export function readXrpcFailure(body: unknown): XrpcFailure | null {
  if (!isObject(body) || typeof body.error !== 'string') return null;
  return { error: body.error, message: typeof body.message === 'string' && body.message ? body.message : null };
}

/** The cursor a page of results hands back for the next one. */
export function nextCursor(body: unknown): string | null {
  return isObject(body) && typeof body.cursor === 'string' && body.cursor ? body.cursor : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

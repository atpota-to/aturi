/**
 * `to.aturi.actor.preferredClients` — a public, cross-app declaration of which
 * Atmosphere client interfaces an account wants records opened in.
 *
 * The ecosystem default is to link every `app.bsky.feed.post` to bsky.app,
 * which is a guess about the reader that is often wrong. This record replaces
 * the guess with an answer the reader wrote down themselves: "Bluesky posts in
 * Blacksky, Tangled records in Tangled, everything else in PDSls." Any app that
 * links out to Atmosphere records and knows who it's linking on behalf of can
 * read the record for that account and honor it.
 *
 * Schema: `lexicons/to/aturi/actor/preferredClients.json`.
 *
 * This module is deliberately dependency-free and isomorphic — it is the
 * canonical copy behind `@aturi.to/waypoints` (see
 * `packages/waypoints/scripts/sync.mjs`), so it must keep building outside the
 * Next.js app.
 */

import {
  DID_REQUIRED_WAYPOINTS,
  WAYPOINT_DESTINATIONS_DATA,
  type WaypointType,
} from './waypoints.data';
import { upstreamFetch } from './upstreamFetch';
import { resolvePdsEndpoint } from './didResolver';

export const PREFERRED_CLIENTS_NSID = 'to.aturi.actor.preferredClients';
export const PREFERRED_CLIENTS_RKEY = 'self';

/** Record kinds a rule can be scoped to, alongside NSIDs and `*`. */
export const PREFERRED_CLIENT_KINDS: readonly WaypointType[] = [
  'post',
  'profile',
  'list',
  'record',
];

/** Scope that matches every record. */
export const PREFERRED_SCOPE_ALL = '*';

// Mirrors the lexicon's maxLength constraints. Enforced on read too: the
// record lives in someone else's repo and can say anything.
const MAX_RULES = 100;
const MAX_CLIENTS_PER_RULE = 10;
const MAX_SCOPE_LENGTH = 253;

/**
 * URL templates for a client that isn't in the shared waypoint catalog (or a
 * self-hosted deploy of one that is). Placeholders: `{handle}`, `{did}`,
 * `{actor}`, `{collection}`, `{rkey}`.
 */
export type PreferredClientTemplates = Partial<Record<WaypointType, string>>;

export type PreferredClient = {
  /** Waypoint id in the shared catalog, e.g. `blacksky`. */
  id?: string;
  name: string;
  homepage?: string;
  templates?: PreferredClientTemplates;
};

export type PreferredClientRule = {
  /**
   * An NSID (`app.bsky.feed.post`), an NSID namespace wildcard
   * (`app.bsky.*`), a record kind (`post` | `profile` | `list` | `record`),
   * or `*`.
   */
  scope: string;
  /** Most preferred first. */
  clients: PreferredClient[];
};

export type PreferredClientsRecord = {
  preferences: PreferredClientRule[];
  createdAt?: string;
  updatedAt?: string;
};

/** What a link is being built for. */
export type PreferredClientTarget = {
  type: WaypointType;
  handle: string;
  did?: string;
  collection?: string;
  rkey?: string;
};

/** A resolved preference: which client won, and where it points. */
export type PreferredClientMatch = {
  /** The `scope` of the rule that matched — useful for explaining the choice. */
  scope: string;
  client: PreferredClient;
  /** Catalog waypoint id, when the client is one Aturi knows about. */
  waypointId: string | null;
  url: string;
};

// --- Parsing ---------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function parseTemplates(input: unknown): PreferredClientTemplates | undefined {
  if (!isPlainObject(input)) return undefined;
  const out: PreferredClientTemplates = {};
  for (const kind of PREFERRED_CLIENT_KINDS) {
    const value = input[kind];
    // A non-string here would crash template expansion (String.split) and take
    // the whole picker with it, so drop anything that isn't a string.
    if (typeof value === 'string' && value.trim()) out[kind] = value.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseClient(input: unknown): PreferredClient | null {
  if (!isPlainObject(input)) return null;
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : undefined;
  const templates = parseTemplates(input.templates);
  const rawName = typeof input.name === 'string' ? input.name.trim() : '';
  // `name` is required by the lexicon, but a record missing it is still usable
  // when it names a catalog client — fall back to the catalog's display name
  // rather than dropping the user's preference over a cosmetic field.
  const name = rawName || (id ? WAYPOINT_DESTINATIONS_DATA[id]?.name : undefined);
  if (!name) return null;
  // A client we can't build any link for is dead weight.
  if (!id && !templates) return null;
  const homepage =
    typeof input.homepage === 'string' && /^https?:\/\//i.test(input.homepage.trim())
      ? input.homepage.trim()
      : undefined;
  return { ...(id ? { id } : {}), name, ...(homepage ? { homepage } : {}), ...(templates ? { templates } : {}) };
}

/**
 * True for a scope string this implementation understands: `*`, a record kind,
 * an NSID, or an NSID namespace wildcard (`app.bsky.*`).
 */
export function isValidPreferredScope(scope: unknown): scope is string {
  if (typeof scope !== 'string') return false;
  const s = scope.trim();
  if (!s || s.length > MAX_SCOPE_LENGTH) return false;
  if (s === PREFERRED_SCOPE_ALL) return true;
  if ((PREFERRED_CLIENT_KINDS as readonly string[]).includes(s)) return true;
  const isWildcard = s.endsWith('.*');
  const body = isWildcard ? s.slice(0, -2) : s;
  const segments = body.split('.');
  // A bare NSID needs three segments (`app.bsky.post`); a wildcard prefix only
  // needs two, so `app.bsky.*` can cover a whole app.
  if (segments.length < (isWildcard ? 2 : 3)) return false;
  return segments.every((seg) => /^[a-zA-Z][a-zA-Z0-9-]*$/.test(seg));
}

function parseRule(input: unknown): PreferredClientRule | null {
  if (!isPlainObject(input)) return null;
  const scope = typeof input.scope === 'string' ? input.scope.trim() : '';
  if (!isValidPreferredScope(scope)) return null;
  if (!Array.isArray(input.clients)) return null;
  const clients = input.clients
    .slice(0, MAX_CLIENTS_PER_RULE)
    .map(parseClient)
    .filter((c): c is PreferredClient => !!c);
  if (clients.length === 0) return null;
  return { scope, clients };
}

/**
 * Validate a list of rules, dropping any that wouldn't survive a read. Use this
 * when the rules arrive on their own (from local settings storage, say) rather
 * than wrapped in a record.
 */
export function parsePreferredClientRules(input: unknown): PreferredClientRule[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_RULES)
    .map(parseRule)
    .filter((r): r is PreferredClientRule => !!r);
}

/**
 * Validate an arbitrary record value into a `PreferredClientsRecord`.
 *
 * Lenient by design: unparseable rules are dropped, not fatal, so one bad entry
 * hand-written into a PDS doesn't silently disable every other preference.
 * Returns null only when there's nothing usable at all.
 */
export function parsePreferredClientsRecord(value: unknown): PreferredClientsRecord | null {
  if (!isPlainObject(value)) return null;
  if (!Array.isArray(value.preferences)) return null;
  const preferences = parsePreferredClientRules(value.preferences);
  if (preferences.length === 0) return null;
  return {
    preferences,
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
  };
}

// --- Matching --------------------------------------------------------------

/** What a rule is being matched against. Both fields are optional. */
export type PreferredClientQuery = {
  collection?: string | null;
  type?: WaypointType | null;
};

/**
 * How specific a scope is for a given query, higher wins. `-1` means the scope
 * doesn't match at all.
 *
 * Exact NSID (1000) beats the longest namespace wildcard (100 + prefix depth)
 * beats a record kind (10) beats `*` (1). Wildcards score by depth so
 * `app.bsky.feed.*` outranks `app.bsky.*` on `app.bsky.feed.post`.
 */
export function scopeSpecificity(scope: string, query: PreferredClientQuery): number {
  const collection = query.collection || undefined;
  const type = query.type || undefined;

  if (scope === PREFERRED_SCOPE_ALL) return 1;

  if ((PREFERRED_CLIENT_KINDS as readonly string[]).includes(scope)) {
    return type && scope === type ? 10 : -1;
  }

  if (scope.endsWith('.*')) {
    if (!collection) return -1;
    const prefix = scope.slice(0, -2);
    if (collection !== prefix && !collection.startsWith(`${prefix}.`)) return -1;
    return 100 + prefix.split('.').length;
  }

  if (!collection) return -1;
  return collection === scope ? 1000 : -1;
}

/**
 * The single most specific rule matching the query, or null. Ties (which the
 * scoring makes impossible for well-formed records) go to the earlier rule.
 */
export function matchPreferredRule(
  record: PreferredClientsRecord | null | undefined,
  query: PreferredClientQuery,
): PreferredClientRule | null {
  if (!record) return null;
  let best: PreferredClientRule | null = null;
  let bestScore = 0;
  for (const rule of record.preferences) {
    const score = scopeSpecificity(rule.scope, query);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

/** The declared clients for a query, most preferred first. Empty when none match. */
export function preferredClientsFor(
  record: PreferredClientsRecord | null | undefined,
  query: PreferredClientQuery,
): PreferredClient[] {
  return matchPreferredRule(record, query)?.clients ?? [];
}

/**
 * Catalog waypoint ids the account prefers for this query, most preferred
 * first. Off-catalog clients (template-only) are skipped — use
 * `preferredWaypointFor` when you can build arbitrary URLs.
 */
export function preferredWaypointIdsFor(
  record: PreferredClientsRecord | null | undefined,
  query: PreferredClientQuery,
): string[] {
  return preferredClientsFor(record, query)
    .map((c) => c.id)
    .filter((id): id is string => !!id && !!WAYPOINT_DESTINATIONS_DATA[id]);
}

// --- Link building ---------------------------------------------------------

/**
 * Percent-encode a placeholder value for a URL path segment.
 *
 * DIDs are the exception: `did:plc:abc` is colon-delimited and every
 * Atmosphere client expects it raw in a path, so encoding it to
 * `did%3Aplc%3Aabc` produces a link that 404s. Colons are only unescaped for
 * values that actually are DIDs — a colon anywhere else stays encoded.
 */
function encodePlaceholderValue(value: string): string {
  const encoded = encodeURIComponent(value);
  return value.startsWith('did:') ? encoded.replace(/%3A/g, ':') : encoded;
}

/**
 * Expand a URL template, substituting `{handle}`, `{did}`, `{actor}`,
 * `{collection}` and `{rkey}`. Returns null when the template references a
 * placeholder we have no value for.
 */
export function expandLinkTemplate(
  template: string,
  ctx: { handle?: string; did?: string; collection?: string; rkey?: string },
): string | null {
  let out = template;
  // Replace identifier placeholders first so they don't get mangled when the
  // same template references both handle and DID. `{actor}` prefers DID,
  // falling back to handle, mirroring the built-in waypoint convention.
  const actor = ctx.did || ctx.handle;
  const replacements: Record<string, string | undefined> = {
    '{handle}': ctx.handle,
    '{did}': ctx.did,
    '{actor}': actor,
    '{collection}': ctx.collection,
    '{rkey}': ctx.rkey,
  };
  for (const [token, value] of Object.entries(replacements)) {
    if (out.includes(token)) {
      if (!value) return null;
      out = out.split(token).join(encodePlaceholderValue(value));
    }
  }
  return out;
}

/**
 * Pick the template that best fits a target. Falls back through `record` and
 * `profile` so a client that only declared one still produces a link.
 */
function templateFor(
  templates: PreferredClientTemplates,
  target: PreferredClientTarget,
): string | undefined {
  return (
    templates[target.type] ??
    (target.collection && target.rkey ? templates.record : undefined) ??
    (!target.collection ? templates.profile : undefined)
  );
}

/**
 * Build the URL a declared client points at for this target, or null when it
 * can't render it (an unknown catalog id, a template we can't fill, a
 * DID-only destination with no DID).
 *
 * Templates win over the catalog id: someone who wrote one down is pointing at
 * a specific deploy, and that's more specific than the catalog's default host.
 */
export function preferredClientUrl(
  client: PreferredClient,
  target: PreferredClientTarget,
): string | null {
  if (client.templates) {
    const template = templateFor(client.templates, target);
    if (template) {
      const url = expandLinkTemplate(template, {
        handle: target.handle,
        did: target.did,
        collection: target.collection,
        rkey: target.rkey,
      });
      if (url) return url;
    }
  }

  if (client.id) {
    const waypoint = WAYPOINT_DESTINATIONS_DATA[client.id];
    if (
      waypoint &&
      waypoint.supportedTypes.includes(target.type) &&
      !(DID_REQUIRED_WAYPOINTS.has(waypoint.id) && !target.did)
    ) {
      const url = waypoint.getUrl(target.handle, target.collection, target.rkey, target.did);
      if (url) return url;
    }
  }

  return null;
}

/**
 * The account's preferred destination for a target: the first declared client
 * for the most specific matching rule that can actually render it.
 *
 * This is the one call most integrations need.
 */
export function preferredWaypointFor(
  record: PreferredClientsRecord | null | undefined,
  target: PreferredClientTarget,
): PreferredClientMatch | null {
  const rule = matchPreferredRule(record, {
    collection: target.collection,
    type: target.type,
  });
  if (!rule) return null;
  for (const client of rule.clients) {
    const url = preferredClientUrl(client, target);
    if (url) {
      return {
        scope: rule.scope,
        client,
        waypointId: client.id && WAYPOINT_DESTINATIONS_DATA[client.id] ? client.id : null,
        url,
      };
    }
  }
  return null;
}

/**
 * Reorder a list of waypoint ids so the account's declared preferences come
 * first, in their declared order. Ids not in the list are left in place behind
 * them. Use this to personalize an existing "recommended" ordering.
 */
export function orderIdsByPreference(
  ids: string[],
  record: PreferredClientsRecord | null | undefined,
  query: PreferredClientQuery,
): string[] {
  const preferred = preferredWaypointIdsFor(record, query);
  if (preferred.length === 0) return ids;
  const present = new Set(ids);
  const lifted = preferred.filter((id) => present.has(id));
  if (lifted.length === 0) return ids;
  const liftedSet = new Set(lifted);
  return [...lifted, ...ids.filter((id) => !liftedSet.has(id))];
}

// --- Reading the record from a PDS -----------------------------------------

export type FetchPreferredClientsOptions = {
  /** Skip identity resolution by supplying the PDS origin directly. */
  pds?: string;
  /** Per-request timeout in ms. Defaults to 6000. */
  timeoutMs?: number;
  /**
   * Gate on the resolved PDS hostname before fetching. The endpoint comes from
   * a DID document, i.e. attacker-controllable, so server-side callers should
   * pass an SSRF guard here (in this repo: `isBlockedFetchHost` inverted).
   */
  allowHost?: (hostname: string) => boolean;
};

/**
 * Fetch and validate an account's `to.aturi.actor.preferredClients/self`
 * record. Accepts a handle, a DID, or a PDS-qualified DID.
 *
 * Returns null for every "no answer" case — no record, unresolvable identity,
 * network failure, malformed record — because a caller's fallback is the same
 * in all of them: do what you did before. Never throws.
 */
export async function fetchPreferredClients(
  actor: string,
  options: FetchPreferredClientsOptions = {},
): Promise<PreferredClientsRecord | null> {
  const { timeoutMs = 6000, allowHost } = options;
  if (!actor) return null;

  try {
    let did = actor.startsWith('did:') ? actor : '';
    let pds = options.pds;

    if (!pds || !did) {
      const resolved = await resolvePdsEndpoint(actor);
      if (!resolved) return null;
      did = resolved.did;
      pds = pds || resolved.pdsEndpoint;
    }

    let origin: URL;
    try {
      origin = new URL(pds);
    } catch {
      return null;
    }
    if (origin.protocol !== 'https:' && origin.protocol !== 'http:') return null;
    if (allowHost && !allowHost(origin.hostname)) return null;

    const params = new URLSearchParams({
      repo: did,
      collection: PREFERRED_CLIENTS_NSID,
      rkey: PREFERRED_CLIENTS_RKEY,
    });
    const res = await upstreamFetch(
      `${origin.origin}/xrpc/com.atproto.repo.getRecord?${params}`,
      { timeoutMs, retries: 0 },
    );
    // 400/RecordNotFound is the overwhelmingly common case — most accounts
    // haven't published one. Not worth distinguishing from any other miss.
    if (!res.ok) return null;
    const body = (await res.json()) as { value?: unknown };
    return parsePreferredClientsRecord(body?.value);
  } catch {
    return null;
  }
}

/**
 * One-shot convenience: read an account's preferences and resolve them against
 * a target. Returns null when the account has published nothing that applies.
 */
export async function fetchPreferredWaypointFor(
  actor: string,
  target: PreferredClientTarget,
  options: FetchPreferredClientsOptions = {},
): Promise<PreferredClientMatch | null> {
  const record = await fetchPreferredClients(actor, options);
  return preferredWaypointFor(record, target);
}

// --- Authoring -------------------------------------------------------------

/**
 * Build a record body from a rule list. Drops rules that wouldn't survive a
 * read (no clients, unknown scope) and collapses duplicate scopes, so the
 * published record is always one this module can parse back.
 */
export function buildPreferredClientsRecord(
  rules: PreferredClientRule[],
  timestamps: { createdAt?: string; updatedAt?: string } = {},
): PreferredClientsRecord & { $type: string } {
  const bySpecificScope = new Map<string, PreferredClientRule>();
  for (const rule of rules) {
    const parsed = parseRule(rule);
    if (parsed) bySpecificScope.set(parsed.scope, parsed);
  }
  const now = new Date().toISOString();
  return {
    $type: PREFERRED_CLIENTS_NSID,
    preferences: Array.from(bySpecificScope.values()).slice(0, MAX_RULES),
    createdAt: timestamps.createdAt || now,
    updatedAt: timestamps.updatedAt || now,
  };
}

/**
 * Turn a catalog waypoint id into a `PreferredClient`, filling in the name from
 * the catalog. Returns null for an id that isn't in the catalog.
 */
export function clientFromWaypointId(id: string): PreferredClient | null {
  const waypoint = WAYPOINT_DESTINATIONS_DATA[id];
  if (!waypoint) return null;
  return { id: waypoint.id, name: waypoint.name };
}

/**
 * The record kind a scope covers, for deciding which catalog clients can
 * plausibly serve it. Mirrors `parseURI`'s collection → type mapping: only
 * posts and lists have dedicated link shapes, everything else is a generic
 * record. Wildcards and `*` span collections, so they get `record` too.
 */
export function recordKindForScope(scope: string): WaypointType {
  if ((PREFERRED_CLIENT_KINDS as readonly string[]).includes(scope)) {
    return scope as WaypointType;
  }
  if (scope === 'app.bsky.feed.post') return 'post';
  if (scope === 'app.bsky.graph.list') return 'list';
  return 'record';
}

/**
 * Display names for the collections common enough that the raw NSID would be
 * noise in a settings row. Anything not listed falls back to the NSID itself,
 * which is the honest label for a lexicon we can't name.
 */
const KNOWN_COLLECTION_LABELS: Record<string, string> = {
  'app.bsky.feed.post': 'Bluesky posts',
  'app.bsky.graph.list': 'Bluesky lists',
  'app.bsky.feed.generator': 'Bluesky feeds',
  'app.bsky.actor.profile': 'Bluesky profiles',
};

/**
 * Namespace prefixes worth naming. Without these, a wildcard scope describes
 * itself as "app.bsky records", which is accurate and unreadable — reversed
 * domains are not how anyone refers to the app they use.
 */
const KNOWN_NAMESPACE_LABELS: Record<string, string> = {
  'app.bsky': 'Bluesky',
  'pub.leaflet': 'Leaflet',
  'site.standard': 'Standard Site',
  'sh.tangled': 'Tangled',
  'at.margin': 'Margin',
  'social.grain': 'Grain',
  'net.anisota': 'Anisota',
  'so.semble': 'Semble',
  'place.stream': 'Streamplace',
  'social.popfeed': 'Popfeed',
  'id.sifa': 'Sifa',
  'app.blento': 'Blento',
};

/** Human-readable label for a scope, for settings UI and explanations. */
export function describeScope(scope: string): string {
  if (scope === PREFERRED_SCOPE_ALL) return 'Everything else';
  switch (scope) {
    case 'post':
      return 'Posts';
    case 'profile':
      return 'Profiles';
    case 'list':
      return 'Lists';
    case 'record':
      return 'Any record';
    default:
      if (scope.endsWith('.*')) {
        const prefix = scope.slice(0, -2);
        return `${KNOWN_NAMESPACE_LABELS[prefix] ?? prefix} records`;
      }
      return KNOWN_COLLECTION_LABELS[scope] ?? scope;
  }
}

/**
 * `describeScope` for use mid-sentence ("You chose this for …"). Differs in
 * two places: the catch-all reads as a phrase rather than a heading, and the
 * generic record kinds lose their leading capital. App names keep theirs —
 * lowercasing the whole label would turn Bluesky into bluesky.
 */
export function describeScopeInline(scope: string): string {
  if (scope === PREFERRED_SCOPE_ALL) return 'anything else';
  if ((PREFERRED_CLIENT_KINDS as readonly string[]).includes(scope)) {
    return describeScope(scope).toLowerCase();
  }
  return describeScope(scope);
}

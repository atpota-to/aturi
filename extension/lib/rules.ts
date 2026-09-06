import { WAYPOINT_DESTINATIONS_DATA, type WaypointType } from '@aturi/waypoints.data';
import type { SourceApp } from '@aturi/reverseParsers';
import {
  areRedirectCompatible,
  resolveRedirectFor,
  type CustomWaypoint,
  type Prefs,
} from './prefs';
import { customWaypointToData } from './template';
import { DID_REQUIRED_WAYPOINTS, visibleWaypointIds } from './catalog';

export type RedirectRule = chrome.declarativeNetRequest.Rule;

type SourceRecipe = {
  regexFilter: string;
  capturesLabel: string; // debug label
  tokens: {
    // 1-based capture group indices into regexFilter
    handle: number;
    collection?: number;
    rkey?: number;
    rkeyCollectionPair?: { collection: number; rkey: number };
  };
  type: WaypointType;
};

/**
 * Declarative source URL shapes we know how to reverse. Each entry produces
 * a DNR rule whose `regexFilter` captures enough context (handle, optional
 * collection, optional rkey) to reconstruct a destination URL via that
 * destination's template.
 *
 * We intentionally restrict to handle/rkey patterns - the DID-requiring
 * destinations are excluded from rule generation below.
 */
function sourceRecipes(sourceId: SourceApp | string): SourceRecipe[] {
  switch (sourceId) {
    case 'bluesky':
    case 'blacksky':
    case 'reddwarf':
    case 'impro':
    case 'lea':
    case 'witchsky':
    case 'deer':
    case 'mu':
    case 'northsky':
    case 'anisota': {
      const host = HOST_BY_SOURCE[sourceId as SourceApp];
      if (!host) return [];
      // Exclude ?, # (and /) from the handle capture. `[^/]+` would otherwise
      // swallow a trailing query string (e.g. /profile/alice?foo=bar) into the
      // handle and redirect to a mangled destination.
      const base = `^https://${escapeHost(host)}/profile/([^/?#]+)`;
      return [
        {
          regexFilter: `${base}/post/([^/?#]+).*`,
          capturesLabel: `${sourceId}:post`,
          tokens: { handle: 1, collection: -1, rkey: 2 },
          type: 'post',
        },
        {
          regexFilter: `${base}/lists/([^/?#]+).*`,
          capturesLabel: `${sourceId}:list`,
          tokens: { handle: 1, collection: -1, rkey: 2 },
          type: 'list',
        },
        {
          regexFilter: `${base}/?$`,
          capturesLabel: `${sourceId}:profile`,
          tokens: { handle: 1 },
          type: 'profile',
        },
      ];
    }

    case 'bluepy': {
      const host = HOST_BY_SOURCE.bluepy;
      const base = `^https://${escapeHost(host)}/at:/+([^/?#]+)`;
      return [
        {
          regexFilter: `${base}/app\\.bsky\\.feed\\.post/([^/?#]+).*`,
          capturesLabel: 'bluepy:post',
          tokens: { handle: 1, rkey: 2 },
          type: 'post',
        },
        {
          regexFilter: `${base}/app\\.bsky\\.graph\\.list/([^/?#]+).*`,
          capturesLabel: 'bluepy:list',
          tokens: { handle: 1, rkey: 2 },
          type: 'list',
        },
        {
          regexFilter: `${base}/app\\.bsky\\.actor\\.profile/self/?.*`,
          capturesLabel: 'bluepy:profile',
          tokens: { handle: 1 },
          type: 'profile',
        },
      ];
    }

    case 'pinksky': {
      return [
        {
          regexFilter: '^https://pinkleap\\.app/profile/([^/?#]+)/?$',
          capturesLabel: 'pinksky:profile',
          tokens: { handle: 1 },
          type: 'profile',
        },
      ];
    }

    case 'leaflet': {
      return [
        {
          regexFilter: '^https://leaflet\\.pub/p/([^/?#]+)/?$',
          capturesLabel: 'leaflet:profile',
          tokens: { handle: 1 },
          type: 'profile',
        },
      ];
    }

    case 'tangled': {
      return [
        {
          regexFilter: '^https://tangled\\.org/([^/?#]+)/?$',
          capturesLabel: 'tangled:profile',
          tokens: { handle: 1 },
          type: 'profile',
        },
      ];
    }

    case 'semble': {
      return [
        {
          regexFilter: '^https://semble\\.so/profile/([^/?#]+)/?$',
          capturesLabel: 'semble:profile',
          tokens: { handle: 1 },
          type: 'profile',
        },
      ];
    }

    case 'streamplace': {
      return [
        {
          regexFilter: '^https://stream\\.place/([^/?#]+)/?$',
          capturesLabel: 'streamplace:profile',
          tokens: { handle: 1 },
          type: 'profile',
        },
      ];
    }

    case 'grain': {
      return [
        {
          regexFilter: '^https://grain\\.social/profile/([^/?#]+)/?$',
          capturesLabel: 'grain:profile',
          tokens: { handle: 1 },
          type: 'profile',
        },
      ];
    }

    case 'popfeed': {
      return [
        {
          regexFilter: '^https://popfeed\\.social/profile/([^/?#]+)/?$',
          capturesLabel: 'popfeed:profile',
          tokens: { handle: 1 },
          type: 'profile',
        },
      ];
    }

    case 'sifa': {
      return [
        {
          regexFilter: '^https://sifa\\.id/p/([^/?#]+)/?$',
          capturesLabel: 'sifa:profile',
          tokens: { handle: 1 },
          type: 'profile',
        },
      ];
    }

    case 'blento': {
      return [
        {
          regexFilter: '^https://blento\\.app/([^/?#]+)/?$',
          capturesLabel: 'blento:profile',
          tokens: { handle: 1 },
          type: 'profile',
        },
      ];
    }

    case 'pdsls':
    case 'atptools': {
      const host = HOST_BY_SOURCE[sourceId as SourceApp];
      if (!host) return [];
      // Both raw explorers address records by AT URI:
      // `/at://<identifier>/<collection>/<rkey>`. atp.tools uses a single slash
      // after `at:` and pdsls a double, so `at:/+` accepts either. The
      // identifier (a DID or handle) sits verbatim in the path and passes
      // straight through to the destination explorer, which also keys its URLs
      // by identifier — so unlike handle-only sources, no DID resolution is
      // needed and the record's own collection (`\2`) rides along untouched.
      const base = `^https://${escapeHost(host)}/at:/+([^/?#]+)`;
      return [
        {
          regexFilter: `${base}/([^/?#]+)/([^/?#]+).*`,
          capturesLabel: `${sourceId}:record`,
          tokens: { handle: 1, collection: 2, rkey: 3 },
          type: 'record',
        },
        {
          regexFilter: `${base}/?$`,
          capturesLabel: `${sourceId}:profile`,
          tokens: { handle: 1 },
          type: 'profile',
        },
      ];
    }

    default:
      return [];
  }
}

const HOST_BY_SOURCE: Record<SourceApp, string> = {
  aturi: 'aturi.to',
  aturiExplore: 'aturi.to',
  bluesky: 'bsky.app',
  bluepy: 'bluepy.social',
  blacksky: 'blacksky.community',
  reddwarf: 'reddwarf.app',
  impro: 'impro.social',
  lea: 'lea.ac',
  witchsky: 'witchsky.app',
  deer: 'deer.social',
  northsky: 'northsky.app',
  mu: 'mu.social',
  anisota: 'anisota.net',
  pinksky: 'pinkleap.app',
  leaflet: 'leaflet.pub',
  tangled: 'tangled.org',
  margin: 'margin.at',
  pdsls: 'pdsls.dev',
  atptools: 'atp.tools',
  semble: 'semble.so',
  streamplace: 'stream.place',
  grain: 'grain.social',
  popfeed: 'popfeed.social',
  sifa: 'sifa.id',
  blento: 'blento.app',
  kimbia: 'kimbia.app',
  standardReader: 'standard-reader.app',
  taproot: 'atproto.at',
  offprint: 'offprint.app',
  pckt: 'pckt.blog',
  headDetected: '',
};

function escapeHost(host: string): string {
  return host.replace(/\./g, '\\.');
}

/**
 * Derive the destination URL for a rule substitution by calling the
 * destination's `getUrl` with placeholder strings, then replacing those
 * placeholders with DNR backrefs (\1, \2). This lets us reuse each
 * waypoint's existing URL-building logic even for regex substitution.
 */
function buildSubstitution(
  destinationId: string,
  recipe: SourceRecipe,
  customWaypoints: CustomWaypoint[]
): string | null {
  const waypoint = destinationId.startsWith('custom:')
    ? customWaypointToData(
        customWaypoints.find(c => c.id === destinationId)!
      )
    : WAYPOINT_DESTINATIONS_DATA[destinationId];

  if (!waypoint) return null;

  const PH = {
    handle: '__ATURI_HANDLE__',
    collection: '__ATURI_COLLECTION__',
    rkey: '__ATURI_RKEY__',
  };

  const collectionForType: Record<WaypointType, string | undefined> = {
    post: 'app.bsky.feed.post',
    profile: undefined,
    list: 'app.bsky.graph.list',
    record: PH.collection,
    unknown: undefined,
  };

  const collection =
    recipe.type === 'record' ? PH.collection : collectionForType[recipe.type];
  const rkey = recipe.type === 'profile' ? undefined : PH.rkey;

  const url = waypoint.getUrl(PH.handle, collection, rkey, undefined);
  if (!url) return null;

  // A destination that doesn't recognize this collection typically falls back
  // to its profile URL, dropping the rkey on the floor. Rewriting to that would
  // silently strand the user on the *author* of the record they clicked (e.g.
  // `bsky.app/profile/alice/lists/xyz` -> `example.app/profile/alice`), so drop
  // the rule and leave the source URL alone instead.
  if (rkey && !url.includes(PH.rkey)) return null;

  let substitution = url;

  const handleIdx = recipe.tokens.handle;
  substitution = substitution.split(PH.handle).join(`\\${handleIdx}`);

  if (rkey && recipe.tokens.rkey) {
    substitution = substitution.split(PH.rkey).join(`\\${recipe.tokens.rkey}`);
  }

  if (collection === PH.collection && recipe.tokens.collection && recipe.tokens.collection > 0) {
    substitution = substitution.split(PH.collection).join(`\\${recipe.tokens.collection}`);
  }

  if (substitution.includes(PH.handle) || substitution.includes(PH.rkey) || substitution.includes(PH.collection)) {
    return null;
  }

  return substitution;
}

export type BuildRulesOptions = {
  /**
   * Starting rule id. DNR rule ids must be positive ints - callers can pass
   * a stable base so ids don't collide with other extensions.
   */
  baseId?: number;
};

/**
 * Compile user prefs into a list of declarativeNetRequest rules. Hidden
 * waypoints are excluded entirely. DID-required destinations (and custom
 * waypoints whose templates use `{did}`) are skipped because we can't fill
 * that in declaratively.
 */
export function buildRules(prefs: Prefs, opts: BuildRulesOptions = {}): RedirectRule[] {
  if (!prefs.autoRedirect) return [];

  const visible = visibleWaypointIds(prefs);

  // Sources to consider: every source we have a recipe for. We don't want a
  // missing entry in `defaults` to suppress favorite-driven redirects.
  const sources = Array.from(new Set([
    ...ALL_KNOWN_SOURCES,
    ...Object.keys(prefs.defaults),
    ...prefs.customWaypoints.map(c => c.id),
  ]));

  // Pass 1: collect every eligible source->destination edge (after all
  // visibility/compat/DID checks) without assigning rule ids yet.
  type Candidate = {
    source: string;
    destinationId: string;
    recipe: ReturnType<typeof sourceRecipes>[number];
    substitution: string;
  };
  const candidates: Candidate[] = [];
  const edgeKey = (type: string, src: string) => `${type} ${src}`;
  const edge = new Map<string, string>();

  for (const source of sources) {
    if (!visible.has(source)) continue;

    for (const recipe of sourceRecipes(source)) {
      const destinationId = resolveRedirectFor(prefs, source, recipe.type);
      if (!destinationId) continue;
      if (!visible.has(destinationId)) continue;
      if (destinationId === source) continue;
      if (DID_REQUIRED_WAYPOINTS.has(destinationId)) continue;
      if (!areRedirectCompatible(source, destinationId, prefs.customWaypoints)) continue;

      const destWaypoint = destinationId.startsWith('custom:')
        ? null
        : WAYPOINT_DESTINATIONS_DATA[destinationId];
      if (destWaypoint && !destWaypoint.supportedTypes.includes(recipe.type)) continue;

      if (destinationId.startsWith('custom:')) {
        const cw = prefs.customWaypoints.find(c => c.id === destinationId);
        if (!cw) continue;
        const template = cw.templates[recipe.type];
        if (!template) continue;
        if (template.includes('{did}')) continue;
      }

      const substitution = buildSubstitution(destinationId, recipe, prefs.customWaypoints);
      if (!substitution) continue;

      candidates.push({ source, destinationId, recipe, substitution });
      edge.set(edgeKey(recipe.type, source), destinationId);
    }
  }

  // Following the redirect chain for `start`+`type`, does it lead back to
  // `target`? A per-source default combined with a family favorite can emit
  // mutual A->B and B->A rules; DNR re-evaluates on each hop, so both firing
  // ping-pongs the browser into ERR_TOO_MANY_REDIRECTS. Dropping the edges
  // that close a loop keeps both sites reachable.
  const leadsBackTo = (type: string, start: string, target: string): boolean => {
    let cur = start;
    const seen = new Set<string>();
    while (edge.has(edgeKey(type, cur))) {
      if (seen.has(cur)) return false; // pre-existing loop not involving target
      seen.add(cur);
      const next = edge.get(edgeKey(type, cur))!;
      if (next === target) return true;
      cur = next;
    }
    return false;
  };

  // Pass 2: emit rules, skipping any edge that would close a redirect cycle.
  const rules: RedirectRule[] = [];
  let nextId = opts.baseId ?? 1;

  for (const c of candidates) {
    if (leadsBackTo(c.recipe.type, c.destinationId, c.source)) continue;

    rules.push({
      id: nextId++,
      priority: 1,
      action: {
        type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
        redirect: {
          regexSubstitution: c.substitution,
        },
      },
      condition: {
        regexFilter: c.recipe.regexFilter,
        resourceTypes: ['main_frame'] as chrome.declarativeNetRequest.ResourceType[],
      },
    });
  }

  return rules;
}

const ALL_KNOWN_SOURCES: SourceApp[] = [
  'bluesky',
  'bluepy',
  'blacksky',
  'reddwarf',
  'impro',
  'lea',
  'witchsky',
  'deer',
  'mu',
  'northsky',
  'anisota',
  'pinksky',
  'leaflet',
  'tangled',
  'semble',
  'streamplace',
  'grain',
  'popfeed',
  'sifa',
  'blento',
  'pdsls',
  'atptools',
];

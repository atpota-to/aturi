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
    case 'witchsky':
    case 'catsky':
    case 'deer':
    case 'mu':
    case 'anisota': {
      const host = HOST_BY_SOURCE[sourceId as SourceApp];
      if (!host) return [];
      const base = `^https://${escapeHost(host)}/profile/([^/]+)`;
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

    default:
      return [];
  }
}

const HOST_BY_SOURCE: Record<SourceApp, string> = {
  bluesky: 'bsky.app',
  bluepy: 'bluepy.social',
  blacksky: 'blacksky.community',
  reddwarf: 'reddwarf.app',
  witchsky: 'witchsky.app',
  catsky: 'catsky.social',
  deer: 'deer.social',
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
  const rules: RedirectRule[] = [];
  let nextId = opts.baseId ?? 1;

  // Sources to consider: every source we have a recipe for. We don't want a
  // missing entry in `defaults` to suppress favorite-driven redirects.
  const sources = Array.from(new Set([
    ...ALL_KNOWN_SOURCES,
    ...Object.keys(prefs.defaults),
    ...prefs.customWaypoints.map(c => c.id),
  ]));

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

      rules.push({
        id: nextId++,
        priority: 1,
        action: {
          type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
          redirect: {
            regexSubstitution: substitution,
          },
        },
        condition: {
          regexFilter: recipe.regexFilter,
          resourceTypes: ['main_frame'] as chrome.declarativeNetRequest.ResourceType[],
        },
      });
    }
  }

  return rules;
}

const ALL_KNOWN_SOURCES: SourceApp[] = [
  'bluesky',
  'bluepy',
  'blacksky',
  'reddwarf',
  'witchsky',
  'catsky',
  'deer',
  'mu',
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
];

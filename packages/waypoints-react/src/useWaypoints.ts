import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  getCategorizedWaypointsData,
  getRecommendedWaypointsData,
  getWaypointDataForType,
  orderIdsByPreference,
  preferredWaypointFor,
  preferredWaypointIdsFor,
  type PreferredClientMatch,
  type PreferredClientsRecord,
  type WaypointCategoryData,
  type WaypointData,
  type WaypointType,
} from '@aturi.to/waypoints';
import { WAYPOINT_ICONS } from './waypointIcons';

/** A single waypoint resolved against a target, ready to render. */
export type WaypointEntry = {
  id: string;
  name: string;
  /** Alias of `name`, for render-prop ergonomics. */
  label: string;
  /** Description with any function form already resolved to a string. */
  description: string;
  /** Destination URL (guaranteed non-null; null-url waypoints are dropped). */
  url: string;
  category: string;
  icon: ReactNode;
  isRecommended: boolean;
  /**
   * True when the account in `preferredClients` named this client for this
   * kind of record. Their choice, not the catalog's suggestion.
   */
  isPreferred: boolean;
};

export type WaypointCategoryEntry = {
  id: string;
  name: string;
  description?: string;
  waypoints: WaypointEntry[];
  subcategories: WaypointCategoryEntry[];
};

/**
 * A developer-defined waypoint. Mirrors the built-in `WaypointData` shape but
 * with optional fields so a consumer can add one with minimal boilerplate.
 */
export type CustomWaypoint = {
  id: string;
  name: string;
  description?:
    | string
    | ((collection?: string, type?: WaypointType) => string);
  category?: string;
  supportedTypes?: WaypointType[];
  icon?: ReactNode;
  getUrl: (
    handle: string,
    collection?: string,
    rkey?: string,
    did?: string,
  ) => string | null;
};

export type UseWaypointsParams = {
  type: WaypointType;
  handle: string;
  collection?: string;
  rkey?: string;
  did?: string;
  /** Allowlist + ordering hint. When set, only these ids are surfaced. */
  waypointIds?: string[];
  /** Ids to remove from the result. */
  hiddenIds?: string[];
  /** Extra developer-defined destinations, grouped under a "Custom" category. */
  customWaypoints?: CustomWaypoint[];
  /**
   * A reader's published `to.aturi.actor.preferredClients` record. When set,
   * the clients they declared for this record type lift to the front of
   * `recommended`, get `isPreferred`, and the winner comes back as
   * `preferred`. Fetch one with `usePreferredClients`.
   */
  preferredClients?: PreferredClientsRecord | null;
};

export type UseWaypointsResult = {
  recommended: { label: string; waypoints: WaypointEntry[] };
  categories: WaypointCategoryEntry[];
  /** Flat, de-duplicated list across recommended + every category. */
  waypoints: WaypointEntry[];
  /**
   * The destination the `preferredClients` account declared for this target.
   * Null when they declared nothing applicable — or when it points at a client
   * outside the catalog, in which case it still resolves here even though no
   * matching `WaypointEntry` exists.
   */
  preferred: PreferredClientMatch | null;
  /** Copy a url to the clipboard. Resolves to whether it succeeded. */
  copy: (url: string) => Promise<boolean>;
  /** Open a url in a new tab. */
  open: (url: string) => void;
};

function resolveDescription(
  description: CustomWaypoint['description'],
  collection?: string,
  type?: WaypointType,
): string {
  if (typeof description === 'function') return description(collection, type);
  return description ?? '';
}

/**
 * Headless data hook. Resolves the catalog against a target and returns
 * render-ready entries (url, description, icon, recommended flag) plus
 * `copy`/`open` helpers — no markup, so you can build any UI on top.
 */
export function useWaypoints(params: UseWaypointsParams): UseWaypointsResult {
  const {
    type,
    handle,
    collection,
    rkey,
    did,
    waypointIds,
    hiddenIds,
    customWaypoints,
    preferredClients,
  } = params;

  const copy = useCallback(async (url: string): Promise<boolean> => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        return true;
      }
    } catch {
      // fall through
    }
    return false;
  }, []);

  const open = useCallback((url: string) => {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const data = useMemo(() => {
    const hidden = new Set(hiddenIds ?? []);
    const allow = waypointIds ? new Set(waypointIds) : null;
    const isVisible = (id: string) =>
      !hidden.has(id) && (!allow || allow.has(id));

    const recommendedData = getRecommendedWaypointsData(type, collection);
    const recommendedIds = new Set(recommendedData.waypoints.map((w) => w.id));
    const preferenceQuery = { collection, type };
    const preferredIds = new Set(
      preferredWaypointIdsFor(preferredClients, preferenceQuery),
    );
    const preferred = preferredWaypointFor(preferredClients, {
      type,
      handle,
      collection,
      rkey,
      did,
    });

    const buildBuiltin = (w: WaypointData): WaypointEntry | null => {
      const url = w.getUrl(handle, collection, rkey, did);
      if (!url) return null;
      return {
        id: w.id,
        name: w.name,
        label: w.name,
        description: resolveDescription(w.description, collection, type),
        url,
        category: w.category,
        icon: WAYPOINT_ICONS[w.id] ?? null,
        isRecommended: recommendedIds.has(w.id),
        isPreferred: preferredIds.has(w.id),
      };
    };

    const buildCustom = (c: CustomWaypoint): WaypointEntry | null => {
      if (c.supportedTypes && !c.supportedTypes.includes(type)) return null;
      const url = c.getUrl(handle, collection, rkey, did);
      if (!url) return null;
      return {
        id: c.id,
        name: c.name,
        label: c.name,
        description: resolveDescription(c.description, collection, type),
        url,
        category: c.category ?? 'custom',
        icon: c.icon ?? null,
        isRecommended: recommendedIds.has(c.id),
        isPreferred: preferredIds.has(c.id),
      };
    };

    const availableForType = getWaypointDataForType(type);

    const buildCategory = (
      category: WaypointCategoryData,
    ): WaypointCategoryEntry => {
      const waypoints = availableForType
        .filter((w) => w.category === category.id && isVisible(w.id))
        .map(buildBuiltin)
        .filter((e): e is WaypointEntry => !!e);
      const subcategories = (category.subcategories ?? [])
        .map(buildCategory)
        .filter((s) => s.waypoints.length > 0 || s.subcategories.length > 0);
      return {
        id: category.id,
        name: category.name,
        description: category.description,
        waypoints,
        subcategories,
      };
    };

    const categories = getCategorizedWaypointsData(type)
      .map(({ category }) => buildCategory(category))
      .filter((c) => c.waypoints.length > 0 || c.subcategories.length > 0);

    const customEntries = (customWaypoints ?? [])
      .filter((c) => isVisible(c.id))
      .map(buildCustom)
      .filter((e): e is WaypointEntry => !!e);
    if (customEntries.length > 0) {
      categories.push({
        id: 'custom',
        name: 'Custom',
        description: undefined,
        waypoints: customEntries,
        subcategories: [],
      });
    }

    const recommendedEntries = recommendedData.waypoints
      .filter((w) => isVisible(w.id))
      .map(buildBuiltin)
      .filter((e): e is WaypointEntry => !!e);
    // A declared preference outranks the catalog's suggestion, so lift it —
    // without dropping anything, since the rest are still valid destinations.
    const recommendedOrder = orderIdsByPreference(
      recommendedEntries.map((e) => e.id),
      preferredClients,
      preferenceQuery,
    );
    const recommendedById = new Map(recommendedEntries.map((e) => [e.id, e]));
    const recommended = {
      label: recommendedData.label,
      waypoints: recommendedOrder
        .map((id) => recommendedById.get(id))
        .filter((e): e is WaypointEntry => !!e),
    };

    const flat: WaypointEntry[] = [];
    const seen = new Set<string>();
    const pushAll = (entries: WaypointEntry[]) => {
      for (const e of entries) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          flat.push(e);
        }
      }
    };
    const collect = (c: WaypointCategoryEntry) => {
      pushAll(c.waypoints);
      c.subcategories.forEach(collect);
    };
    pushAll(recommended.waypoints);
    categories.forEach(collect);

    return { recommended, categories, waypoints: flat, preferred };
  }, [
    type,
    handle,
    collection,
    rkey,
    did,
    waypointIds,
    hiddenIds,
    customWaypoints,
    preferredClients,
  ]);

  return { ...data, copy, open };
}

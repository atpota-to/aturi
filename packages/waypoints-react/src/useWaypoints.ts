import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  getCategorizedWaypointsData,
  getRecommendedWaypointsData,
  getWaypointDataForType,
  type WaypointCategoryData,
  type WaypointData,
  type WaypointType,
} from '@aturi/waypoints';
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
};

export type UseWaypointsResult = {
  recommended: { label: string; waypoints: WaypointEntry[] };
  categories: WaypointCategoryEntry[];
  /** Flat, de-duplicated list across recommended + every category. */
  waypoints: WaypointEntry[];
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

    const recommended = {
      label: recommendedData.label,
      waypoints: recommendedData.waypoints
        .filter((w) => isVisible(w.id))
        .map(buildBuiltin)
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

    return { recommended, categories, waypoints: flat };
  }, [type, handle, collection, rkey, did, waypointIds, hiddenIds, customWaypoints]);

  return { ...data, copy, open };
}

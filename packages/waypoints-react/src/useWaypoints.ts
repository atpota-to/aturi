import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  describeComposeIntent,
  getCategorizedWaypointsData,
  getRecommendedWaypointsData,
  getWaypointDataForType,
  requiresDid,
  type ComposeIntentData,
  type ComposeIntentDescriptor,
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
   * Link that opens this client's composer, pre-filled with `composeText` when
   * the client reads it. Null when the client has no compose intent route, so
   * `entry.composeIntent && <ComposeButton …/>` is enough to gate the UI.
   */
  composeIntent: ComposeIntentDescriptor | null;
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
  /** Declare a compose intent route so the entry surfaces one like a built-in. */
  composeIntent?: ComposeIntentData;
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
  /**
   * Allowlist. When set, only these ids are surfaced — including among
   * `customWaypoints`. Order is not taken from this array; entries keep their
   * catalog order.
   */
  waypointIds?: string[];
  /** Ids to remove from the result. */
  hiddenIds?: string[];
  /** Extra developer-defined destinations, grouped under a "Custom" category. */
  customWaypoints?: CustomWaypoint[];
  /**
   * Text to pre-fill into each entry's compose intent link. Leave unset when
   * you only want to know which clients support one.
   */
  composeText?: string;
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
    composeText,
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
      // Same rule the core resolver applies. Without it the picker offered
      // pdsls, atp.tools, grain and popfeed handle-shaped URLs those sites
      // cannot resolve, for any target where the DID was not known.
      if (requiresDid(w, { handle, collection, rkey }, did)) return null;
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
        composeIntent: describeComposeIntent(w, composeText),
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
        composeIntent: describeComposeIntent(c, composeText),
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
    // Keyed on content, not on array identity. Consumers write these props as
    // inline literals — every README example does — which gives them a fresh
    // reference on every render, so an identity-keyed memo never hit and every
    // consumer of this result saw a new object each time.
    //
    // Custom waypoints are keyed by id: changing what an existing id's getUrl
    // returns without changing the id will not invalidate the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    type,
    handle,
    collection,
    rkey,
    did,
    composeText,
    waypointIds?.join(' '),
    hiddenIds?.join(' '),
    customWaypoints?.map((c) => c.id).join(' '),
  ]);

  // `copy` and `open` are already stable, so this keeps the returned object
  // stable too — otherwise every render handed back a new one and any consumer
  // memoizing on it re-ran regardless.
  return useMemo(() => ({ ...data, copy, open }), [data, copy, open]);
}

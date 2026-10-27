import { resolveIdentifier } from '@aturi/atproto/identity';
import { getRecord } from '@aturi/atproto/pdsClient';
import {
  COMPAT_FAMILY_ORDER,
  WAYPOINT_DESTINATIONS_DATA,
  type RedirectCompatFamily,
} from '@aturi/waypoints.data';
import {
  PREFERRED_CLIENTS_NSID,
  PREFERRED_CLIENTS_RKEY,
  clientPlatformFromUserAgent,
  getPreferredClient,
  parsePreferredClients,
  type ClientPlatform,
  type PreferredClientsRecord,
} from '@aturi/preferredClients';
import { DID_REQUIRED_WAYPOINTS, isWaypointVisible } from './catalog';
import { adoptWaypoint, setFavoriteForFamily, type Prefs } from './prefs';

/**
 * Importing a `to.aturi.actor.preferredClients` declaration as favorites.
 *
 * The site follows a signed-in account's declaration live. The extension has
 * no account and makes no background requests, so it takes the declaration
 * once, when asked: fetch it, show what it would set, and write the parts it
 * can act on into `favoriteByFamily` like any other choice made on the
 * Defaults tab. Nothing about the record is kept afterwards, and the redirect
 * rules are generated from favorites exactly as before, so a declaration can
 * never put a destination into them that the favorites picker couldn't.
 */

/** What importing a declaration would do for one compat family. */
export type DeclaredFavoritePlan = {
  family: RedirectCompatFamily;
  /** The declared client's display name, or its host. */
  clientName: string;
  /** The favorite this would set, or null when the extension can't use it. */
  waypointId: string | null;
  /**
   * Why `waypointId` is null: the client isn't a catalog waypoint of this
   * family (static redirect rules need a known URL shape), or it is one that
   * needs a DID, which a static rule can't supply.
   */
  reason?: 'not-in-catalog' | 'needs-did';
};

export type DeclarationLookup = {
  did: string;
  handle: string | null;
  /** Null when the account has published no declaration. */
  record: PreferredClientsRecord | null;
};

/** This browser's half of a mobile/desktop split. */
export function currentPlatform(): ClientPlatform {
  if (typeof navigator === 'undefined') return 'desktop';
  return clientPlatformFromUserAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The favorite each family would get from a declaration, for this device.
 * Families the declaration doesn't name are left out; ones it names with a
 * client the extension can't redirect to are kept, with the reason, so the
 * options page can say so instead of quietly skipping them.
 */
export function planDeclaredFavorites(
  record: PreferredClientsRecord,
  platform: ClientPlatform,
): DeclaredFavoritePlan[] {
  const out: DeclaredFavoritePlan[] = [];
  for (const family of COMPAT_FAMILY_ORDER) {
    const client = getPreferredClient(record, family, { platform });
    if (!client) continue;
    const clientName = client.name ?? hostOf(client.url);
    const id = client.waypoint;
    if (!id || !WAYPOINT_DESTINATIONS_DATA[id]?.redirectCompat.includes(family)) {
      out.push({ family, clientName, waypointId: null, reason: 'not-in-catalog' });
    } else if (DID_REQUIRED_WAYPOINTS.has(id)) {
      out.push({ family, clientName, waypointId: null, reason: 'needs-did' });
    } else {
      out.push({ family, clientName, waypointId: id });
    }
  }
  return out;
}

/**
 * Set the planned favorites. A waypoint that isn't in any of the user's
 * groups is adopted into its native one: the favorites picker only lists
 * visible waypoints, and a favorite it can't show would look like no choice
 * at all.
 */
export function applyDeclaredFavorites(prefs: Prefs, plan: DeclaredFavoritePlan[]): Prefs {
  let next = prefs;
  for (const item of plan) {
    if (!item.waypointId) continue;
    next = setFavoriteForFamily(next, item.family, item.waypointId);
    if (!isWaypointVisible(next, item.waypointId)) next = adoptWaypoint(next, item.waypointId);
  }
  return next;
}

/**
 * Fetch an account's declaration from its PDS. Throws when the account can't
 * be resolved or the PDS can't be read; a declaration that doesn't exist is
 * `record: null`, not an error.
 */
export async function fetchDeclaration(identifier: string): Promise<DeclarationLookup> {
  const identity = await resolveIdentifier(identifier);
  try {
    const res = await getRecord(identity.pds, {
      repo: identity.did,
      collection: PREFERRED_CLIENTS_NSID,
      rkey: PREFERRED_CLIENTS_RKEY,
    });
    return {
      did: identity.did,
      handle: identity.handle,
      record: parsePreferredClients(res.value),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/RecordNotFound|Could not locate record/i.test(message)) {
      return { did: identity.did, handle: identity.handle, record: null };
    }
    throw err;
  }
}

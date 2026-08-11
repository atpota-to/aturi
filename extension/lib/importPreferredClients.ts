/**
 * Import a published `to.aturi.actor.preferredClients` record into the
 * extension's own favorites.
 *
 * The extension has no sign-in and no PDS write path, which is deliberate: it
 * is local-first and makes no background network calls. But someone who
 * answered the questions on aturi.to has already said where they want records
 * opened, and making them say it a second time here is the kind of thing that
 * stops people configuring anything at all. So: they name their account, we
 * fetch the public record once, on demand, and map it onto the redirect
 * favorites.
 *
 * The two models don't line up automatically. The record is scoped to
 * lexicons (`app.bsky.*`, `pub.leaflet.*`, `*`); the extension redirects by
 * *compat family* (`bluesky-social`, `standard-site`). `familiesForScope`
 * below bridges them from the catalog rather than a hand-written table, so a
 * new app lands in the right bucket without an edit here.
 */

import {
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  type RedirectCompatFamily,
} from '@aturi/waypoints.data';
import {
  fetchPreferredClients,
  PREFERRED_SCOPE_ALL,
  type PreferredClientRule,
  type PreferredClientsRecord,
} from '@aturi/preferredClients';

/**
 * Which compat families a rule's scope speaks for.
 *
 * A family qualifies when most of its members that declare
 * `expectedCollections` declare a prefix overlapping this scope: the family
 * is *about* that namespace. A majority rather than a unanimous vote because
 * the two fields answer different questions. Anisota sits in both
 * `bluesky-social` and `standard-site` yet declares only `app.bsky.` and
 * `net.anisota.`, since `expectedCollections` says which accounts the app is
 * worth opening for, not which lexicons it can render. Requiring every member
 * to match would disqualify `standard-site` for `pub.leaflet.*` on Anisota's
 * account alone.
 *
 * The majority still blocks the leak that matters: for `app.bsky.*`, exactly
 * one of `standard-site`'s six declaring members matches, so a Bluesky rule
 * cannot quietly claim the publications slot.
 *
 * `*` is special-cased to the generic record explorers. They declare no
 * expected collections at all, by design, since they render anything, so
 * there is nothing to derive from; and "everything else" is exactly the slot
 * they occupy.
 */
export function familiesForScope(scope: string): RedirectCompatFamily[] {
  if (scope === PREFERRED_SCOPE_ALL) return ['atproto-explorer'];

  const prefix = scope.endsWith('.*') ? scope.slice(0, -2) : scope;
  const byFamily = new Map<RedirectCompatFamily, { matched: number; total: number }>();

  for (const id of WAYPOINT_ORDER) {
    const waypoint = WAYPOINT_DESTINATIONS_DATA[id];
    if (!waypoint?.expectedCollections?.length) continue;
    const matches = waypoint.expectedCollections.some((expected) => {
      const exp = expected.endsWith('.') ? expected.slice(0, -1) : expected;
      return (
        prefix === exp || prefix.startsWith(`${exp}.`) || exp.startsWith(`${prefix}.`)
      );
    });
    for (const family of waypoint.redirectCompat) {
      const tally = byFamily.get(family) ?? { matched: 0, total: 0 };
      tally.total += 1;
      if (matches) tally.matched += 1;
      byFamily.set(family, tally);
    }
  }

  const out: RedirectCompatFamily[] = [];
  for (const [family, tally] of byFamily) {
    if (tally.matched * 2 > tally.total) out.push(family);
  }
  return out;
}

/** Rank a scope so the most specific rule gets to claim a family first. */
function specificity(scope: string): number {
  if (scope === PREFERRED_SCOPE_ALL) return 0;
  if (!scope.includes('.')) return 1; // a record kind: post, profile, list, record
  if (scope.endsWith('.*')) return 10 + scope.split('.').length;
  return 1000;
}

/** The rule's first client that the shared catalog knows how to build links for. */
function firstCatalogClient(rule: PreferredClientRule): string | null {
  for (const client of rule.clients) {
    if (client.id && WAYPOINT_DESTINATIONS_DATA[client.id]) return client.id;
  }
  return null;
}

export type ImportedFavorites = Partial<Record<RedirectCompatFamily, string>>;

/**
 * Turn a published record into `favoriteByFamily` entries. Most specific rule
 * wins each family; rules naming a client outside the catalog are skipped,
 * since the extension can only redirect to waypoints it can build a URL for.
 */
export function favoritesFromPreferredClients(
  record: PreferredClientsRecord,
): ImportedFavorites {
  const out: ImportedFavorites = {};
  const rules = [...record.preferences].sort(
    (a, b) => specificity(b.scope) - specificity(a.scope),
  );

  for (const rule of rules) {
    const waypointId = firstCatalogClient(rule);
    if (!waypointId) continue;
    for (const family of familiesForScope(rule.scope)) {
      // A more specific rule already spoke for this family.
      if (out[family]) continue;
      // Only if the chosen client actually belongs to the family, so a rule
      // pointing somewhere unrelated can't hijack the slot.
      if (!WAYPOINT_DESTINATIONS_DATA[waypointId]?.redirectCompat.includes(family)) {
        continue;
      }
      out[family] = waypointId;
    }
  }
  return out;
}

export type ImportResult =
  | { status: 'ok'; favorites: ImportedFavorites; count: number }
  | { status: 'not-found' }
  | { status: 'empty' }
  | { status: 'error'; message: string };

/**
 * Fetch and map in one step. Returns `not-found` when the account has never
 * published, which is the common case and not an error worth alarming about.
 */
export async function importPreferredClients(actor: string): Promise<ImportResult> {
  const trimmed = actor.trim().replace(/^@/, '');
  if (!trimmed) return { status: 'error', message: 'Enter a handle or DID first.' };

  let record: PreferredClientsRecord | null;
  try {
    record = await fetchPreferredClients(trimmed);
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  if (!record) return { status: 'not-found' };

  const favorites = favoritesFromPreferredClients(record);
  const count = Object.keys(favorites).length;
  if (count === 0) return { status: 'empty' };
  return { status: 'ok', favorites, count };
}

/**
 * Avatar backfill for search recommendations. Entries recorded from free-text
 * searches (typing a handle and hitting enter) only know their path + label —
 * unlike typeahead picks they never captured an avatar. When the dropdown is
 * shown we resolve those actor entries against the AppView and write the
 * avatar/display-name back into local history so the look-up only happens
 * once. PDS entries have no actor and are skipped.
 */

import { getProfile } from './atproto/appview';
import {
  actorFromPath,
  enrichEntry,
  type SearchHistoryEntry,
} from './searchHistory';

// Actors we've already tried this session — avoids re-fetching on every render
// or for an account that legitimately has no avatar.
const attempted = new Set<string>();

/**
 * Resolve avatars for any displayed entries that lack one. Returns true if at
 * least one stored entry was updated, so the caller can reload from storage.
 */
export async function enrichRecommendationAvatars(
  entries: SearchHistoryEntry[],
): Promise<boolean> {
  let changed = false;
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.avatar) return;
      const actor = actorFromPath(entry.path);
      if (!actor || attempted.has(actor)) return;
      attempted.add(actor);

      const profile = await getProfile(actor);
      if (!profile) return;

      const patch: Partial<SearchHistoryEntry> = {};
      if (profile.avatar) patch.avatar = profile.avatar;
      if (profile.did) patch.did = profile.did;
      if (profile.handle) patch.handle = profile.handle;
      const displayName = profile.displayName?.trim();
      if (displayName) {
        patch.label = displayName;
        if (profile.handle) patch.sublabel = `@${profile.handle}`;
      }

      if (Object.keys(patch).length === 0) return;
      if (enrichEntry(entry.path, patch)) changed = true;
    }),
  );
  return changed;
}

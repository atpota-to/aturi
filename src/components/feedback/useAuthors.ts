'use client';

import { useEffect, useState } from 'react';
import { getProfiles } from '@/utils/atproto/appview';
import { mapWithConcurrency, resolveMiniDoc } from '@/utils/atproto/slingshot';
import { shortDid } from '@/utils/atproto/urls';

export type Author = {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
};

/** What to render before (or instead of) a resolved identity. */
export function fallbackAuthor(did: string): Author {
  return { did, handle: null, displayName: null, avatar: null };
}

export function authorLabel(author: Author): string {
  return author.displayName || (author.handle ? `@${author.handle}` : shortDid(author.did));
}

/**
 * Resolve a set of DIDs to renderable identities.
 *
 * A feedback board draws its authors from wherever they happen to live, so the
 * Bluesky AppView is a fast path rather than a source of truth: it answers 25
 * DIDs per request and carries avatars, but it only knows accounts it indexes.
 * Anyone it misses gets resolved through Slingshot instead, which yields a
 * handle from the DID document and no avatar — enough to render a name.
 *
 * Resolved identities accumulate across calls, so paging or re-sorting a board
 * never re-resolves an author already on screen.
 */
export function useAuthors(dids: readonly string[]): Map<string, Author> {
  const [authors, setAuthors] = useState<Map<string, Author>>(new Map());

  // The DID set changes identity on every render even when its contents don't;
  // key the effect on the contents so re-sorting a board doesn't refetch.
  const key = Array.from(new Set(dids.filter(Boolean))).sort().join(',');

  useEffect(() => {
    const wanted = key ? key.split(',') : [];
    if (!wanted.length) return undefined;

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      const missing = wanted.filter((did) => !authors.has(did));
      if (!missing.length) return;

      const profiles = await getProfiles(missing, { signal: controller.signal });
      if (cancelled) return;

      const resolved = new Map<string, Author>();
      for (const did of missing) {
        const p = profiles.get(did);
        if (!p) continue;
        resolved.set(did, {
          did,
          handle: p.handle ?? null,
          displayName: p.displayName?.trim() || null,
          avatar: p.avatar ?? null,
        });
      }

      // Publish the AppView hits before chasing the stragglers, so the common
      // case paints without waiting on the slow path.
      if (resolved.size) {
        setAuthors((prev) => new Map([...prev, ...resolved]));
      }

      const stragglers = missing.filter((did) => !resolved.has(did));
      if (!stragglers.length) return;

      const docs = await mapWithConcurrency(stragglers, 6, (did) =>
        resolveMiniDoc(did, controller.signal),
      );
      if (cancelled) return;

      const late = new Map<string, Author>();
      docs.forEach((doc, i) => {
        const did = stragglers[i];
        late.set(did, {
          did,
          handle: doc?.handle ?? null,
          displayName: null,
          avatar: null,
        });
      });
      if (late.size) setAuthors((prev) => new Map([...prev, ...late]));
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `authors` is read to skip already-resolved DIDs but must not retrigger
    // the effect — doing so would loop on every successful resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return authors;
}

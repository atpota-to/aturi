'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';

/**
 * The account the frame resolved, for the pages inside it. `repo` is the
 * route's repo segment, decoded, so a page asks for the account it was
 * mounted for and gets this one only when the two agree.
 */
export type FrameAccount = { repo: string; identity: IdentityBundle | null; error: string | null };

export const FrameContext = createContext<FrameAccount | null>(null);

/**
 * The account behind a repo segment: the frame's when the page is inside the
 * frame for that repo, else resolved here. Inside the frame, moving from the
 * repo page to a collection or a record finds the account already resolved,
 * so the page draws at once instead of showing its skeleton while the same
 * handle is looked up again.
 */
export function useRepoIdentity(repo: string): { identity: IdentityBundle | null; error: string | null } {
  const frame = useContext(FrameContext);
  const framed = frame !== null && frame.repo === repo;
  const [own, setOwn] = useState<FrameAccount | null>(null);

  useEffect(() => {
    if (framed) return;
    let cancelled = false;
    resolveIdentifier(repo)
      .then((identity) => {
        if (!cancelled) setOwn({ repo, identity, error: null });
      })
      .catch((err) => {
        if (!cancelled) setOwn({ repo, identity: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [repo, framed]);

  if (framed) return { identity: frame.identity, error: frame.error };
  if (own && own.repo === repo) return own;
  return { identity: null, error: null };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  describeUniversalLink,
  type DescribeUniversalLinkOptions,
  type UniversalLink,
  type UniversalLinkTarget,
} from '@aturi.to/waypoints';

export type UseUniversalLinkParams = DescribeUniversalLinkOptions & {
  /**
   * The record or identity to link to: an AT URI, a handle, a DID, a page URL
   * from any client in the catalog, or a `ParsedURI`.
   */
  target: UniversalLinkTarget;
  /**
   * How long `copied` stays true, in ms. Default 2000. Pass 0 to leave it set
   * and reset it yourself.
   */
  resetAfterMs?: number;
};

/**
 * What `share()` did. `dismissed` means the user closed the native sheet
 * without sharing. It's deliberately distinct from `failed`, since silently
 * copying to the clipboard after someone backs out of a share is a surprise.
 */
export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

export type UseUniversalLinkResult = {
  /** Null when the target doesn't name a record or an identity. */
  link: UniversalLink | null;
  url: string | null;
  atUri: string | null;
  copied: boolean;
  /** Copy the link, or any string you pass (e.g. `link.snippets.markdown`). */
  copy: (text?: string) => Promise<boolean>;
  /** `navigator.share` where the browser implements it, the clipboard where it doesn't. */
  share: () => Promise<ShareOutcome>;
  /**
   * Whether this browser implements `navigator.share`. Always false on the
   * server and on the first client render, so it can't desync hydration.
   * Branch on it for the icon, not for whether to render the control at all.
   */
  canShare: boolean;
};

/**
 * Headless hook for offering a universal link: the link itself, plus copy and
 * share actions with the transient "Copied" state already wired up.
 *
 * ```tsx
 * const { url, copy, copied } = useUniversalLink({ target: post.uri });
 * return <button onClick={() => copy()}>{copied ? 'Copied' : url}</button>;
 * ```
 */
export function useUniversalLink(
  params: UseUniversalLinkParams,
): UseUniversalLinkResult {
  const {
    target,
    resetAfterMs = 2000,
    origin,
    did,
    preferDid,
    params: queryParams,
    title,
    text,
  } = params;

  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `navigator.share` is read after mount rather than during render: the
  // server has no navigator, and a first render that disagreed with the
  // server's would be a hydration mismatch.
  useEffect(() => {
    setCanShare(
      typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    );
  }, []);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  // Serialized so an inline object literal (`target={{...}}`, `params={{...}}`)
  // doesn't produce a new link on every render.
  const targetKey = typeof target === 'string' ? target : JSON.stringify(target);
  const queryParamsKey = queryParams ? JSON.stringify(queryParams) : '';

  const link = useMemo(
    () =>
      describeUniversalLink(target, {
        origin,
        did,
        preferDid,
        params: queryParams,
        title,
        text,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey, origin, did, preferDid, queryParamsKey, title, text],
  );

  const copy = useCallback(
    async (value?: string): Promise<boolean> => {
      const payload = value ?? link?.url;
      if (!payload) return false;
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(payload);
          setCopied(true);
          if (resetTimer.current) clearTimeout(resetTimer.current);
          if (resetAfterMs > 0) {
            resetTimer.current = setTimeout(() => setCopied(false), resetAfterMs);
          }
          return true;
        }
      } catch {
        // Denied permission or an insecure context; report it as a miss so the
        // caller can fall back to showing the URL.
      }
      return false;
    },
    [link, resetAfterMs],
  );

  const share = useCallback(async (): Promise<ShareOutcome> => {
    if (!link) return 'failed';
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(link.share);
        return 'shared';
      } catch (error) {
        if ((error as { name?: string } | null)?.name === 'AbortError') {
          return 'dismissed';
        }
      }
    }
    return (await copy()) ? 'copied' : 'failed';
  }, [link, copy]);

  return {
    link,
    url: link?.url ?? null,
    atUri: link?.atUri ?? null,
    copied,
    copy,
    share,
    canShare,
  };
}

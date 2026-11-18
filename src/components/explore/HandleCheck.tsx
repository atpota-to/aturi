'use client';

import Link from 'next/link';
import { Check, TriangleAlert } from 'lucide-react';
import { useHandleVerification, type HandleVerification } from './useHandleVerification';

/**
 * Whether an account's handle resolves back to it, with the handle debugger
 * (/tools/handle) one click away.
 *
 * Two sizes. The account card's Handle row takes the mark alone: a quiet
 * check when the handle verifies, and a labelled warning when it does not,
 * since that is the case worth reading. The Identity tab takes a sentence.
 * Neither says anything while the answer is unknown.
 */

const WORDS: Record<Exclude<HandleVerification, 'pending' | 'unknown'>, { short: string; long: string }> = {
  verified: {
    short: 'Verified',
    long: 'This handle resolves back to this DID, so the two point at each other.',
  },
  mismatch: {
    short: 'Belongs to another account',
    long: 'This handle now resolves to a different DID. The account still claims it, but the domain points elsewhere.',
  },
  unresolved: {
    short: 'Does not resolve',
    long: 'This handle does not resolve to any DID, so apps show the account as handle.invalid.',
  },
};

function debuggerHref(handle: string): string {
  return `/tools/handle?handle=${encodeURIComponent(handle)}`;
}

/** The mark beside a handle. Renders nothing until there is a definite answer. */
export function HandleCheckMark({ did, handle }: { did: string; handle: string }) {
  const state = useHandleVerification(did, handle);
  if (state === 'pending' || state === 'unknown') return null;
  const ok = state === 'verified';
  return (
    // The debugger page is static, so this link keeps its prefetch; nofollow
    // because it carries a handle, and every account card would otherwise
    // offer a crawler one more URL per account.
    <Link
      href={debuggerHref(handle)}
      rel="nofollow"
      className="fx-handle-check"
      data-state={ok ? 'ok' : 'bad'}
      title={`${WORDS[state].long} Open the handle debugger.`}
      aria-label={`${WORDS[state].short}. Open the handle debugger.`}
    >
      {ok ? <Check size={11} strokeWidth={2.8} aria-hidden /> : <TriangleAlert size={11} aria-hidden />}
      {!ok && <span>{state === 'mismatch' ? 'taken' : 'invalid'}</span>}
    </Link>
  );
}

/** The same answer in a sentence, for the Identity tab. */
export function HandleCheckLine({ did, handle }: { did: string; handle: string }) {
  const state = useHandleVerification(did, handle);
  const settled = state !== 'pending' && state !== 'unknown';
  return (
    <div className="fx-handle-line" data-state={settled ? (state === 'verified' ? 'ok' : 'bad') : undefined}>
      <div className="fx-handle-line-main">
        <code>@{handle}</code>
        <p>
          {state === 'pending'
            ? 'Checking whether this handle resolves back to this DID…'
            : state === 'unknown'
              ? 'The resolvers could not be reached, so this handle was not checked.'
              : WORDS[state].long}
        </p>
      </div>
      <Link href={debuggerHref(handle)} rel="nofollow" className="fx-btn fx-btn-sm">
        Debug this handle
      </Link>
    </div>
  );
}

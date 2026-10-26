'use client';

import { useCallback, useState } from 'react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { rememberCurrentPathForReturn } from '@/lib/oauth/returnTo';
import { describeSignInError } from '@/lib/oauth/signInError';

/**
 * The two-step OAuth sign-in flow: enter a handle/DID, pick which scopes to
 * grant, then redirect out to the provider. Three surfaces render it —
 * <SessionMenu> (nav dropdown), <SessionPanel> (compact header stack), and
 * <SignInPanel> (record-view action row) — and each previously carried its own
 * byte-identical copy of this state machine and the scope-submit handler. They
 * share it here so the auth path lives in one place.
 *
 * The `idle` step exists for surfaces (SessionPanel) that show a collapsed
 * entry point before the flow begins; surfaces that are always "open" start at
 * `handle`. The handle input value itself stays with the caller, since each
 * surface seeds and styles it differently.
 */
export type SignInStep = 'idle' | 'handle' | 'scopes';

export function useSignInFlow(initialStep: SignInStep = 'handle') {
  const { signIn } = useAtprotoSession();
  const [step, setStep] = useState<SignInStep>(initialStep);
  const [pendingAccount, setPendingAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // handle → scopes: stash the trimmed account and advance. A blank handle is
  // a no-op, matching each inline form's `if (!v) return` guard.
  const proceedToScopes = useCallback((rawValue: string) => {
    const v = rawValue.trim();
    if (!v) return;
    setError(null);
    setPendingAccount(v);
    setStep('scopes');
  }, []);

  // scopes → handle (the ScopeSelector "back" affordance).
  const backToHandle = useCallback(() => {
    setStep('handle');
    setError(null);
  }, []);

  // Final step: remember where to return, then redirect out to the OAuth
  // provider. On success the browser navigates away; on failure we clear busy
  // and surface the message so the user can retry.
  const submitScopes = useCallback(
    async (scopeString: string) => {
      setBusy(true);
      setError(null);
      try {
        rememberCurrentPathForReturn();
        await signIn(pendingAccount, scopeString);
      } catch (err) {
        setBusy(false);
        // Rewritten where we can place it: a server refusing a scope it has
        // simply not re-fetched yet reads as permanent otherwise.
        setError(describeSignInError(err instanceof Error ? err.message : String(err)));
      }
    },
    [pendingAccount, signIn],
  );

  // Return the flow to its resting `handle` step (used when a popover closes).
  const reset = useCallback(() => {
    setStep('handle');
    setPendingAccount('');
    setBusy(false);
    setError(null);
  }, []);

  return {
    step,
    setStep,
    pendingAccount,
    busy,
    error,
    setError,
    proceedToScopes,
    backToHandle,
    submitScopes,
    reset,
  };
}

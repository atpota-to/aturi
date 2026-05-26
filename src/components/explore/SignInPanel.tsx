'use client';

import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import ScopeSelector from '@/components/oauth/ScopeSelector';
import { rememberCurrentPathForReturn } from '@/lib/oauth/returnTo';

/**
 * Compact sign-in form used inside the record view's action row. Accepts a
 * handle / DID; redirects out to the user's OAuth provider via a two-step
 * flow that lets the user pick which permissions to grant.
 */
export default function SignInPanel({ defaultInput }: { defaultInput?: string }) {
  const { signIn } = useAtprotoSession();
  const [value, setValue] = useState(defaultInput || '');
  const [step, setStep] = useState<'handle' | 'scopes'>('handle');
  const [pendingAccount, setPendingAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (step === 'scopes') {
    return (
      <div
        style={{
          padding: '0.75rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          maxWidth: '24rem',
        }}
      >
        <ScopeSelector
          account={pendingAccount}
          busy={busy}
          error={error}
          onBack={() => {
            setStep('handle');
            setError(null);
          }}
          onContinue={async (scopeString) => {
            setBusy(true);
            setError(null);
            try {
              rememberCurrentPathForReturn();
              await signIn(pendingAccount, scopeString);
            } catch (err) {
              setBusy(false);
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        setError(null);
        setPendingAccount(v);
        setStep('scopes');
      }}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'stretch',
        gap: '0.5rem',
      }}
    >
      <input
        type="text"
        autoComplete="username"
        spellCheck={false}
        placeholder="handle or DID"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{
          flex: '1 1 220px',
          minWidth: 0,
          padding: '0.55rem 0.75rem',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-medium)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          outline: 'none',
        }}
      />
      <button
        type="submit"
        disabled={!value.trim()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.55rem 1rem',
          background: 'var(--accent-moss)',
          color: 'var(--text-on-accent)',
          border: '1px solid var(--accent-moss)',
          fontFamily: 'var(--font-serif)',
          fontSize: '0.875rem',
          cursor: 'pointer',
          opacity: !value.trim() ? 0.6 : 1,
        }}
      >
        <LogIn size={14} />
        Sign in
      </button>
      {error && (
        <p
          style={{
            flexBasis: '100%',
            color: 'var(--danger)',
            fontSize: '0.8125rem',
            margin: 0,
          }}
        >
          {error}
        </p>
      )}
    </form>
  );
}

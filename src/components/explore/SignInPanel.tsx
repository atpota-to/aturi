'use client';

import { useState } from 'react';
import { LogIn } from 'lucide-react';
import HandleTypeaheadInput from '@/components/oauth/HandleTypeaheadInput';
import ScopeSelector from '@/components/oauth/ScopeSelector';
import { useSignInFlow } from '@/components/oauth/useSignInFlow';

/**
 * Compact sign-in form used inside the record view's action row. Accepts a
 * handle / DID; redirects out to the user's OAuth provider via a two-step
 * flow that lets the user pick which permissions to grant.
 */
export default function SignInPanel({ defaultInput }: { defaultInput?: string }) {
  const [value, setValue] = useState(defaultInput || '');
  const { step, pendingAccount, busy, error, proceedToScopes, backToHandle, submitScopes } =
    useSignInFlow();

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
          onBack={backToHandle}
          onContinue={submitScopes}
        />
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        proceedToScopes(value);
      }}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'stretch',
        gap: '0.5rem',
      }}
    >
      {/* The wrapper takes over the flex sizing, since it's now the flex item
          and the dropdown positions against it. */}
      <HandleTypeaheadInput
        value={value}
        onChange={setValue}
        placeholder="handle or DID"
        wrapperStyle={{ flex: '1 1 220px' }}
        inputStyle={{
          width: '100%',
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

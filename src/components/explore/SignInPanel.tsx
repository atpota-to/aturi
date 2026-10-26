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
      <div className="signin-panel-scopes">
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
      className="signin-panel"
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
          height: 36,
          boxSizing: 'border-box',
          padding: '0 12px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-control)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          outline: 'none',
        }}
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="settings-btn is-primary"
      >
        <LogIn size={14} />
        Sign in
      </button>
      {error && (
        <p className="signin-panel-error">{error}</p>
      )}
    </form>
  );
}

'use client';

import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';

/**
 * Compact sign-in form used inside the record view's action row. Accepts a
 * handle / DID; redirects out to the user's OAuth provider.
 */
export default function SignInPanel({ defaultInput }: { defaultInput?: string }) {
  const { signIn } = useAtprotoSession();
  const [value, setValue] = useState(defaultInput || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(v);
      // signIn redirects; this is unreachable in normal flow.
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
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
        disabled={busy}
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
        disabled={busy || !value.trim()}
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
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy || !value.trim() ? 0.6 : 1,
        }}
      >
        <LogIn size={14} />
        {busy ? 'Redirecting…' : 'Sign in'}
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

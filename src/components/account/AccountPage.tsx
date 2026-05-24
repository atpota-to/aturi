'use client';

import { useState } from 'react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import ScopeSelector from '@/components/oauth/ScopeSelector';
import SettingsShell from './SettingsShell';

/**
 * /account page. When signed out, renders the two-step sign-in flow.
 * When signed in, renders the tabbed settings shell.
 */
export default function AccountPage() {
  const { session, signIn, loading } = useAtprotoSession();
  const [input, setInput] = useState('');
  const [step, setStep] = useState<'handle' | 'scopes'>('handle');
  const [pendingAccount, setPendingAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return <p className="explore-placeholder">Loading account…</p>;
  }

  if (!session) {
    return (
      <div style={{ maxWidth: '32rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 300, marginBottom: '0.75rem' }}>
          Sign in to customize Aturi
        </h1>
        <p
          style={{
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            marginBottom: '1.5rem',
          }}
        >
          Reorder waypoints, hide ones you don&rsquo;t use, or add your own. Your
          preferences sync to your PDS so they follow you across devices.
        </p>
        {step === 'handle' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = input.trim();
              if (!v) return;
              setError(null);
              setPendingAccount(v);
              setStep('scopes');
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}
          >
            <input
              type="text"
              autoComplete="username"
              spellCheck={false}
              placeholder="handle.bsky.social or did:plc:…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              style={{
                padding: '0.75rem 0.875rem',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              style={{
                padding: '0.75rem 1rem',
                background: 'var(--accent-moss)',
                color: 'var(--text-on-accent)',
                border: '1px solid var(--accent-moss)',
                fontFamily: 'var(--font-serif)',
                fontSize: '0.95rem',
                cursor: 'pointer',
                opacity: !input.trim() ? 0.6 : 1,
              }}
            >
              Next: choose permissions →
            </button>
          </form>
        ) : (
          <div
            style={{
              padding: '1rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
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
                  await signIn(pendingAccount, scopeString);
                } catch (err) {
                  setBusy(false);
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </div>
        )}
        <p
          style={{
            marginTop: '1.5rem',
            color: 'var(--text-tertiary)',
            fontSize: '0.8125rem',
          }}
        >
          You&rsquo;ll be redirected to your PDS to authorize Aturi. Uncheck any
          permission above you don&rsquo;t want to grant — reads always work
          since your repo is public.
        </p>
      </div>
    );
  }

  return <SettingsShell />;
}

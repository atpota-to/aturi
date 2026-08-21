'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import HandleTypeaheadInput from '@/components/oauth/HandleTypeaheadInput';
import ScopeSelector from '@/components/oauth/ScopeSelector';
import { useSignInFlow } from '@/components/oauth/useSignInFlow';
import { encodeRepo } from '@/utils/atproto/urls';
import AppearIn from '../AppearIn';
import { useSpaceGrant } from './useSpaceAccess';

/**
 * `/explore/spaces` — the way in for someone who has heard about atproto
 * spaces and wants to see their own.
 *
 * Signed out it is a sign-in form and nothing else. Signed in it is one
 * button. The page deliberately does not try to explain the protocol: the
 * explaining belongs on the pages that show real data, next to the thing being
 * explained.
 *
 * On "does your PDS support spaces": there is no way to ask before signing in.
 * An authorization server's metadata says nothing about spaces — `scopes_supported`
 * is a fixed list that doesn't enumerate the dynamic atproto scopes — so the
 * only honest signal is whether a `space:` grant came back on the token. A
 * server that has never heard of the scope drops it silently, which is
 * indistinguishable here from a user who left the box unticked. The copy says
 * so rather than guessing at one or the other.
 */
export default function SpacesLanding() {
  const { session, did, loading } = useAtprotoSession();
  const grant = useSpaceGrant();
  const [value, setValue] = useState('');
  const { step, pendingAccount, busy, error, proceedToScopes, backToHandle, submitScopes } =
    useSignInFlow();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '34rem' }}>
      <AppearIn rise>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--font-serif)',
              fontWeight: 400,
              fontSize: '1.75rem',
              color: 'var(--text-primary)',
            }}
          >
            Atproto spaces
          </h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Records kept outside your public repo — settings, drafts, private
            boards, anything an app stores where the whole network can’t read
            it. Sign in to browse your own.
          </p>
        </div>
      </AppearIn>

      {loading ? null : session ? (
        <AppearIn delay={0.05}>
          <SignedIn did={did} grant={grant} />
        </AppearIn>
      ) : (
        <AppearIn delay={0.05}>
          {step === 'scopes' ? (
            <div
              style={{
                padding: '0.75rem',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
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
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                proceedToScopes(value);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}
            >
              <HandleTypeaheadInput
                value={value}
                onChange={setValue}
                placeholder="handle.bsky.social"
                inputStyle={{
                  width: '100%',
                  padding: '0.625rem 0.75rem',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.875rem',
                  outline: 'none',
                }}
              />
              <button type="submit" disabled={!value.trim()} style={primaryButtonStyle(!value.trim())}>
                Sign in to see your spaces
              </button>
              <p style={noteStyle}>
                You’ll be asked which permissions to grant. Tick a
                permissioned-data row — without one there is nothing to read.
              </p>
            </form>
          )}
        </AppearIn>
      )}
    </div>
  );
}

function SignedIn({ did, grant }: { did: string | null; grant: ReturnType<typeof useSpaceGrant> }) {
  const { signIn } = useAtprotoSession();
  const [busy, setBusy] = useState(false);

  if (grant === 'unknown') {
    return <p className="explore-placeholder">Checking your access…</p>;
  }

  if (grant === 'read' || grant === 'read_self') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        <Link
          href={`/explore/${encodeRepo(did ?? '')}/space`}
          style={{ ...primaryButtonStyle(false), display: 'block', textAlign: 'center', textDecoration: 'none' }}
        >
          View my spaces →
        </Link>
        {grant === 'read_self' && (
          <p style={noteStyle}>
            Your grant covers your own records. Reading other members’ records
            in a space needs the wider permissioned-data row.
          </p>
        )}
      </div>
    );
  }

  // Granted nothing. Either the server dropped a scope it didn't recognise or
  // the row was left unticked, and the two are indistinguishable from here —
  // so offer the retry rather than diagnosing.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      <p style={noteStyle}>
        This session has no permissioned-data grant. Either your server doesn’t
        support spaces yet — it’s an alpha, and most don’t — or the permission
        wasn’t granted at sign-in.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          // Re-runs the flow against the same account, so the picker comes back
          // up with the permissioned-data rows available to tick.
          void signIn(did ?? '').catch(() => setBusy(false));
        }}
        style={primaryButtonStyle(busy)}
      >
        {busy ? 'Redirecting…' : 'Sign in again and grant it'}
      </button>
    </div>
  );
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '0.625rem 1rem',
    background: 'var(--accent-moss)',
    color: 'var(--text-on-accent)',
    border: '1px solid var(--accent-moss)',
    fontFamily: 'var(--font-serif)',
    fontSize: '0.9375rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-tertiary)',
};

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, LogIn, LogOut, Settings, Telescope, User } from 'lucide-react';
import { useAtprotoSession } from './AtprotoSessionProvider';
import ScopeSelector from './oauth/ScopeSelector';
import { rememberCurrentPathForReturn } from '@/lib/oauth/returnTo';
import { getProfile, type AppViewProfile } from '@/utils/atproto/appview';
import { encodeRepo } from '@/utils/atproto/urls';

type Props = {
  /** Called when the user clicks a nav link — lets the parent close the menu. */
  onNavigate?: () => void;
  /**
   * Notifies the parent when the sign-in flow is taking over the panel
   * (handle input or scope picker visible). The compact header uses
   * this to hide unrelated nav rows so the form doesn't push the panel
   * to a tall, scrolly layout.
   */
  onSignInActiveChange?: (active: boolean) => void;
};

type SignInStep = 'idle' | 'handle' | 'scopes';

/**
 * Inline session UI for the compact header's expanding menu panel. Renders
 * as a stack of compact-nav-link rows, NOT a dropdown (the parent panel
 * is already a popover). When signed out: a "Sign in" row that expands
 * into a handle input + scope picker so the OAuth flow happens without
 * leaving the current page. When signed in: a small "signed in as
 * @handle" header and quick actions for the user's repo / settings /
 * sign-out.
 */
export default function SessionPanel({ onNavigate, onSignInActiveChange }: Props) {
  const { session, did, signIn, signOut, loading } = useAtprotoSession();
  const [profile, setProfile] = useState<AppViewProfile | null>(null);
  const [signInStep, setSignInStep] = useState<SignInStep>('idle');
  const [signInValue, setSignInValue] = useState('');
  const [pendingAccount, setPendingAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirror the flow's active/idle status up to the parent so it can
  // hide adjacent nav rows while the form is taking over the panel.
  // No setState inside — just a prop call — so this stays compliant
  // with react-hooks/set-state-in-effect.
  useEffect(() => {
    onSignInActiveChange?.(signInStep !== 'idle');
  }, [signInStep, onSignInActiveChange]);

  useEffect(() => {
    if (!did) {
      setProfile(null);
      return undefined;
    }
    let cancelled = false;
    getProfile(did).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [did]);

  if (loading) return null;

  // ─── Signed out ─────────────────────────────────────────────────────────
  if (!session) {
    if (signInStep === 'handle') {
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = signInValue.trim();
            if (!v) return;
            setError(null);
            setPendingAccount(v);
            setSignInStep('scopes');
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            padding: '0.625rem 0.75rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={headerRowStyle()}>
            <button
              type="button"
              onClick={() => {
                setSignInStep('idle');
                setError(null);
              }}
              aria-label="Back"
              style={iconBackButtonStyle()}
            >
              <ArrowLeft size={14} />
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                Sign in with your handle
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                You&rsquo;ll come back to this page when finished.
              </div>
            </div>
          </div>
          <input
            type="text"
            autoComplete="username"
            spellCheck={false}
            autoFocus
            placeholder="handle.bsky.social or did:plc:…"
            value={signInValue}
            onChange={(e) => setSignInValue(e.target.value)}
            style={inputStyle()}
          />
          <button
            type="submit"
            disabled={!signInValue.trim()}
            style={primaryButtonStyle({ disabled: !signInValue.trim() })}
          >
            Next →
          </button>
        </form>
      );
    }

    if (signInStep === 'scopes') {
      return (
        <div
          style={{
            padding: '0.625rem 0.75rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <ScopeSelector
            account={pendingAccount}
            busy={busy}
            error={error}
            onBack={() => {
              setSignInStep('handle');
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
      <button
        type="button"
        onClick={() => {
          setError(null);
          setSignInStep('handle');
        }}
        className="compact-nav-link"
        style={{ font: 'inherit', textAlign: 'left', width: '100%' }}
      >
        <LogIn size={16} />
        <span>sign in</span>
      </button>
    );
  }

  // ─── Signed in ──────────────────────────────────────────────────────────
  const handle = profile?.handle || (did ? did.slice(0, 24) : null);
  const displayName = profile?.displayName?.trim() || handle;
  const avatar = profile?.avatar;

  return (
    <>
      {/* Identity card. Uses the same border / background / padding as the
          compact-nav-link rows that follow so the section reads as a
          coherent stack instead of an un-styled header floating above a
          list of action cards. The avatar is sized slightly larger than
          the row icons (32 vs 16) to give the user's identity some
          presence without breaking horizontal alignment. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.625rem 0.75rem',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            width={32}
            height={32}
            style={{
              width: 32,
              height: 32,
              objectFit: 'cover',
              flexShrink: 0,
              background: 'var(--bg-secondary)',
            }}
          />
        ) : (
          <span
            style={{
              width: 32,
              height: 32,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-secondary)',
              color: 'var(--text-tertiary)',
              flexShrink: 0,
            }}
          >
            <User size={16} />
          </span>
        )}
        <div style={{ minWidth: 0, lineHeight: 1.25, flex: 1 }}>
          <div
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </div>
          {handle && (
            <div
              style={{
                marginTop: '0.125rem',
                fontSize: '0.7rem',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              @{handle}
            </div>
          )}
        </div>
      </div>

      {did && (
        <Link
          href={`/explore/${encodeRepo(did)}`}
          className="compact-nav-link"
          onClick={onNavigate}
        >
          <Telescope size={16} />
          <span>my repo</span>
        </Link>
      )}
      <Link href="/account" className="compact-nav-link" onClick={onNavigate}>
        <Settings size={16} />
        <span>account</span>
      </Link>
      <button
        type="button"
        onClick={async () => {
          onNavigate?.();
          await signOut();
        }}
        className="compact-nav-link"
        style={{
          // The class styles a hover-translate which conflicts a bit with
          // a button; override font defaults so it matches the link rows.
          font: 'inherit',
          textAlign: 'left',
          color: 'var(--danger)',
          width: '100%',
        }}
      >
        <LogOut size={16} />
        <span>sign out</span>
      </button>
    </>
  );
}

// ─── Style helpers ────────────────────────────────────────────────────────

function headerRowStyle(): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  };
}

function iconBackButtonStyle(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    flexShrink: 0,
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '0.5rem 0.625rem',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-medium)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8125rem',
    outline: 'none',
  };
}

function primaryButtonStyle({ disabled }: { disabled?: boolean } = {}): React.CSSProperties {
  return {
    padding: '0.5rem',
    background: 'var(--accent-moss)',
    color: 'var(--text-on-accent)',
    border: '1px solid var(--accent-moss)',
    fontFamily: 'var(--font-serif)',
    fontSize: '0.875rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, LogIn, LogOut, Settings, Telescope, User } from 'lucide-react';
import { useAtprotoSession } from './AtprotoSessionProvider';
import ScopeSelector from './oauth/ScopeSelector';
import { useSignInFlow } from './oauth/useSignInFlow';
import { useSessionProfile } from './useSessionProfile';
import { encodeRepo } from '@/utils/atproto/urls';

type Variant = 'compact' | 'inline' | 'pill';

/**
 * Session control for the nav. Renders a "Sign in" button when signed out
 * and an avatar pill (with a small menu) when signed in.
 *
 * Three visual variants to fit the different Header modes:
 *   - 'compact' — fits the universal-link compact header card
 *   - 'inline'  — fits the simple / default header's centered nav row
 *   - 'pill'    — standalone (used in account-page header context)
 */
export default function SessionMenu({ variant = 'inline' }: { variant?: Variant }) {
  const { session, did, signOut, loading } = useAtprotoSession();
  const [open, setOpen] = useState(false);
  const [signInInput, setSignInInput] = useState('');
  const { step, pendingAccount, busy, error, proceedToScopes, backToHandle, submitScopes, reset } =
    useSignInFlow();
  const profile = useSessionProfile(did);
  const rootRef = useRef<HTMLDivElement>(null);

  function closePopover() {
    setOpen(false);
    reset();
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        closePopover();
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (loading) return null;

  // ─── Signed out ─────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div ref={rootRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => (open ? closePopover() : setOpen(true))}
          aria-expanded={open}
          aria-haspopup="dialog"
          style={triggerButtonStyle(variant)}
        >
          <LogIn size={variant === 'inline' ? 14 : 12} />
          <span>Sign in</span>
        </button>
        {open && step === 'handle' && (
          <SignInPopover
            value={signInInput}
            onChange={setSignInInput}
            busy={busy}
            error={error}
            onSubmit={() => proceedToScopes(signInInput)}
          />
        )}
        {open && step === 'scopes' && (
          <div role="dialog" aria-label="Select permissions" style={menuStyle({ width: '20rem' })}>
            <div style={{ padding: '0.75rem' }}>
              <ScopeSelector
                account={pendingAccount}
                busy={busy}
                error={error}
                onBack={backToHandle}
                onContinue={submitScopes}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Signed in ──────────────────────────────────────────────────────────
  const handle = profile?.handle || did?.slice(0, 24);
  const displayName = profile?.displayName?.trim() || handle;
  const avatar = profile?.avatar;

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={handle || ''}
        style={pillStyle(variant)}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            width={20}
            height={20}
            style={{ width: 20, height: 20, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <span
            style={{
              width: 20,
              height: 20,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-tertiary)',
              flexShrink: 0,
            }}
          >
            <User size={12} />
          </span>
        )}
        <span
          style={{
            maxWidth: variant === 'compact' ? '6rem' : '8rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayName}
        </span>
        <ChevronDown size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
      </button>

      {open && did && (
        <div role="menu" style={menuStyle()}>
          <div style={menuHeaderStyle()}>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>
              {displayName}
            </div>
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
                wordBreak: 'break-all',
              }}
            >
              @{handle}
            </div>
          </div>
          <MenuLink
            href={`/explore/${encodeRepo(did)}`}
            icon={<Telescope size={13} />}
            label="My repo in Explorer"
            onClick={() => setOpen(false)}
          />
          <MenuLink
            href="/account"
            icon={<Settings size={13} />}
            label="Settings"
            onClick={() => setOpen(false)}
          />
          <button
            type="button"
            onClick={async () => {
              setOpen(false);
              await signOut();
            }}
            style={menuItemStyle({ danger: true })}
          >
            <LogOut size={13} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function SignInPopover({
  value,
  onChange,
  busy,
  error,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  return (
    <div role="dialog" aria-label="Sign in to Aturi" style={menuStyle({ width: '20rem' })}>
      <div style={menuHeaderStyle()}>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>
          Sign in with your atproto handle
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
          We&rsquo;ll ask which permissions to grant before redirecting.
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        style={{ padding: '0.625rem 0.75rem 0.75rem' }}
      >
        <input
          type="text"
          autoComplete="username"
          spellCheck={false}
          placeholder="handle.bsky.social or did:plc:…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy}
          style={{
            width: '100%',
            padding: '0.5rem 0.625rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8125rem',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          style={{
            marginTop: '0.5rem',
            width: '100%',
            padding: '0.5rem',
            background: 'var(--accent-moss)',
            color: 'var(--text-on-accent)',
            border: '1px solid var(--accent-moss)',
            fontFamily: 'var(--font-serif)',
            fontSize: '0.875rem',
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy || !value.trim() ? 0.6 : 1,
          }}
        >
          {busy ? 'Redirecting…' : 'Next →'}
        </button>
        {error && (
          <p style={{ marginTop: '0.5rem', color: 'var(--danger)', fontSize: '0.75rem' }}>
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

function MenuLink({
  href,
  icon,
  label,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link href={href} onClick={onClick} style={menuItemStyle()}>
      {icon}
      <span>{label}</span>
    </Link>
  );
}

// ─── Style helpers ─────────────────────────────────────────────────────────

function triggerButtonStyle(variant: Variant): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-serif)',
    cursor: 'pointer',
    transition: 'border-color 0.2s ease, color 0.2s ease',
  };
  if (variant === 'inline') {
    return { ...base, padding: '0.5rem 0.875rem', fontSize: '0.95rem' };
  }
  return { ...base, padding: '0.35rem 0.625rem', fontSize: '0.8125rem' };
}

function pillStyle(variant: Variant): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: variant === 'inline' ? '0.4rem 0.625rem' : '0.3rem 0.5rem',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-serif)',
    fontSize: variant === 'inline' ? '0.9rem' : '0.8125rem',
    cursor: 'pointer',
    transition: 'border-color 0.2s ease, color 0.2s ease',
  };
  return base;
}

function menuStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    position: 'absolute',
    top: 'calc(100% + 0.5rem)',
    right: 0,
    minWidth: '14rem',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-medium)',
    boxShadow: 'var(--shadow-overlay)',
    zIndex: 60,
    display: 'flex',
    flexDirection: 'column',
    ...extra,
  };
}

function menuHeaderStyle(): React.CSSProperties {
  return {
    padding: '0.625rem 0.75rem',
    borderBottom: '1px solid var(--border-subtle)',
  };
}

function menuItemStyle({ danger }: { danger?: boolean } = {}): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    background: 'transparent',
    border: 0,
    color: danger ? 'var(--danger)' : 'var(--text-secondary)',
    fontFamily: 'var(--font-serif)',
    fontSize: '0.8125rem',
    cursor: 'pointer',
    textDecoration: 'none',
    textAlign: 'left',
  };
}

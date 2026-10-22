'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, LogOut, Settings, Telescope, User } from 'lucide-react';
import { useAtprotoSession } from './AtprotoSessionProvider';
import HandleTypeaheadInput from './oauth/HandleTypeaheadInput';
import ScopeSelector from './oauth/ScopeSelector';
import { useSignInFlow } from './oauth/useSignInFlow';
import { useSessionProfile } from './useSessionProfile';
import { encodeRepo } from '@/utils/atproto/urls';
import { isEventOutside } from '@/lib/outsideClick';

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
      // See isEventOutside: the sign-in typeahead in here removes the row you
      // just clicked, and `contains` would call that an outside click.
      if (isEventOutside(rootRef.current, e)) {
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
          className="fn-session-trigger"
          style={triggerButtonStyle(variant)}
        >
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
        className="fn-session-trigger"
        style={pillStyle(variant)}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            width={26}
            height={26}
            style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--accent-soft)',
              color: 'var(--accent-soft-fg)',
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
            <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
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
            className="fn-session-item"
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
        <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
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
        <HandleTypeaheadInput
          value={value}
          onChange={onChange}
          placeholder="handle.bsky.social or did:plc:…"
          disabled={busy}
          inputStyle={{
            width: '100%',
            height: 36,
            boxSizing: 'border-box',
            padding: '0 0.75rem',
            background: 'var(--surface-subtle)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-control)',
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
            height: 36,
            padding: '0 0.875rem',
            background: 'var(--accent-moss)',
            color: 'var(--text-on-accent)',
            border: '1px solid var(--accent-moss)',
            borderRadius: 'var(--radius-control)',
            fontFamily: 'var(--font-sans)',
            fontSize: '0.875rem',
            fontWeight: 600,
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
    // `prefetch={false}`: a row in a popover the reader has to open first, so
    // there is nothing to warm until they do.
    <Link href={href} prefetch={false} onClick={onClick} className="fn-session-item" style={menuItemStyle()}>
      {icon}
      <span>{label}</span>
    </Link>
  );
}

// ─── Style helpers ─────────────────────────────────────────────────────────

function triggerButtonStyle(variant: Variant): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    height: 36,
    padding: variant === 'inline' ? '0 1rem' : '0 0.875rem',
    boxSizing: 'border-box',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-control)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.875rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    transition: 'border-color 0.15s ease, background 0.15s ease',
  };
}

function pillStyle(variant: Variant): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    height: 36,
    padding: variant === 'inline' ? '0 0.75rem 0 0.3rem' : '0 0.625rem 0 0.3rem',
    boxSizing: 'border-box',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-control)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'border-color 0.15s ease, background 0.15s ease',
  };
}

function menuStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    position: 'absolute',
    top: 'calc(100% + 0.5rem)',
    right: 0,
    minWidth: '15rem',
    maxWidth: 'calc(100vw - 2rem)',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-medium)',
    borderRadius: 'var(--radius-card)',
    boxShadow: 'var(--shadow-overlay)',
    zIndex: 60,
    display: 'flex',
    flexDirection: 'column',
    padding: '0.25rem',
    textAlign: 'left',
    ...extra,
  };
}

function menuHeaderStyle(): React.CSSProperties {
  return {
    padding: '0.625rem 0.75rem 0.75rem',
    marginBottom: '0.25rem',
    borderBottom: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
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
    borderRadius: 'calc(var(--radius-control) - 2px)',
    color: danger ? 'var(--danger)' : 'var(--text-secondary)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
    textDecoration: 'none',
    textAlign: 'left',
  };
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleAlert, Loader2, LogOut, Telescope, User } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { usePreferences } from '@/components/PreferencesProvider';
import ScopeSelector from '@/components/oauth/ScopeSelector';
import { getProfile, type AppViewProfile } from '@/utils/atproto/appview';
import { encodeRepo } from '@/utils/atproto/urls';
import AccountStats from '../AccountStats';

/**
 * Account tab — identity card (avatar / handle / DID), repo stats,
 * preference-sync status, and sign-out action. When signed out, the
 * tab body becomes the two-step sign-in flow so the rest of the
 * settings UI stays reachable for anonymous customization.
 */
export default function AccountTab() {
  const { did, signOut } = useAtprotoSession();
  const { pdsSync } = usePreferences();
  const [profile, setProfile] = useState<AppViewProfile | null>(null);

  useEffect(() => {
    if (!did) return undefined;
    let cancelled = false;
    getProfile(did).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [did]);

  if (!did) return <SignInCard />;

  const handle = profile?.handle;
  const displayName = profile?.displayName?.trim() || handle || did;
  const avatar = profile?.avatar;

  return (
    <>
      <section className="settings-card">
        <div className="settings-card-head">
          <h2 className="settings-card-title">Signed in</h2>
          <p className="settings-card-sub">
            Your account identity. Sign out clears the OAuth session in this browser.
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt=""
              width={48}
              height={48}
              style={{
                width: 48,
                height: 48,
                objectFit: 'cover',
                flexShrink: 0,
                border: '1px solid var(--border-medium)',
                background: 'var(--bg-tertiary)',
              }}
            />
          ) : (
            <span
              style={{
                width: 48,
                height: 48,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-tertiary)',
                flexShrink: 0,
              }}
            >
              <User size={20} />
            </span>
          )}
          <div style={{ flex: '1 1 14rem', minWidth: 0 }}>
            <div style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>
              {displayName}
            </div>
            {handle && (
              <div
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                  wordBreak: 'break-all',
                }}
              >
                @{handle}
              </div>
            )}
            <div
              style={{
                fontSize: '0.7rem',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
                marginTop: '0.25rem',
                wordBreak: 'break-all',
              }}
            >
              {did}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link href={`/explore/${encodeRepo(did)}`} style={ghostLinkStyle()}>
              <Telescope size={13} /> My repo
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              style={ghostLinkStyle({ danger: true })}
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-head">
          <h2 className="settings-card-title">Repo at a glance</h2>
          <p className="settings-card-sub">
            Stats pulled in parallel from your PDS, the PLC directory, and Constellation.
          </p>
        </div>
        <AccountStats did={did} />
      </section>

      <SyncStatus pdsSync={pdsSync} />
    </>
  );
}

function SyncStatus({
  pdsSync,
}: {
  pdsSync: ReturnType<typeof usePreferences>['pdsSync'];
}) {
  if (pdsSync === null) return null;
  let icon: React.ReactNode;
  let label: string;
  let color: string;
  if (pdsSync === 'syncing') {
    icon = <Loader2 size={12} className="explore-spin" />;
    label = 'Syncing preferences to your PDS…';
    color = 'var(--text-tertiary)';
  } else if (pdsSync === 'idle') {
    icon = <CheckCircle2 size={12} />;
    label = 'Preferences synced to your PDS.';
    color = 'var(--text-accent)';
  } else {
    icon = <CircleAlert size={12} />;
    label = 'Preference sync to PDS failed — local changes are saved.';
    color = 'var(--danger)';
  }
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.4rem 0.625rem',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
        fontSize: '0.75rem',
        color,
        alignSelf: 'flex-start',
      }}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}

function ghostLinkStyle({ danger }: { danger?: boolean } = {}): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.4rem 0.75rem',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-medium)',
    color: danger ? 'var(--danger)' : 'var(--text-secondary)',
    fontFamily: 'var(--font-serif)',
    fontSize: '0.8125rem',
    cursor: 'pointer',
    textDecoration: 'none',
  };
}

/**
 * Signed-out body for the Account tab. Mirrors the previous AccountPage
 * sign-in flow but lives inside the settings shell so the other tabs
 * (General, Waypoints, Custom, About) remain reachable for anonymous
 * users — anything they change is kept in localStorage and pushed to
 * the PDS the moment they sign in.
 */
function SignInCard() {
  const { signIn } = useAtprotoSession();
  const [input, setInput] = useState('');
  const [step, setStep] = useState<'handle' | 'scopes'>('handle');
  const [pendingAccount, setPendingAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="settings-card-title">Sign in to sync</h2>
        <p className="settings-card-sub">
          You can use Aturi without signing in — preferences save to this
          browser. Sign in and they sync to your PDS so the same setup
          follows you across devices.
        </p>
      </div>
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
          marginTop: '1rem',
          color: 'var(--text-tertiary)',
          fontSize: '0.8125rem',
        }}
      >
        You&rsquo;ll be redirected to your PDS to authorize Aturi. Reads
        always work because your repo is public.
      </p>
    </section>
  );
}

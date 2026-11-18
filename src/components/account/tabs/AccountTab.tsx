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
        <div className="settings-identity">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt=""
              width={48}
              height={48}
              className="settings-identity-avatar"
            />
          ) : (
            <span className="settings-identity-avatar">
              <User size={20} />
            </span>
          )}
          <div className="settings-identity-text">
            <div className="settings-identity-name">{displayName}</div>
            {handle && <div className="settings-identity-handle">@{handle}</div>}
            <div className="settings-identity-did">{did}</div>
          </div>
          <div className="settings-identity-actions">
            <Link href={`/explore/${encodeRepo(did)}`} prefetch={false} className="settings-btn">
              <Telescope size={14} /> My repo
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="settings-btn is-danger"
            >
              <LogOut size={14} /> Sign out
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
  let tone: string;
  if (pdsSync === 'syncing') {
    icon = <Loader2 size={13} className="explore-spin" />;
    label = 'Syncing preferences to your PDS…';
    tone = 'is-pending';
  } else if (pdsSync === 'idle') {
    icon = <CheckCircle2 size={13} />;
    label = 'Preferences synced to your PDS.';
    tone = 'is-ok';
  } else {
    icon = <CircleAlert size={13} />;
    label = 'Preference sync to PDS failed. Local changes are saved.';
    tone = 'is-error';
  }
  return (
    <div className={`settings-sync ${tone}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
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
          You can use Aturi without signing in: preferences save to this
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
          className="settings-signin-form"
        >
          <input
            type="text"
            autoComplete="username"
            spellCheck={false}
            placeholder="handle.bsky.social or did:plc:…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="settings-input is-mono"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="settings-btn is-primary"
          >
            Next: choose permissions →
          </button>
        </form>
      ) : (
        <div className="settings-signin-scopes">
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
      <p className="settings-card-note">
        You&rsquo;ll be redirected to your PDS to authorize Aturi. Reads
        always work because your repo is public.
      </p>
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import HandleTypeaheadInput from '@/components/oauth/HandleTypeaheadInput';
import ScopeSelector from '@/components/oauth/ScopeSelector';
import { useSignInFlow } from '@/components/oauth/useSignInFlow';
import { resolveIdentifier } from '@/utils/atproto/identity';
import { pdsSupportsSpaces, SPACES_ALPHA_PDS } from '@/utils/atproto/spaceIdentity';
import { encodeRepo } from '@/utils/atproto/urls';
import AppearIn from '../AppearIn';
import { useSpaceGrant } from './useSpaceAccess';

/**
 * `/explore/spaces` — the way in for someone who has heard about atproto
 * spaces and wants to see their own.
 *
 * Signed out it is a sign-in form; signed in it is one button. The page does
 * not try to explain the protocol: that belongs next to real data, on the
 * pages that show it.
 *
 * Whether a server can do this at all is checked against its `_health`
 * version, which is the one capability signal readable before signing in — so
 * someone on a server that doesn't run the alpha is told that here, rather
 * than finding out from a grant that came back empty.
 */
export default function SpacesLanding() {
  const { session, did, loading } = useAtprotoSession();

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
          <SignedIn did={did} />
        </AppearIn>
      ) : (
        <AppearIn delay={0.05}>
          <SignedOut />
        </AppearIn>
      )}
    </div>
  );
}

function SignedIn({ did }: { did: string | null }) {
  const { pds, signIn } = useAtprotoSession();
  const grant = useSpaceGrant();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSupported(null);
    if (!pds) return undefined;
    pdsSupportsSpaces(pds).then((ok) => {
      if (!cancelled) setSupported(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [pds]);

  if (grant === 'unknown' || supported === null) {
    return <p className="explore-placeholder">Checking your access…</p>;
  }

  // Server first: a missing grant on a server that can't do spaces isn't the
  // user's mistake, and offering them a re-grant they can't complete would
  // send them round a loop.
  if (!supported) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        <p style={noteStyle}>
          Your server doesn’t run the spaces build yet, so there is nothing to
          read. Spaces are an alpha, and during it{' '}
          <code>{SPACES_ALPHA_PDS}</code> is the host running them — an account
          there is how to try this today.
        </p>
        <Link href="/explore/pds/spaces-alpha.host.bsky.network" className="explore-json-link">
          Look at that server →
        </Link>
      </div>
    );
  }

  if (grant === 'read' || grant === 'read_self') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        <Link
          href={`/explore/${encodeRepo(did ?? '')}/space`}
          style={{
            ...primaryButtonStyle(false),
            display: 'block',
            textAlign: 'center',
            textDecoration: 'none',
          }}
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

  // Server can do it, so an empty grant really is an unticked box.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      <p style={noteStyle}>
        Your server supports spaces, but this session didn’t ask for
        permissioned data. Sign in again and tick a permissioned-data row.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signIn(did ?? '').catch(() => setBusy(false));
        }}
        style={primaryButtonStyle(busy)}
      >
        {busy ? 'Redirecting…' : 'Sign in again and grant it'}
      </button>
    </div>
  );
}

function SignedOut() {
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const { step, pendingAccount, busy, error, proceedToScopes, backToHandle, submitScopes } =
    useSignInFlow();

  if (step === 'scopes') {
    return (
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
    );
  }

  // Resolve the handle far enough to ask its PDS whether it runs the spaces
  // build, before sending anyone through a consent screen for a grant their
  // server would drop. All of it is public — handle → DID → PDS → `_health` —
  // and none of it needs a session.
  async function check() {
    const account = value.trim();
    if (!account) return;
    setChecking(true);
    setWarning(null);
    try {
      const identity = await resolveIdentifier(account);
      const ok = await pdsSupportsSpaces(identity.pds);
      if (ok) {
        proceedToScopes(account);
        return;
      }
      setWarning(
        `${identity.pds.replace(/^https?:\/\//, '')} doesn’t run the spaces build, so a permissioned-data grant would come back empty. During the alpha, ${SPACES_ALPHA_PDS} is the host running them.`,
      );
    } catch {
      // A handle that won't resolve is the sign-in flow's problem to report,
      // not this check's — hand it over rather than inventing an error here.
      proceedToScopes(account);
    } finally {
      setChecking(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void check();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}
    >
      <HandleTypeaheadInput
        value={value}
        onChange={(next) => {
          setValue(next);
          setWarning(null);
        }}
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
      <button
        type="submit"
        disabled={!value.trim() || checking}
        style={primaryButtonStyle(!value.trim() || checking)}
      >
        {checking ? 'Checking your server…' : 'Sign in to see your spaces'}
      </button>

      {warning ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <p style={noteStyle}>{warning}</p>
          {/* Still their call: the check reads a convenience endpoint, and a
              host that doesn't serve it looks the same from here as one that
              can't do spaces. */}
          <button
            type="button"
            onClick={() => proceedToScopes(value.trim())}
            style={{ ...primaryButtonStyle(false), background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}
          >
            Sign in anyway
          </button>
        </div>
      ) : (
        <p style={noteStyle}>
          You’ll be asked which permissions to grant. Tick a permissioned-data
          row — without one there is nothing to read.
        </p>
      )}
    </form>
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

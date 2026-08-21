'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Boxes, ExternalLink, KeyRound, Link2, Lock } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import CrossLinkCards from '@/components/landing/CrossLinkCards';
import FeatureSection from '@/components/landing/FeatureSection';
import SpacesGlanceVisual from '@/components/landing/SpacesGlanceVisual';
import SpaceUriAnatomyVisual from '@/components/landing/SpaceUriAnatomyVisual';
import HandleTypeaheadInput from '@/components/oauth/HandleTypeaheadInput';
import ScopeSelector from '@/components/oauth/ScopeSelector';
import { useSignInFlow } from '@/components/oauth/useSignInFlow';
import { resolveIdentifier } from '@/utils/atproto/identity';
import { pdsSupportsSpaces, SPACES_ALPHA_PDS } from '@/utils/atproto/spaceIdentity';
import { encodeRepo } from '@/utils/atproto/urls';
import AppearIn from '../AppearIn';
import SkeletonSwap from '../skeletons/SkeletonSwap';
import { useSpaceGrant } from './useSpaceAccess';

/**
 * `/explore/spaces` — the way in for someone who has heard about atproto
 * spaces and wants to see their own.
 *
 * Laid out like the other product landing pages (/links, /extension, the
 * explore index): full-width hero with the sign-in action and a mock of the
 * signed-in view, feature sections below, cross-links at the end. The
 * sign-in states themselves are unchanged: signed out it is a form, signed
 * in it is one button, and a server that can't do spaces is told so here
 * rather than through a grant that came back empty.
 *
 * Whether a server can do this at all is checked against its `_health`
 * version, which is the one capability signal readable before signing in.
 */
export default function SpacesLanding() {
  const { session, did, loading } = useAtprotoSession();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
      {/* Hero */}
      <AppearIn rise>
        <header
          style={{ display: 'grid', gap: '2.5rem', alignItems: 'center' }}
          className="landing-hero"
        >
          <div>
            <Badge icon={<Lock size={12} aria-hidden />}>Atproto spaces alpha</Badge>
            <h1
              style={{
                fontSize: '2.5rem',
                fontWeight: 300,
                marginBottom: '0.75rem',
                color: 'var(--text-primary)',
                lineHeight: 1.15,
              }}
            >
              Browse your permissioned data.
            </h1>
            <p
              style={{
                fontSize: '1.05rem',
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
                maxWidth: '34rem',
                marginBottom: '1.25rem',
              }}
            >
              Atproto keeps most records in public repos that anyone can read.
              A space holds records with an authority that checks membership
              before serving them: mutuals-only posts, private bulletin
              boards, notes that never reach the firehose. Sign in and the
              explorer reveals the spaces you write to.{' '}
              <a
                href="https://atproto.com/blog/atproto-spaces-alpha"
                target="_blank"
                rel="noopener noreferrer"
                className="explore-json-link"
              >
                Learn more
              </a>
              .
            </p>
            <HeroAction loading={loading} signedIn={Boolean(session)} did={did} />
          </div>
          <div>
            <SpacesGlanceVisual />
          </div>
        </header>
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeaturedApps />
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          badge={{ icon: <Link2 size={12} />, label: 'Space addresses' }}
          title="Every level has an address"
          body={
            <>
              <p>
                A space is anchored on an authority DID and named by a type
                and a key. Members write ordinary records into it, so the
                address keeps going: through the member who wrote, into a
                collection, down to a single record.
              </p>
              <p>
                The explorer gives every level its own page, so you can hand
                a collaborator a link straight into a shared space. Whether
                they can read it stays the authority&rsquo;s call, not the
                link&rsquo;s.
              </p>
            </>
          }
          visual={<SpaceUriAnatomyVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <AlphaAccount />
      </AppearIn>

      <AppearIn delay={0.05}>
        <CrossLinkCards />
      </AppearIn>
    </div>
  );
}

/**
 * The hero's call to action, and the one box on this page whose contents
 * aren't known at first paint.
 *
 * Which control belongs here depends on whether there is a session, and that
 * answer is unavoidably async: the OAuth client keeps its sessions in
 * IndexedDB and the package that reads them is dynamically imported, so
 * nothing on the first render can tell a signed-in visitor from a signed-out
 * one. Rendering nothing until it resolves left the hero with a hole in it,
 * so this holds a stand-in for the form instead and cross-fades whichever
 * control wins.
 *
 * The stand-in is the signed-out form's shape rather than the button's,
 * because that is the answer for anyone who has not signed in here before.
 * Guessing wrong costs a signed-in visitor a swap between two boxes of
 * different heights; guessing the button instead would cost every first-time
 * visitor the same swap.
 */
function HeroAction({
  loading,
  signedIn,
  did,
}: {
  loading: boolean;
  signedIn: boolean;
  did: string | null;
}) {
  return (
    <SkeletonSwap loading={loading} skeleton={<SignInSkeleton />}>
      {!loading && (signedIn ? <SignedIn did={did} /> : <SignedOut />)}
    </SkeletonSwap>
  );
}

/**
 * Stand-in for <SignedOut>'s handle field and submit button.
 */
function SignInSkeleton() {
  return (
    <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      <ControlSkeleton control="field" />
      <ControlSkeleton control="button" />
    </div>
  );
}

/**
 * A stand-in for one of the slot's controls, built from that control's own
 * padding, border and type rather than from a height measured off a
 * screenshot: it holds a blank line and lets the same layout math size it.
 * A fixed height was 11px too tall here, because the controls set their own
 * font sizes and a `calc` in `em` resolved against the body's instead. This
 * also survives a change to the site's font scale, which a pixel height
 * would not.
 */
function ControlSkeleton({ control }: { control: 'field' | 'button' }) {
  const field = control === 'field';
  return (
    <div
      className="skeleton-shimmer"
      style={{
        // Mirrors the field's 0.625rem/0.75rem and the button's
        // 0.625rem/1rem. Only the block padding decides the height, and the
        // two agree on it.
        padding: field ? '0.625rem 0.75rem' : '0.625rem 1rem',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-tertiary)',
        fontFamily: field ? 'var(--font-mono)' : 'var(--font-serif)',
        fontSize: field ? '0.875rem' : '0.9375rem',
        lineHeight: 'normal',
        color: 'transparent',
        userSelect: 'none',
      }}
    >
      &nbsp;
    </div>
  );
}

/**
 * Where new accounts for the alpha come from. The atproto blog points at the
 * bsky.network account portal for both the invite code and the sign-up link,
 * so this sends people there rather than paraphrasing a flow we don't run.
 */
const INVITE_URL = 'https://bsky.network/account/';

function AlphaAccount() {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <Badge icon={<KeyRound size={12} aria-hidden />}>Try the alpha</Badge>
        <h2 style={sectionTitleStyle}>Get an account on the alpha host</h2>
        <p style={sectionLeadStyle}>
          Trying Spaces requires an account on a server that runs the spaces
          build. Bluesky is hosting one for this alpha test. Grab an invite
          code from Bluesky using the link below, create the account, then
          sign in here with it.
        </p>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <a
          href={INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="generate-button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1.25rem',
            background: 'var(--accent-moss)',
            color: 'var(--text-on-accent)',
            border: '1px solid var(--accent-forest)',
            fontSize: '0.95rem',
            textDecoration: 'none',
          }}
        >
          Get an invite code
          <ExternalLink size={14} aria-hidden />
        </a>
        <Link
          href={`/explore/pds/${SPACES_ALPHA_PDS}`}
          className="explore-json-link"
          style={{ fontSize: '0.9rem' }}
        >
          Look at the alpha server →
        </Link>
      </div>
    </section>
  );
}

/**
 * Apps built on spaces, for someone who has nothing in a space yet, which is
 * everyone until they use one. The explorer can only show data that exists,
 * so the useful thing to offer an empty account is somewhere to go make some.
 * That makes this the first section below the hero: it is the one someone
 * with no spaces can act on.
 *
 * Each description is the app's own, taken from its page rather than written
 * here, so this doesn't end up characterising someone else's project.
 */
const FEATURED_APPS: { name: string; url: string; description: string }[] = [
  {
    name: 'secretsky.at',
    url: 'https://secretsky.at',
    description: 'Private microblogging for mutual follows, built on ATProto Spaces.',
  },
  {
    name: 'bulletin.my',
    url: 'https://bulletin.my',
    description: 'Private bulletin boards for you and your followers.',
  },
  {
    name: 'bulleted.app',
    url: 'https://bulleted.app',
    description:
      'An outliner for lists, notes, and plans, where an outline written in a space stays off the public network.',
  },
];

function FeaturedApps() {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <Badge icon={<Boxes size={12} aria-hidden />}>Built on spaces</Badge>
        <h2 style={sectionTitleStyle}>Apps to try</h2>
        <p style={sectionLeadStyle}>
          The explorer reads spaces, but it doesn&rsquo;t create them. An
          account will have nothing to browse until you use an app that writes
          something to a space. Here are some test apps from the community to
          experiment with:
        </p>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
          gap: '1rem',
        }}
      >
        {FEATURED_APPS.map((app) => (
          <a
            key={app.url}
            href={app.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              padding: '1.25rem',
              border: '1px solid var(--border-medium)',
              background: 'var(--bg-secondary)',
              textDecoration: 'none',
              transition: 'border-color 0.2s ease, background 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--text-accent)';
              e.currentTarget.style.background = 'var(--bg-tertiary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-medium)';
              e.currentTarget.style.background = 'var(--bg-secondary)';
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.9rem',
                color: 'var(--text-primary)',
              }}
            >
              {app.name}
              <ExternalLink size={12} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
            </span>
            <span style={{ fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              {app.description}
            </span>
          </a>
        ))}
      </div>
    </section>
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

  // Same slot, still resolving: this check is a second async hop after the
  // session one, so it gets the button's box rather than a line of text that
  // would resize the hero again on its way out.
  if (grant === 'unknown' || supported === null) {
    return (
      <div role="status" aria-label="Checking your access">
        <ControlSkeleton control="button" />
      </div>
    );
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
          <code>{SPACES_ALPHA_PDS}</code> is the host running them. An account
          there is how to try this today.
        </p>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <a
            href={INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="explore-json-link explore-json-link-external"
          >
            Get an invite code
          </a>
          <Link href={`/explore/pds/${SPACES_ALPHA_PDS}`} className="explore-json-link">
            Look at that server →
          </Link>
        </div>
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

      {warning && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <p style={noteStyle}>{warning}</p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
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
            <a
              href={INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="explore-json-link explore-json-link-external"
              style={{ fontSize: '0.85rem' }}
            >
              Get an invite code
            </a>
          </div>
        </div>
      )}
    </form>
  );
}

function Badge({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.25rem 0.625rem',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-tertiary)',
        color: 'var(--text-tertiary)',
        fontSize: '0.75rem',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontFamily: 'var(--font-serif)',
        marginBottom: '1.25rem',
        lineHeight: 1,
      }}
    >
      {icon}
      {children}
    </span>
  );
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '1.75rem',
  fontWeight: 300,
  color: 'var(--text-primary)',
  margin: '0 0 0.625rem',
  lineHeight: 1.2,
  letterSpacing: '-0.01em',
};

const sectionLeadStyle: React.CSSProperties = {
  fontSize: '1rem',
  lineHeight: 1.65,
  color: 'var(--text-secondary)',
  maxWidth: '46rem',
  margin: 0,
};

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

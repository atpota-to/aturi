'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { User } from 'lucide-react';
import AppearIn from './AppearIn';
import SearchBox from './SearchBox';
import JetstreamFeed from './JetstreamFeed';
import TrendingLexicons from './TrendingLexicons';
import AccountStats from '@/components/account/AccountStats';
import CrossLinkCards from '@/components/landing/CrossLinkCards';
import LandingSection from '@/components/landing/LandingSection';
import SignedInExploreVisual from '@/components/landing/SignedInExploreVisual';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { getProfile, type AppViewProfile } from '@/utils/atproto/appview';
import { encodeRepo } from '@/utils/atproto/urls';

const SUGGESTIONS = ['dame.is', 'anisota.net', 'aturi.to', 'atpota.to'];

// aturi.to's DID, hardcoded rather than resolved at mount so the stat tiles
// render with their own placeholders on first paint instead of arriving a
// round trip later — or not at all, on the visit where the handle lookup
// fails. A PLC DID is permanent, so the only thing that could stale this is
// aturi.to moving to another account.
const DEMO_DID = 'did:plc:6teuhlkizzebk6wdp42633el';

export default function ExploreLanding() {
  const { did } = useAtprotoSession();
  const [profile, setProfile] = useState<AppViewProfile | null>(null);

  // Lazy-fetch profile so we can show the user's handle rather than the bare
  // DID. The explorer route accepts both, so we render the DID immediately
  // and upgrade to the prettier handle once it lands.
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

  const myRepo = did ? profile?.handle || did : null;
  // Avoid showing the user's handle twice when it happens to be one of the
  // hard-coded examples.
  const otherSuggestions = myRepo
    ? SUGGESTIONS.filter((s) => s !== myRepo)
    : SUGGESTIONS;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
      <AppearIn rise>
      <header>
        <h1
          style={{
            fontSize: 'var(--type-display)',
            fontWeight: 300,
            lineHeight: 1.15,
            letterSpacing: '-0.01em',
            marginBottom: '0.75rem',
            color: 'var(--text-primary)',
          }}
        >
          Browse any repository.
        </h1>
        <p
          style={{
            fontSize: 'var(--type-lead)',
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
            maxWidth: '38rem',
            marginBottom: '2rem',
          }}
        >
          Every atproto account keeps its records in a repository on a PDS.
          Give the explorer a handle, a DID, or an at:// URI and it opens that
          repository.
        </p>
        <SearchBox />
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: 'var(--type-small)',
            color: 'var(--text-tertiary)',
          }}
        >
          <span>Try:</span>
          {myRepo && (
            <Link
              key={myRepo}
              href={`/explore/${encodeRepo(myRepo)}`}
              title="Your repo"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-accent)',
                padding: '0.125rem 0.5rem',
                border: '1px solid var(--text-accent)',
                background: 'var(--bg-tertiary)',
                textDecoration: 'none',
              }}
            >
              <User size={11} aria-hidden /> {myRepo}
            </Link>
          )}
          {otherSuggestions.map((s) => (
            <Link
              key={s}
              href={`/explore/${s}`}
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-accent)',
                padding: '0.125rem 0.5rem',
                border: '1px solid var(--border-subtle)',
                textDecoration: 'none',
              }}
            >
              {s}
            </Link>
          ))}
        </div>
      </header>
      </AppearIn>

      {/* Runs bare: the widget's own header names it and already carries the
          "Explore all" link to /explore/lexicons. */}
      <TrendingLexicons />

      {/* The page's one loud section, and the only one showing a repo page
          rather than describing it: these are the live AccountStats tiles, the
          same component /explore/<repo> opens with, so the section is the
          feature instead of a picture of it. Non-interactive, so the cred.blue
          link and the multi-MB repo-size download stay off a front door. The
          width wrapper is needed because .landing-section-visual is a flex
          container and the tile grid would otherwise size to its content. */}
      <AppearIn delay={0.12}>
        <LandingSection
          tone="loud"
          title="Repo at a glance"
          visual={
            <div style={{ width: '100%' }}>
              <AccountStats did={DEMO_DID} interactive={false} />
            </div>
          }
        >
          <p>
            Every repo page opens on the same tiles: namespace and lexicon
            counts, audit-log changes, inbound backlinks, account age, and the
            repo&rsquo;s last commit.
          </p>
        </LandingSection>
      </AppearIn>

      <AppearIn delay={0.12}>
        <LandingSection
          title="Pin what you read, on any device"
          visual={<SignedInExploreVisual />}
        >
          <p>
            Pin any lexicon, or a whole group like <code>app.bsky.feed.*</code>,
            and it moves to the top of the Lexicons tab on your own repo. Sign
            in and those pins travel with your custom waypoints and color scheme
            as a record in your PDS, so any browser you sign in from loads them.
          </p>
        </LandingSection>
      </AppearIn>

      <AppearIn delay={0.12}>
        {/* Verbose variant for the explorer dashboard: full mutation
            stream (creates + updates + deletes) with op pills and the
            rolling stats footer. The homepage strip uses the minimal
            default (creates only, no op column, no stats). */}
        <JetstreamFeed
          wantedOps={['create', 'update', 'delete']}
          showOpLabels
          showStats
        />
      </AppearIn>

      <AppearIn delay={0.16}>
        <CrossLinkCards current="explore" />
      </AppearIn>
    </div>
  );
}

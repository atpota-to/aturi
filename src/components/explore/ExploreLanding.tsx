'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cloud, Gauge, Pin, Telescope, User } from 'lucide-react';
import AppearIn from './AppearIn';
import SearchBox from './SearchBox';
import JetstreamFeed from './JetstreamFeed';
import TrendingLexicons from './TrendingLexicons';
import CrossLinkCards from '@/components/landing/CrossLinkCards';
import FeatureSection from '@/components/landing/FeatureSection';
import PinnedLexiconsVisual from '@/components/landing/PinnedLexiconsVisual';
import RepoGlanceVisual from '@/components/landing/RepoGlanceVisual';
import SignedInExploreVisual from '@/components/landing/SignedInExploreVisual';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { getProfile, type AppViewProfile } from '@/utils/atproto/appview';
import { encodeRepo } from '@/utils/atproto/urls';

const SUGGESTIONS = ['aturi.to', 'bsky.app', 'dame.is', 'jay.bsky.team'];

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
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.25rem 0.625rem',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-tertiary)',
            fontSize: '0.75rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontFamily: 'var(--font-serif)',
            marginBottom: '1.25rem',
          }}
        >
          <Telescope size={12} /> Atmosphere data explorer
        </div>
        <h1
          style={{
            fontSize: '2.5rem',
            fontWeight: 300,
            marginBottom: '0.75rem',
            color: 'var(--text-primary)',
          }}
        >
          Browse any repository.
        </h1>
        <p
          style={{
            fontSize: '1.05rem',
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
            maxWidth: '38rem',
            marginBottom: '2rem',
          }}
        >
          Every account in the Atmosphere keeps its records in a public PDS.
          Browse collections, inspect identity history, follow backlinks, and
          edit your own records, all from the browser.
        </p>
        <SearchBox />
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.85rem',
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

      <AppearIn delay={0.08}>
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

      <TrendingLexicons />

      {/* Feature spotlights — what the Explorer does that other AT
          Protocol browsers don't. Sits between the trending feed and
          the cross-link cards so visitors see live data first, then
          the unique features, then the way out to the other tools. */}
      <AppearIn delay={0.12}>
        <FeatureSection
          badge={{ icon: <Gauge size={12} />, label: 'Repo at a glance' }}
          title="Account-level signal before you drill in"
          body={
            <>
              <p>
                Every repo page leads with a tile grid: namespace count,
                total lexicons, PLC audit-log size, inbound backlinks
                across the Atmosphere, account age, and the cred.blue
                score. Five public sources, one block.
              </p>
              <p>
                A compact identity row sits beneath — handle, DID, and a
                clickable PDS host. The kind of summary other explorers
                bury inside individual tabs.
              </p>
            </>
          }
          visual={<RepoGlanceVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.12}>
        <FeatureSection
          flip
          badge={{ icon: <Pin size={12} />, label: 'Pinned lexicons' }}
          title="Keep the records you care about at the top"
          body={
            <>
              <p>
                Click the pin on any lexicon to lift it out of the
                hierarchy. Pinned NSIDs sit in their own accent-bordered
                section at the top of the Lexicons tab, on every account
                page you visit.
              </p>
              <p>
                Maintain separate pin lists for your own repo and other
                people&rsquo;s — Anisota records when you&rsquo;re
                auditing yourself, Bluesky posts when you&rsquo;re
                reading someone else, both without re-pinning each time.
              </p>
            </>
          }
          visual={<PinnedLexiconsVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.12}>
        <FeatureSection
          badge={{ icon: <Cloud size={12} />, label: 'Sign in superpowers' }}
          title="Your preferences sync. Every repo gets a relationship strip."
          body={
            <>
              <p>
                Sign in and pins, custom waypoints, theme, and panel
                state ride with you via your PDS &mdash; jump between
                devices and the Explorer picks up where you left off.
              </p>
              <p>
                On every other account&rsquo;s page, a &ldquo;You +
                @them&rdquo; strip surfaces what you have in common: the
                same PDS host, your follow status (with the date you
                followed them), known mutuals, and the count of
                lexicons you both publish.
              </p>
            </>
          }
          visual={<SignedInExploreVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.16}>
        <CrossLinkCards current="explore" />
      </AppearIn>
    </div>
  );
}

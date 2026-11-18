'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, ChevronRight, Cloud, Gauge, Layers, Pin, Plug, User } from 'lucide-react';
import AppearIn from './AppearIn';
import SearchBox from './SearchBox';
import JetstreamFeed from './JetstreamFeed';
import AtmospherePulse from './lexicons/AtmospherePulse';
import CrossLinkCards from '@/components/landing/CrossLinkCards';
import FeatureSection from '@/components/landing/FeatureSection';
import PinnedLexiconsVisual from '@/components/landing/PinnedLexiconsVisual';
import RepoGlanceVisual from '@/components/landing/RepoGlanceVisual';
import SignedInExploreVisual from '@/components/landing/SignedInExploreVisual';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { getProfile, type AppViewProfile } from '@/utils/atproto/appview';
import { encodeRepo } from '@/utils/atproto/urls';

const SUGGESTIONS = ['dame.is', 'anisota.net', 'aturi.to', 'atpota.to'];

/** Other ways into the explorer. All three are static pages, so they keep
 * Next's default prefetch. */
const TILES = [
  { href: '/explore/lexicons', title: 'Lexicons', desc: 'Search every record type', Icon: BookOpen },
  { href: '/explore/spaces', title: 'Spaces', desc: 'Browse shared spaces', Icon: Layers },
  { href: '/mcp', title: 'MCP server', desc: 'Read-only tools for your AI', Icon: Plug },
];

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
    <div className="fn-explore">
      <AppearIn rise>
        <header className="fn-x-intro" aria-labelledby="fn-x-title">
          <div className="fn-x-intro-copy">
            <span className="fn-kicker">Atmosphere explorer</span>
            <h1 id="fn-x-title">Browse any repository</h1>
            <p>
              Every account in the Atmosphere keeps its records in a public PDS.
              Browse collections, inspect identity history, follow backlinks, and
              edit your own records, all from the browser.
            </p>
          </div>
          <div className="fn-x-intro-search">
            <SearchBox />
            <div className="fn-x-tries">
              <span>Try</span>
              {myRepo && (
                <Link
                  key={myRepo}
                  href={`/explore/${encodeRepo(myRepo)}`}
                  prefetch={false}
                  title="Your repo"
                  className="fn-chip fn-chip-mine"
                >
                  <User size={12} aria-hidden /> {myRepo}
                </Link>
              )}
              {otherSuggestions.map((s) => (
                <Link key={s} href={`/explore/${s}`} prefetch={false} className="fn-chip">
                  {s}
                </Link>
              ))}
            </div>
          </div>
        </header>
      </AppearIn>

      <AppearIn delay={0.06}>
        <nav aria-label="More ways in" className="fn-x-tiles">
          {TILES.map(({ href, title, desc, Icon }) => (
            <Link key={href} href={href} className="fn-x-tile">
              <span aria-hidden className="fn-x-tile-icon">
                <Icon size={18} />
              </span>
              <span className="fn-x-tile-text">
                <span className="fn-x-tile-title">{title}</span>
                <span className="fn-x-tile-desc">{desc}</span>
              </span>
              <ChevronRight size={16} aria-hidden className="fn-x-tile-chev" />
            </Link>
          ))}
        </nav>
      </AppearIn>

      <AtmospherePulse />

      {/* Feature spotlights — what the Explorer does that other AT
          Protocol browsers don't. */}
      <AppearIn delay={0.12}>
        <FeatureSection
          badge={{ icon: <Gauge size={12} />, label: 'Repo at a glance' }}
          title="Get the tl;dr up top"
          body={
            <>
              <p>
                Every repo page leads with high-level context so you can orient yourself quickly without having to wade into all the details.
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
                Click the pin on any lexicon (or a whole group header like{' '}
                <code>app.bsky.feed.*</code>) to lift it out of the
                hierarchy. Pinned NSIDs sit in their own accent-bordered
                section at the top of the Lexicons tab, on every account
                page you visit.
              </p>
              <p>
                Maintain separate pin lists for your own repo and other
                people&rsquo;s: Anisota records when you&rsquo;re
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
                By optionally signing in, your preferences (pins, custom waypoints, color scheme, etc) ride with you via your PDS: jump between
                devices and the Explorer will not forget your settings.
              </p>
              <p>
                On every other account&rsquo;s page, a &ldquo;You +
                @them&rdquo; strip surfaces what you have in common: the
                same PDS host, your follow status, mutual followers, and the count of
                lexicons you have in common.
              </p>
            </>
          }
          visual={<SignedInExploreVisual />}
        />
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

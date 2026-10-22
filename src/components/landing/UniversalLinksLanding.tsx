'use client';

import Link from 'next/link';
import { ArrowRight, Compass, Layers, Link2, Share2, Sparkles, UserCog } from 'lucide-react';
import AppearIn from '@/components/explore/AppearIn';
import CrossLinkCards from './CrossLinkCards';
import FeatureSection from './FeatureSection';
import LinksHeroVisual from './LinksHeroVisual';
import UrlAnatomyVisual from './UrlAnatomyVisual';
import RecordTypesGrid from './RecordTypesGrid';
import { getWaypointCount } from '@/utils/waypoints';
import PickerPreviewVisual from './PickerPreviewVisual';
import SharingScenariosVisual from './SharingScenariosVisual';

const DEMO_HANDLE = 'aturi.to';
// Aturi's own DID — hardcoded so the carousel can build did-aware URLs
// without a runtime profile fetch.
const DEMO_DID = 'did:plc:6teuhlkizzebk6wdp42633el';

export default function UniversalLinksLanding() {
  return (
    <div className="fl-page">
      {/* Hero */}
      <AppearIn rise>
        <header className="fl-hero">
          <div className="fl-hero-copy">
            <span className="fl-pill">
              <Link2 size={13} aria-hidden /> Universal links
            </span>
            <h1 className="fl-title">
              One link, <span className="fl-title-accent">every Atmosphere client</span>
            </h1>
            <p className="fl-lede">
              Drop an <code>aturi.to</code> link anywhere: a DM, a footer, a
              bio. Visitors land on a preview of the record and choose which
              Atmosphere client opens it. No lock-in, no sign-up. Every record,
              profile, list, and feed resolves across {getWaypointCount()} curated
              clients.
            </p>
            <div className="fl-hero-actions">
              <Link
                href={`/profile/${DEMO_HANDLE}`}
                prefetch={false}
                className="fl-button"
                data-variant="primary"
              >
                See a live universal link
                <ArrowRight size={15} />
              </Link>
            </div>
          </div>
          <div className="fl-hero-visual">
            <LinksHeroVisual handle={DEMO_HANDLE} did={DEMO_DID} />
          </div>
        </header>
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          badge={{ icon: <Compass size={12} />, label: 'Anatomy of a link' }}
          title="Predictable, hackable URLs"
          body={
            <>
              <p>
                Every aturi.to URL follows one pattern: the host, the{' '}
                <code>/profile</code>{' '}
                mount, a handle or DID, the lexicon collection, and the record
                key. The same shape covers every record type. If you know what
                an AT URI looks like, you already know the URL.
              </p>
              <p>
                Drop the collection and rkey for a profile link. Posts also
                accept a friendlier{' '}
                <code>/post/&lt;rkey&gt;</code>{' '}
                shortcut, and bare paths without the{' '}
                <code>/profile</code>{' '}
                prefix still resolve for backwards compatibility.
              </p>
            </>
          }
          visual={<UrlAnatomyVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <section className="fl-section">
          <div className="fl-section-head">
            <span className="fl-kicker">
              <Layers size={14} /> Every record type
            </span>
            <h2 className="fl-h2">Posts, profiles, lists, feeds, documents, repos, galleries…</h2>
            <p className="fl-body">
              If a lexicon has a public record, aturi.to has a URL for it. The
              same{' '}
              <code>handle/collection/rkey</code>{' '}
              pattern resolves whether the record lives in app.bsky.feed.post,
              pub.leaflet.document, sh.tangled.repo, or a lexicon that shipped
              yesterday.
            </p>
          </div>
          <RecordTypesGrid />
        </section>
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          flip
          badge={{ icon: <Sparkles size={12} />, label: 'The picker' }}
          title="A friendly landing page for every record"
          body={
            <>
              <p>
                Recipients land on a clean preview with a recommended client
                pinned at the top and every alternative below. They can read
                the record, decide where to open it, and skip apps they
                don&rsquo;t use.
              </p>
              <p>
                Each link is a real, indexable URL. Embeds get OpenGraph
                cards, link unfurlers get a real title and description.
              </p>
            </>
          }
          visual={<PickerPreviewVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          badge={{ icon: <UserCog size={12} />, label: 'Smart preferences' }}
          title="Signed in? The picker reorders for you."
          body={
            <>
              <p>
                Sign in with your atproto handle and aturi.to remembers your
                favorite client for each record type, the waypoints
                you&rsquo;ve hidden, and any custom ones you&rsquo;ve added.
                Every visit lifts your favorites to the top of the picker.
              </p>
              <p>
                Preferences live in your atproto repo as records you own. They
                sync across every device you sign in to, and they migrate
                with you if you move your data to a different PDS.
              </p>
            </>
          }
          visual={
            <div className="fl-mock" data-size="s">
              <div className="fl-mock-head">
                <span className="fl-mock-head-title">Your favorites</span>
                <span className="fl-mock-sub">Signed in as @aturi.to</span>
              </div>
              <div className="fl-mock-body">
                <PrefRow lexicon="app.bsky.feed.post" client="Anisota" />
                <PrefRow lexicon="pub.leaflet.document" client="Leaflet" />
                <PrefRow lexicon="sh.tangled.repo" client="Tangled" />
              </div>
              <div className="fl-mock-foot">
                Synced to your repo · works on every device you sign in to.
              </div>
            </div>
          }
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <section className="fl-section">
          <div className="fl-section-head">
            <span className="fl-kicker">
              <Share2 size={14} /> Share anywhere
            </span>
            <h2 className="fl-h2">A link you can paste anywhere</h2>
            <p className="fl-body">
              An aturi.to URL is short, readable, and copy-pasteable. It works
              in Bluesky posts, group chats, blog footers, business cards, QR
              codes, podcast show notes, and anywhere else a regular link
              works.
            </p>
          </div>
          <SharingScenariosVisual />
        </section>
      </AppearIn>

      <AppearIn delay={0.05}>
        <CrossLinkCards current="universal-links" />
      </AppearIn>
    </div>
  );
}

function PrefRow({ lexicon, client }: { lexicon: string; client: string }) {
  return (
    <div className="fl-mock-row">
      <span className="fl-mock-sub fl-grow fl-dim">{lexicon}</span>
      <ArrowRight size={13} className="fl-redirect-arrow" aria-hidden />
      <span className="fl-chip" data-on="">
        {client}
      </span>
    </div>
  );
}

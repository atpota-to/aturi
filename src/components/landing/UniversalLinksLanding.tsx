'use client';

import Link from 'next/link';
import { ArrowRight, Compass, Layers, Link2, Share2, Sparkles, UserCog } from 'lucide-react';
import AppearIn from '@/components/explore/AppearIn';
import WaypointJumpVisual from '@/components/home/WaypointJumpVisual';
import WaypointCarousel from '@/components/home/WaypointCarousel';
import CrossLinkCards from './CrossLinkCards';
import FeatureSection from './FeatureSection';
import UrlAnatomyVisual from './UrlAnatomyVisual';
import RecordTypesGrid from './RecordTypesGrid';
import PickerPreviewVisual from './PickerPreviewVisual';
import SharingScenariosVisual from './SharingScenariosVisual';

const DEMO_HANDLE = 'aturi.to';
// Aturi's own DID — hardcoded so the carousel can build did-aware URLs
// without a runtime profile fetch.
const DEMO_DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';

export default function UniversalLinksLanding() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
      {/* Hero */}
      <AppearIn rise>
        <header
          style={{
            display: 'grid',
            gap: '2.5rem',
            alignItems: 'center',
          }}
          className="landing-hero"
        >
          <div>
            <Badge icon={<Link2 size={12} aria-hidden />}>Universal links</Badge>
            <h1
              style={{
                fontSize: '2.5rem',
                fontWeight: 300,
                marginBottom: '0.75rem',
                color: 'var(--text-primary)',
                lineHeight: 1.15,
              }}
            >
              One link, every Atmosphere client
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
              Drop an{' '}
              <code style={{ background: 'transparent', padding: 0, color: 'var(--text-accent)' }}>
                aturi.to
              </code>{' '}
              link anywhere: a DM, a footer, a bio. Visitors land on a preview
              of the record and choose which Atmosphere client opens it. No
              lock-in, no sign-up. Every record, profile, list, and feed
              resolves across 25+ curated clients.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Link
                href={`/profile/${DEMO_HANDLE}`}
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
                See a live universal link
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* The landing page lives inside container-narrow (800px),
                so the hero's right column ends up around 350px wide on
                desktop. Pass a trimmed icon set + slightly smaller cell
                so the row stays comfortable and the highlight glow
                isn't squeezed into its neighbours. */}
            <WaypointJumpVisual
              handle={DEMO_HANDLE}
              iconIds={['bluesky', 'leaflet', 'tangled', 'deer', 'pinksky', 'grain']}
              iconSize={34}
            />
            <WaypointCarousel handle={DEMO_HANDLE} did={DEMO_DID} />
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
                <code style={{ color: 'var(--text-accent)' }}>/profile</code>{' '}
                mount, a handle or DID, the lexicon collection, and the record
                key. The same shape covers every record type. If you know what
                an AT URI looks like, you already know the URL.
              </p>
              <p>
                Drop the collection and rkey for a profile link. Posts also
                accept a friendlier{' '}
                <code style={{ color: 'var(--text-accent)' }}>/post/&lt;rkey&gt;</code>{' '}
                shortcut, and bare paths without the{' '}
                <code style={{ color: 'var(--text-accent)' }}>/profile</code>{' '}
                prefix still resolve for backwards compatibility.
              </p>
            </>
          }
          visual={<UrlAnatomyVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          <div>
            <Badge icon={<Layers size={12} />}>Every record type</Badge>
            <h2
              style={{
                fontSize: '1.75rem',
                fontWeight: 300,
                color: 'var(--text-primary)',
                margin: '0 0 0.625rem',
                lineHeight: 1.2,
                letterSpacing: '-0.01em',
              }}
            >
              Posts, profiles, lists, feeds, documents, repos, galleries…
            </h2>
            <p
              style={{
                fontSize: '1rem',
                lineHeight: 1.65,
                color: 'var(--text-secondary)',
                maxWidth: '46rem',
                margin: 0,
              }}
            >
              If a lexicon has a public record, aturi.to has a URL for it. The
              same{' '}
              <code style={{ color: 'var(--text-accent)' }}>handle/collection/rkey</code>{' '}
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
                cards, link unfurlers get a real title and description, and
                bookmarks survive client churn.
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
            <div
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                padding: '1.25rem',
                maxWidth: '380px',
                margin: '0 auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                transform: 'rotate(-0.3deg)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: '0.7rem',
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                }}
              >
                Signed in as @aturi.to
              </div>
              <PrefRow lexicon="app.bsky.feed.post" client="Anisota" />
              <PrefRow lexicon="pub.leaflet.document" client="Leaflet" />
              <PrefRow lexicon="sh.tangled.repo" client="Tangled" />
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-tertiary)',
                  fontStyle: 'italic',
                }}
              >
                Synced to your repo · works on every device you sign in to.
              </div>
            </div>
          }
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          <div>
            <Badge icon={<Share2 size={12} />}>Share anywhere</Badge>
            <h2
              style={{
                fontSize: '1.75rem',
                fontWeight: 300,
                color: 'var(--text-primary)',
                margin: '0 0 0.625rem',
                lineHeight: 1.2,
                letterSpacing: '-0.01em',
              }}
            >
              A link you can paste anywhere
            </h2>
            <p
              style={{
                fontSize: '1rem',
                lineHeight: 1.65,
                color: 'var(--text-secondary)',
                maxWidth: '46rem',
                margin: 0,
              }}
            >
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

function PrefRow({ lexicon, client }: { lexicon: string; client: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.625rem',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
        fontSize: '0.75rem',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {lexicon}
      </span>
      <span style={{ color: 'var(--text-tertiary)' }}>→</span>
      <span
        style={{
          fontFamily: 'var(--font-serif)',
          color: 'var(--text-accent)',
          padding: '2px 6px',
          border: '1px solid var(--text-accent)',
        }}
      >
        {client}
      </span>
    </div>
  );
}

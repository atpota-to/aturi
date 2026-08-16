'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import AppearIn from '@/components/explore/AppearIn';
import WaypointJumpVisual from '@/components/home/WaypointJumpVisual';
import WaypointCarousel from '@/components/home/WaypointCarousel';
import CrossLinkCards from './CrossLinkCards';
import LandingSection from './LandingSection';
import UrlAnatomyVisual from './UrlAnatomyVisual';
import PickerPreviewVisual from './PickerPreviewVisual';

const DEMO_HANDLE = 'aturi.to';
// aturi.to's own DID — hardcoded so the carousel can build did-aware URLs
// without a runtime profile fetch.
const DEMO_DID = 'did:plc:6teuhlkizzebk6wdp42633el';

/**
 * /links. The hero is hand-built because it carries the page's only h1,
 * the only badge slot (unused), and a two-part visual; everything under
 * it runs through LandingSection so no section can invent its own
 * heading size. Order is deliberate: the URL anatomy and the picker both
 * carry a visual, with a plain-text section between them so the page has
 * somewhere for the eye to rest.
 */
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
            <h1
              style={{
                fontSize: 'var(--type-display)',
                fontWeight: 300,
                marginBottom: '0.75rem',
                color: 'var(--text-primary)',
                lineHeight: 1.15,
                letterSpacing: '-0.01em',
              }}
            >
              One link, every Atmosphere client
            </h1>
            <p
              style={{
                fontSize: 'var(--type-lead)',
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
              link in a DM, a footer, or a bio, and whoever opens it sees a
              preview of the record and picks the client to read it in.
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
        <LandingSection title="Predictable, hackable URLs" visual={<UrlAnatomyVisual />}>
          <p>
            An aturi.to record link is the host, the{' '}
            <code style={{ color: 'var(--text-accent)' }}>/profile</code> mount, a
            handle or DID, the lexicon collection, and the record key, in that
            order.
          </p>
        </LandingSection>
      </AppearIn>

      <AppearIn delay={0.05}>
        <LandingSection title="Any lexicon with a public record">
          <p>
            Nothing in the route is Bluesky-specific. Swap{' '}
            <code style={{ color: 'var(--text-accent)' }}>app.bsky.feed.post</code>{' '}
            for <code style={{ color: 'var(--text-accent)' }}>pub.leaflet.document</code>{' '}
            or <code style={{ color: 'var(--text-accent)' }}>sh.tangled.repo</code>{' '}
            and the link resolves the same way.
          </p>
        </LandingSection>
      </AppearIn>

      <AppearIn delay={0.05}>
        <LandingSection
          tone="loud"
          flip
          title="A recommended client at the top, the rest below"
          visual={<PickerPreviewVisual />}
        >
          <p>
            Follow an aturi.to link and you get a preview of the record, a
            client recommended for that record type pinned above the list, and
            every other client under it. Sign in and the picker follows the
            groups and the order you saved.
          </p>
        </LandingSection>
      </AppearIn>

      <AppearIn delay={0.05}>
        <CrossLinkCards current="universal-links" />
      </AppearIn>
    </div>
  );
}

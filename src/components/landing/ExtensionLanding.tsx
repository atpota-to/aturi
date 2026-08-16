'use client';

import Link from 'next/link';
import { Repeat } from 'lucide-react';
import AppearIn from '@/components/explore/AppearIn';
import BrowserChrome from '@/components/home/BrowserChrome';
import ExtensionPopupVisual from '@/components/home/ExtensionPopupVisual';
import DownloadButton, { BrowserFallbackList } from '@/components/home/DownloadButton';
import { getWaypointCount } from '@/utils/waypoints';
import CrossLinkCards from './CrossLinkCards';
import InspectPanelVisual from './InspectPanelVisual';
import AutoRedirectVisual from './AutoRedirectVisual';
import LandingSection from './LandingSection';

/**
 * Four content sections, one of them loud. Auto-redirect gets the
 * two-column treatment because it is the one of the extension's three
 * modes that the hero popup doesn't already draw; Inspect runs as a
 * compact row and custom waypoints run as plain text, so the page has a
 * stretch with no mock on it before the closing band.
 */
export default function ExtensionLanding() {
  const waypointCount = getWaypointCount();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
      {/* Hero: headline, lead, catalog count and CTA on the left, popup demo
          on the right. Hand-built rather than a LandingSection because it
          carries the page's one h1 and its own CTA stack. */}
      <AppearIn rise>
        <header
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
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
                lineHeight: 1.15,
                letterSpacing: '-0.01em',
                marginBottom: '0.75rem',
                color: 'var(--text-primary)',
              }}
            >
              Jump between Atmosphere clients in one click
            </h1>
            <p
              style={{
                fontSize: 'var(--type-lead)',
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
                maxWidth: '34rem',
                marginBottom: '1rem',
              }}
            >
              Click the leaf in your toolbar and the popup reads the AT URI off
              the page you are on, then lists the clients that can render that
              record.
            </p>
            <p
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: 'var(--type-small)',
                color: 'var(--text-accent)',
                fontFamily: 'var(--font-mono)',
                marginBottom: '1.25rem',
              }}
            >
              <Repeat size={14} />
              {waypointCount} Atmosphere clients
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              <DownloadButton variant="primary" align="start" />
              <BrowserFallbackList justify="start" />
            </div>
          </div>
          <div>
            <BrowserChrome>
              <ExtensionPopupVisual />
            </BrowserChrome>
          </div>
        </header>
      </AppearIn>

      <AppearIn delay={0.05}>
        <LandingSection
          tone="loud"
          title="Set it once. Every link opens where you want."
          visual={<AutoRedirectVisual />}
        >
          <p>
            Name a favorite for each compatibility group (posts in Anisota,
            documents in Leaflet, repositories in Tangled) and a bsky.app link
            you open from an email or a search result lands in Anisota,
            rewritten by the browser before the page loads. Auto-redirect stays
            off until you switch it on.
          </p>
        </LandingSection>
      </AppearIn>

      <AppearIn delay={0.05}>
        <LandingSection title="The record behind the page" visual={<InspectPanelVisual />}>
          <p>
            The Inspect tab breaks the page&rsquo;s AT URI down: the DID under
            the handle, the PDS holding the record, the lexicon collection, and
            the count of records linking back to it.
          </p>
        </LandingSection>
      </AppearIn>

      <AppearIn delay={0.05}>
        <LandingSection title="Add a client the catalog doesn't cover">
          <p>
            Give the extension a name, a domain, and a path template like{' '}
            <code style={{ color: 'var(--text-accent)' }}>
              /u/{'{handle}'}/posts/{'{rkey}'}
            </code>
            , and your waypoint appears in the popup next to the built-ins.
            Groups set the order the popup lists waypoints in, and a waypoint
            you leave out of every group stays hidden.
          </p>
          <Link href="/docs#preferences">Preferences and storage</Link>
        </LandingSection>
      </AppearIn>

      <AppearIn delay={0.05}>
        <section
          style={{
            padding: '2rem',
            border: '1px solid var(--border-medium)',
            background: 'var(--bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            alignItems: 'flex-start',
          }}
        >
          <h2
            style={{
              fontSize: 'var(--type-heading)',
              fontWeight: 300,
              lineHeight: 1.2,
              letterSpacing: '-0.01em',
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            No account, no telemetry, no background network calls.
          </h2>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: 'var(--type-body)',
              lineHeight: 1.65,
              margin: 0,
              maxWidth: '46rem',
            }}
          >
            The extension never contacts an aturi.to server. Inspect resolves
            records directly against the PLC directory and the account&rsquo;s
            own PDS, and your preferences stay in your browser&rsquo;s
            extension storage.
          </p>
          <DownloadButton variant="outline" align="start" />
        </section>
      </AppearIn>

      <AppearIn delay={0.05}>
        <CrossLinkCards current="extension" />
      </AppearIn>
    </div>
  );
}

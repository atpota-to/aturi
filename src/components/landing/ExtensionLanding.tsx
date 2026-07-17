'use client';

import {
  Compass,
  Eye,
  Layers,
  MousePointerClick,
  Repeat,
  ShieldCheck,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import AppearIn from '@/components/explore/AppearIn';
import BrowserChrome from '@/components/home/BrowserChrome';
import ExtensionPopupVisual from '@/components/home/ExtensionPopupVisual';
import DownloadButton, { BrowserFallbackList } from '@/components/home/DownloadButton';
import { getWaypointCount } from '@/utils/waypoints';
import CrossLinkCards from './CrossLinkCards';
import InspectPanelVisual from './InspectPanelVisual';
import AutoRedirectVisual from './AutoRedirectVisual';
import ClientGalleryVisual from './ClientGalleryVisual';
import CustomWaypointVisual from './CustomWaypointVisual';
import FeatureSection from './FeatureSection';
import WaypointGroupsVisual from './WaypointGroupsVisual';

export default function ExtensionLanding() {
  const waypointCount = getWaypointCount();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
      {/* Hero: badge + headline + copy + CTA on the left, popup demo on the right */}
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
            <Badge icon={<MousePointerClick size={12} aria-hidden />}>Browser extension</Badge>
            <h1
              style={{
                fontSize: '2.5rem',
                fontWeight: 300,
                marginBottom: '0.75rem',
                color: 'var(--text-primary)',
                lineHeight: 1.15,
              }}
            >
              Jump between Atmosphere clients in one click
            </h1>
            <p
              style={{
                fontSize: '1.05rem',
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
                maxWidth: '34rem',
                marginBottom: '1rem',
              }}
            >
              Land on a Bluesky post and want to read it in Anisota? Click the
              leaf in your toolbar. The popup detects the AT URI on the page
              and offers every app that can render it. Pick a favorite once,
              then auto-redirect handles the rest.
            </p>
            <p
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.85rem',
                color: 'var(--text-accent)',
                fontFamily: 'var(--font-mono)',
                marginBottom: '1.25rem',
              }}
            >
              <Repeat size={14} />
              {waypointCount} curated Atmosphere clients
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
        <FeatureSection
          badge={{ icon: <Compass size={12} />, label: 'One-click jump' }}
          title="Every app that renders the record, in one tap"
          body={
            <>
              <p>
                The popup picks up the AT URI on the page and surfaces a
                recommended client at the top. Every other waypoint that
                supports the lexicon lists below: Anisota, Bluesky, Deer,
                Leaflet, Tangled, Margin, Grain, and the rest of the catalog.
              </p>
              <p>
                Each row links to the equivalent page on the other client.
                No copy-pasting, URL fiddling, or handle resolving.
              </p>
            </>
          }
          visual={<ClientGalleryVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          flip
          badge={{ icon: <Eye size={12} />, label: 'Inspect mode' }}
          title="See the AT URI under everything"
          body={
            <>
              <p>
                Open the Inspect tab to read the underlying record: the DID
                behind the handle, its PDS, the lexicon collection, and the
                inbound backlinks count.
              </p>
              <p>
                Tap any field to copy it, or jump into the Atmosphere Explorer
                for the raw JSON. The same data Bluesky&rsquo;s API exposes,
                rendered inline as you browse.
              </p>
            </>
          }
          visual={<InspectPanelVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          badge={{ icon: <Zap size={12} />, label: 'Auto-redirect' }}
          title="Set it once. Every link opens where you want."
          body={
            <>
              <p>
                Pick a preferred client per record type: posts in Anisota,
                documents in Leaflet, repositories in Tangled. The extension
                routes you there whenever you click an Atmosphere link, from
                anywhere on the web.
              </p>
              <p>
                Preferences are per-lexicon and per-device. Disable
                auto-redirect for one collection without losing the others, or
                turn it off entirely and the extension reverts to popup-only.
              </p>
            </>
          }
          visual={<AutoRedirectVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          flip
          badge={{ icon: <SlidersHorizontal size={12} />, label: 'Custom waypoints' }}
          title="Add any app that follows a URL pattern"
          body={
            <>
              <p>
                If the catalog doesn&rsquo;t cover an app you use, wire it up
                yourself. Name it, give it a URL template like{' '}
                <code style={{ color: 'var(--text-accent)' }}>
                  example.com/u/{'{handle}'}/posts/{'{rkey}'}
                </code>
                , and tell the extension which record types it supports.
              </p>
              <p>
                Templates work in both directions: the extension generates
                outbound links AND reverse-matches inbound ones. Your custom
                waypoint shows up as both a source and a destination in the
                popup, same as any built-in.
              </p>
            </>
          }
          visual={<CustomWaypointVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          badge={{ icon: <Layers size={12} />, label: 'Groups & order' }}
          title="Organize your waypoints into your own groups"
          body={
            <>
              <p>
                Build groups around how you actually browse: a Reading group
                for the Bluesky-shaped clients, a Long-form group for
                Leaflet and friends, a Building group for the developer
                tools. Drag groups up and down to set their order, drag
                rows inside a group to set the order within it.
              </p>
              <p>
                The same waypoint can live in more than one group, so
                Anisota can sit in both Reading and Favorites without
                duplicating preferences. Anything you leave out of every
                group stays hidden from the popup: your groups <em>are</em>{' '}
                your visibility settings.
              </p>
            </>
          }
          visual={<WaypointGroupsVisual />}
        />
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
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: 'var(--text-accent)',
              fontSize: '0.75rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-serif)',
            }}
          >
            <ShieldCheck size={14} aria-hidden /> Local-first
          </div>
          <h2
            style={{
              fontSize: '1.625rem',
              fontWeight: 300,
              color: 'var(--text-primary)',
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            No account, no telemetry, no background network calls.
          </h2>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '1rem',
              lineHeight: 1.65,
              margin: 0,
              maxWidth: '46rem',
            }}
          >
            The extension is read-only and never uploads anything. Preferences live in your browser&rsquo;s local storage.
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

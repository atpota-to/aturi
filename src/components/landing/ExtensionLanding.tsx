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
import DownloadButton, { BrowserFallbackList } from '@/components/home/DownloadButton';
import { getWaypointCount } from '@/utils/waypoints';
import CrossLinkCards from './CrossLinkCards';
import ExtensionHeroVisual from './ExtensionHeroVisual';
import InspectPanelVisual from './InspectPanelVisual';
import AutoRedirectVisual from './AutoRedirectVisual';
import ClientGalleryVisual from './ClientGalleryVisual';
import CustomWaypointVisual from './CustomWaypointVisual';
import FeatureSection from './FeatureSection';
import WaypointGroupsVisual from './WaypointGroupsVisual';

export default function ExtensionLanding() {
  const waypointCount = getWaypointCount();
  return (
    <div className="fl-page">
      {/* Hero: pill + headline + copy + CTA on the left, popup demo on the right */}
      <AppearIn rise>
        <header className="fl-hero">
          <div className="fl-hero-copy">
            <span className="fl-pill">
              <MousePointerClick size={13} aria-hidden /> Browser extension
            </span>
            <h1 className="fl-title">
              Jump between Atmosphere clients{' '}
              <span className="fl-title-accent">in one click</span>
            </h1>
            <p className="fl-lede">
              Land on a Bluesky post and want to read it in Anisota? Click the
              leaf in your toolbar. The popup detects the AT URI on the page
              and offers every app that can render it. Pick a favorite once,
              then auto-redirect handles the rest.
            </p>
            <p className="fl-meta">
              <Repeat size={14} />
              {waypointCount} curated Atmosphere clients
            </p>
            <div className="fl-hero-actions">
              <DownloadButton variant="primary" align="start" />
              <BrowserFallbackList justify="start" />
            </div>
          </div>
          <div className="fl-hero-visual">
            <ExtensionHeroVisual />
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
                <code>
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
        <section className="fl-band">
          <span className="fl-kicker">
            <ShieldCheck size={14} aria-hidden /> Local-first
          </span>
          <h2 className="fl-h2">No account, no telemetry, no background network calls.</h2>
          <div className="fl-body">
            <p>
              The extension is read-only and never uploads anything. Preferences live in your browser&rsquo;s local storage.
            </p>
          </div>
          <DownloadButton variant="outline" align="start" />
        </section>
      </AppearIn>

      <AppearIn delay={0.05}>
        <CrossLinkCards current="extension" />
      </AppearIn>
    </div>
  );
}

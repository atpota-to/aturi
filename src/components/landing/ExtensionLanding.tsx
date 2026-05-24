'use client';

import Link from 'next/link';
import {
  Compass,
  Eye,
  Link2,
  MousePointerClick,
  Repeat,
  ShieldCheck,
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
import ContextMenuVisual from './ContextMenuVisual';
import FeatureSection from './FeatureSection';

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
              Land on a Bluesky post and want to read it in Deer? Click the leaf
              in your toolbar — the popup detects the AT URI on the page and
              offers every app that can render it. Pick a favorite once and let
              auto-redirect handle the rest.
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
          title="Every app that renders the record, one click away"
          body={
            <>
              <p>
                The popup picks up whatever AT URI is on the page and surfaces a
                recommended client at the top, plus every other waypoint that
                supports that lexicon — from Bluesky and Deer to Leaflet,
                Tangled, Margin, Grain, and the rest of the catalog.
              </p>
              <p>
                Each row links straight to the equivalent page on the other
                client, so there&rsquo;s no copy-pasting, no fiddling with URL
                schemes, no re-resolving handles.
              </p>
            </>
          }
          visual={
            <BrowserChrome>
              <ExtensionPopupVisual />
            </BrowserChrome>
          }
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
                Switch to the Inspect tab to read the underlying record: the DID
                behind the handle, the PDS hosting it, the lexicon collection,
                and the count of inbound backlinks pointing at it.
              </p>
              <p>
                Click any field to copy it, or jump straight into the
                Atmosphere Explorer to read the raw JSON. The same data
                Bluesky&rsquo;s API serves, surfaced inline as you browse.
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
                Pick a preferred client for each kind of record — posts in
                Deer, documents in Leaflet, repositories in Tangled — and the
                extension transparently sends you there whenever you click an
                Atmosphere link from anywhere on the web.
              </p>
              <p>
                Preferences are per-lexicon and per-device. Disable
                auto-redirect for one collection without losing the others, or
                turn the whole thing off and the extension goes back to a
                popup-only tool.
              </p>
            </>
          }
          visual={<AutoRedirectVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          flip
          badge={{ icon: <Link2 size={12} />, label: 'Right-click any AT URI' }}
          title="Even raw URIs on random pages become first-class links"
          body={
            <>
              <p>
                The extension registers a context menu on any text that looks
                like an <code style={{ color: 'var(--text-accent)' }}>at://</code>{' '}
                URI. Right-click it and you can open it in your recommended
                app, inspect it on aturi.to, or copy a clean universal link
                pointing at the same record.
              </p>
              <p>
                Useful in DMs, READMEs, JSON viewers, dev tools — anywhere an
                AT URI shows up in plain text instead of a styled link.
              </p>
            </>
          }
          visual={<ContextMenuVisual />}
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
            No account required. No telemetry. No background network calls.
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
            The extension only talks to your PDS when you actively trigger it —
            click the popup, hit Inspect, or follow a context-menu jump.
            Preferences stay in your browser&rsquo;s local storage; nothing is
            uploaded.{' '}
            <Link
              href="/extension/privacy"
              style={{ color: 'var(--text-accent)' }}
            >
              Read the privacy policy
            </Link>
            .
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

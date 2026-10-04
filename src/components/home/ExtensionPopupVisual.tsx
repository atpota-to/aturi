'use client';

import { Leaf, MoreHorizontal, MousePointer2, Settings, Telescope } from 'lucide-react';
import {
  AnisotaLogo,
  AturiSVG,
  BlueskySVG,
  DeerSVG,
} from '@/utils/waypointIcons';

type Props = {
  /** Which mode tab is shown as active. Defaults to 'waypoints'. */
  activeMode?: 'waypoints' | 'inspect';
  /** Badge number on the Inspect tab. Set to 0 to hide. Defaults to 3. */
  inspectBadge?: number;
};

/**
 * Static pure-CSS mock of the browser extension's popup. No real
 * interactivity — communicates what the extension looks like to a
 * visitor who hasn't installed it. Mirrors the actual popup's
 * structure (leaf header, tab strip with Waypoints/Inspect + a
 * settings gear, source URI strip, "Recommended" row, a few sample
 * waypoint rows) so the visual is recognizable to existing users
 * too.
 */
export default function ExtensionPopupVisual({
  activeMode = 'waypoints',
  inspectBadge = 3,
}: Props = {}) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '380px',
        margin: '0 auto',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--shadow-overlay)',
        fontFamily: 'var(--font-serif)',
        color: 'var(--text-primary)',
        // Subtle isometric tilt so the mock reads as a popup floating
        // off the page rather than a flat card.
        transform: 'rotate(-1deg)',
        transition: 'transform 0.4s ease',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px 12px',
          // Rule between the header and the tab strip below it, matching
          // the real popup's header.
          borderBottom: '1px solid var(--border-subtle)',
          background:
            'linear-gradient(180deg, var(--bg-secondary), var(--bg-primary))',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '1.05rem',
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        >
          <Leaf
            size={16}
            style={{ color: 'var(--text-accent)' }}
            aria-hidden
          />
          <span>Aturi</span>
        </div>
        <div
          style={{
            fontSize: '0.65rem',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.02em',
            fontFamily: 'var(--font-mono)',
          }}
        >
          app.bsky.feed.post
        </div>
      </div>

      {/* Mode tabs: Waypoints | Inspect | settings gear. Mirrors the real
          popup's tab strip so the mock is recognizable to existing users. */}
      <ModeTabs activeMode={activeMode} inspectBadge={inspectBadge} />

      {/* Source URI */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.7rem',
          color: 'var(--text-tertiary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: 'var(--text-secondary)' }}>at://</span>
        aturi.to / app.bsky.feed.post / 3lq9…
      </div>

      {/* Recommended row */}
      <Section title="Recommended for posts">
        <Row
          icon={<AnisotaLogo />}
          name="Anisota"
          desc="View post on anisota.net"
        />
      </Section>

      {/* Atmosphere row */}
      <Section title="Bluesky clients">
        <Row
          icon={<BlueskySVG />}
          name="Bluesky"
          desc="View post on bsky.app"
        />
        <Row
          icon={<DeerSVG />}
          name="Deer"
          desc="View post on deer.social"
        />
      </Section>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px 12px',
          borderTop: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.65rem',
          color: 'var(--text-tertiary)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 14,
              height: 14,
              color: 'var(--text-accent)',
            }}
          >
            <AturiSVG />
          </span>
          <span>Copy universal link</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          <MoreHorizontal size={12} aria-hidden />
        </span>
      </div>
    </div>
  );
}

function ModeTabs({
  activeMode,
  inspectBadge,
}: {
  activeMode: 'waypoints' | 'inspect';
  inspectBadge: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)',
      }}
    >
      <ModeTab
        icon={<MousePointer2 size={11} aria-hidden />}
        label="Waypoints"
        active={activeMode === 'waypoints'}
        isFirst
      />
      <ModeTab
        icon={<Telescope size={11} aria-hidden />}
        label="Inspect"
        active={activeMode === 'inspect'}
        badge={inspectBadge > 0 ? inspectBadge : undefined}
      />
      <div
        style={{
          flex: '0 0 auto',
          width: 36,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-tertiary)',
          borderLeft: '1px solid var(--border-subtle)',
          marginBottom: '-1px',
        }}
        aria-label="Open settings"
      >
        <Settings size={12} aria-hidden />
      </div>
    </div>
  );
}

function ModeTab({
  icon,
  label,
  active,
  badge,
  isFirst,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  isFirst?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '5px',
        padding: '8px 8px',
        borderBottom: active
          ? '2px solid var(--text-accent)'
          : '2px solid transparent',
        // Adjacent dividers between the two tabs and the settings gear
        // — matches the real popup's vertical separators.
        borderLeft: isFirst ? 'none' : '1px solid var(--border-subtle)',
        marginBottom: '-1px',
        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
        fontFamily: 'var(--font-sans)',
        fontSize: '0.6rem',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        lineHeight: 1,
      }}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 14,
            height: 14,
            padding: '0 4px',
            marginLeft: 2,
            background: 'var(--text-accent)',
            color: 'var(--bg-primary, #000)',
            borderRadius: 7,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: 0,
            lineHeight: 1,
            textTransform: 'none',
          }}
          aria-label={`${badge} detected URIs`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px' }}>
      <div
        style={{
          fontSize: '0.65rem',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: '8px',
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {children}
      </div>
    </div>
  );
}

function Row({
  icon,
  name,
  desc,
}: {
  icon: React.ReactNode;
  name: string;
  desc: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '6px 8px',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          color: 'var(--text-accent)',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
          {name}
        </div>
        <div
          style={{
            fontSize: '0.65rem',
            color: 'var(--text-tertiary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {desc}
        </div>
      </div>
    </div>
  );
}

'use client';

import {
  Activity,
  Database,
  Fingerprint,
  Hash,
  Link2,
  MousePointer2,
  Settings,
  Telescope,
} from 'lucide-react';

/**
 * Static mock of the extension's "Inspect" tab. Shows the breakdown
 * of an AT URI on the current page — authority (DID), collection
 * (lexicon), record key — alongside the resolved handle and PDS.
 * Used on the /extension landing page to communicate what the
 * extension surfaces beyond just app-switching.
 *
 * The handle and DID are placeholders on purpose. The panel shows a
 * backlink count, and a made-up count next to a real account would be
 * a fabricated statistic about that account.
 */
export default function InspectPanelVisual() {
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--shadow-overlay)',
        maxWidth: '420px',
        width: '100%',
        margin: '0 auto',
      }}
    >
      {/* Tab strip — mirrors the real popup: Waypoints / Inspect with a
          settings gear on the right. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <Tab icon={<MousePointer2 size={11} aria-hidden />} label="Waypoints" isFirst />
        <Tab icon={<Telescope size={11} aria-hidden />} label="Inspect" active badge={3} />
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

      {/* Source URI strip */}
      <div
        style={{
          padding: '10px 14px',
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
        <span style={{ color: 'var(--text-accent)' }}>did:plc:exa…turi</span>
        <span style={{ color: 'var(--text-secondary)' }}>/</span>
        app.bsky.feed.post
        <span style={{ color: 'var(--text-secondary)' }}>/</span>
        3lq9c2fhz3k2v
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Field icon={<Fingerprint size={12} />} label="Authority">
          <span style={{ color: 'var(--text-accent)' }}>did:plc:exampleaturiexampleaturi</span>
        </Field>
        <Field icon={<Hash size={12} />} label="Handle">
          @example.com
        </Field>
        <Field icon={<Database size={12} />} label="PDS">
          pds.example.host
        </Field>
        <Field icon={<Activity size={12} />} label="Collection">
          app.bsky.feed.post
        </Field>
        <Field icon={<Link2 size={12} />} label="Backlinks">
          <span
            style={{
              padding: '1px 6px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-accent)',
              fontSize: '0.65rem',
            }}
          >
            12 records
          </span>
        </Field>
      </div>
    </div>
  );
}

function Tab({
  icon,
  label,
  active,
  badge,
  isFirst,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
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
        padding: '9px 8px',
        borderBottom: active ? '2px solid var(--text-accent)' : '2px solid transparent',
        borderLeft: isFirst ? 'none' : '1px solid var(--border-subtle)',
        marginBottom: '-1px',
        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
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
            color: 'var(--bg-primary)',
            borderRadius: 7,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: 0,
            lineHeight: 1,
            textTransform: 'none',
          }}
          aria-label={`${badge} detected URIs`}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
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
        fontFamily: 'var(--font-mono)',
        fontSize: '0.75rem',
        color: 'var(--text-primary)',
        lineHeight: 1.3,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          color: 'var(--text-tertiary)',
          minWidth: '5.5rem',
          fontFamily: 'var(--font-serif)',
          textTransform: 'uppercase',
          fontSize: '0.6rem',
          letterSpacing: '0.1em',
        }}
      >
        {icon}
        {label}
      </span>
      <span
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </span>
    </div>
  );
}

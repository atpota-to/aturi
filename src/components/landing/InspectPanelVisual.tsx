'use client';

import { Activity, Database, Fingerprint, Hash, Link2 } from 'lucide-react';

/**
 * Static mock of the extension's "Inspect" tab. Shows the breakdown
 * of an AT URI on the current page — authority (DID), collection
 * (lexicon), record key — alongside the resolved handle and PDS.
 * Used on the /extension landing page to communicate what the
 * extension surfaces beyond just app-switching.
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
        transform: 'rotate(-0.4deg)',
      }}
    >
      {/* Tab strip */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-primary)',
          fontSize: '0.75rem',
          fontFamily: 'var(--font-serif)',
        }}
      >
        <Tab>Apps</Tab>
        <Tab active>Inspect</Tab>
        <Tab>Settings</Tab>
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
        <span style={{ color: 'var(--text-accent)' }}>did:plc:gq4…23tj</span>
        <span style={{ color: 'var(--text-secondary)' }}>/</span>
        app.bsky.feed.post
        <span style={{ color: 'var(--text-secondary)' }}>/</span>
        3lq9c2fhz3k2v
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Field icon={<Fingerprint size={12} />} label="Authority">
          <span style={{ color: 'var(--text-accent)' }}>did:plc:gq4fo3u6tqzzdkjlwzpb23tj</span>
        </Field>
        <Field icon={<Hash size={12} />} label="Handle">
          @aturi.to
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

function Tab({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        color: active ? 'var(--text-accent)' : 'var(--text-tertiary)',
        borderBottom: active ? '2px solid var(--text-accent)' : '2px solid transparent',
        lineHeight: 1,
      }}
    >
      {children}
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

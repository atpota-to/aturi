'use client';

import { Check, Globe, Plus } from 'lucide-react';

/**
 * Static mock of the extension's "Add a custom waypoint" form. Each
 * waypoint is just a URL template like /u/{handle}/posts/{rkey} plus
 * a list of record types it supports — the extension parses the
 * template both ways (forward fill when generating links, regex
 * matching when detecting AT URIs on the source side).
 *
 * Used on /extension as a substitute for the "right-click context menu"
 * concept (the extension doesn't ship a context menu). Custom waypoints
 * are a real, documented feature on the Custom tab of the options page.
 */
export default function CustomWaypointVisual() {
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--shadow-overlay)',
        maxWidth: '440px',
        width: '100%',
        margin: '0 auto',
        transform: 'rotate(0.3deg)',
      }}
    >
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <Plus size={14} style={{ color: 'var(--text-accent)' }} aria-hidden />
        <div
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '0.9rem',
            color: 'var(--text-primary)',
          }}
        >
          Add a custom waypoint
        </div>
      </div>

      <div
        style={{
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <Field label="Name">
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: '0.85rem' }}>
            My Reader
          </span>
        </Field>

        <Field label="Profile URL template">
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.78rem',
              wordBreak: 'break-all',
            }}
          >
            <Host>example.com</Host>
            <Slash />
            <Literal>u</Literal>
            <Slash />
            <Placeholder>{'{handle}'}</Placeholder>
          </span>
        </Field>

        <Field label="Post URL template">
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.78rem',
              wordBreak: 'break-all',
            }}
          >
            <Host>example.com</Host>
            <Slash />
            <Literal>u</Literal>
            <Slash />
            <Placeholder>{'{handle}'}</Placeholder>
            <Slash />
            <Literal>posts</Literal>
            <Slash />
            <Placeholder>{'{rkey}'}</Placeholder>
          </span>
        </Field>

        <Field label="Supported record types">
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <Chip selected>Posts</Chip>
            <Chip selected>Profiles</Chip>
            <Chip>Lists</Chip>
            <Chip>Feeds</Chip>
          </div>
        </Field>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '4px',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.7rem',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <Globe size={11} aria-hidden />
            Two-way matching
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 10px',
              background: 'var(--accent-moss)',
              color: 'var(--text-on-accent)',
              border: '1px solid var(--accent-forest)',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-serif)',
            }}
          >
            <Check size={11} aria-hidden /> Saved
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: '0.65rem',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'var(--text-tertiary)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          padding: '8px 10px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-primary)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Chip({ children, selected }: { children: React.ReactNode; selected?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 8px',
        fontSize: '0.72rem',
        fontFamily: 'var(--font-serif)',
        background: selected ? 'var(--bg-secondary)' : 'transparent',
        color: selected ? 'var(--text-primary)' : 'var(--text-tertiary)',
        border: `1px solid ${selected ? 'var(--text-accent)' : 'var(--border-subtle)'}`,
      }}
    >
      {children}
    </span>
  );
}

function Host({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--text-secondary)' }}>{children}</span>;
}

function Slash() {
  return <span style={{ color: 'var(--text-tertiary)' }}>/</span>;
}

function Literal({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--text-primary)' }}>{children}</span>;
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--text-accent)' }}>{children}</span>;
}

'use client';

import {
  Boxes,
  CalendarDays,
  Database,
  Gauge,
  History,
  Link as LinkIcon,
  Server,
} from 'lucide-react';

/**
 * Static mock of the "Repo at a glance" section that sits at the top
 * of /explore/<repo>. Mirrors the live AccountStats tile grid plus the
 * compact identity row beneath it (handle / did / pds) so visitors
 * can see the kind of high-level signal the Explorer surfaces before
 * they drill into individual lexicons.
 */
export default function RepoGlanceVisual() {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '460px',
        margin: '0 auto',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--shadow-overlay)',
        fontFamily: 'var(--font-serif)',
        color: 'var(--text-primary)',
        transform: 'rotate(0.4deg)',
      }}
    >
      <div
        style={{
          padding: '12px 16px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          background:
            'linear-gradient(180deg, var(--bg-secondary), var(--bg-primary))',
        }}
      >
        <div
          style={{
            fontSize: '0.6rem',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            marginBottom: '3px',
          }}
        >
          Explore · @aturi.to
        </div>
        <div
          style={{
            fontSize: '0.95rem',
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        >
          Repo at a glance
        </div>
      </div>

      <div
        style={{
          padding: '10px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '6px',
        }}
      >
        <Tile icon={<Boxes size={13} />} label="Namespaces" value="14" />
        <Tile icon={<Database size={13} />} label="Lexicons" value="63" />
        <Tile icon={<History size={13} />} label="Audit changes" value="8" />
        <Tile icon={<LinkIcon size={13} />} label="Inbound links" value="2.1k" />
        <Tile
          icon={<CalendarDays size={13} />}
          label="Created"
          value="Aug 2023"
          sublabel="2 yrs old"
        />
        <Tile
          icon={<Gauge size={13} />}
          label="cred.blue"
          value="86"
          sublabel="bsky 79 · atp 7"
        />
      </div>

      {/* Identity row beneath the tile grid, matching the live page. */}
      <div
        style={{
          margin: '0 10px 10px',
          padding: '8px 10px',
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-tertiary)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '8px',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.7rem',
        }}
      >
        <IdentityCell label="handle" value="@aturi.to" />
        <IdentityCell label="did" value="did:plc:gq4…23tj" />
        <IdentityCell label="pds" value="pds.example.host" icon={<Server size={10} />} />
      </div>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  sublabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div
      style={{
        padding: '8px 10px',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-tertiary)',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          color: 'var(--text-tertiary)',
          fontSize: '0.58rem',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          fontFamily: 'var(--font-serif)',
        }}
      >
        {icon}
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.15rem',
          fontWeight: 500,
          color: 'var(--text-primary)',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sublabel && (
        <div
          style={{
            fontSize: '0.6rem',
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
}

function IdentityCell({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: '0.55rem',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: '2px',
          fontFamily: 'var(--font-serif)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}
      >
        {icon && (
          <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
            {icon}
          </span>
        )}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

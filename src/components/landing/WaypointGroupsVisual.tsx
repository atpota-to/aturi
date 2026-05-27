'use client';

import { ChevronDown, GripVertical, Plus, X } from 'lucide-react';
import {
  AnisotaLogo,
  BlueskySVG,
  DeerSVG,
  GrainSVG,
  LeafletSVG,
  MarginSVG,
  PdslsSVG,
  SembleSVG,
  TangledSVG,
} from '@/utils/waypointIcons';

/**
 * Static mock of the extension's "Waypoints" settings tab — the group
 * organizer. Mirrors the real options page: cards with a drag handle,
 * a collapsible chevron, a group name, a count chip, and add/delete
 * actions; rows inside the card show waypoint icon + name + their own
 * drag handle + a remove button. One group is shown mid-drag to
 * communicate the reorder affordance.
 */
export default function WaypointGroupsVisual() {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '440px',
        margin: '0 auto',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--shadow-overlay)',
        fontFamily: 'var(--font-serif)',
        color: 'var(--text-primary)',
        transform: 'rotate(-0.4deg)',
      }}
    >
      {/* Settings page title strip — anchors the mock as a window inside
          the options page rather than the popup. */}
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
            fontFamily: 'var(--font-serif)',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            marginBottom: '3px',
          }}
        >
          Settings · Waypoints
        </div>
        <div
          style={{
            fontSize: '0.95rem',
            fontWeight: 500,
            letterSpacing: '-0.01em',
            color: 'var(--text-primary)',
          }}
        >
          Your groups
        </div>
        <div
          style={{
            fontSize: '0.7rem',
            color: 'var(--text-tertiary)',
            marginTop: '2px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          3 groups · 9 visible
        </div>
      </div>

      <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <GroupCard
          name="Reading"
          count={3}
          rows={[
            { icon: <AnisotaLogo />, name: 'Anisota' },
            { icon: <BlueskySVG />, name: 'Bluesky' },
            { icon: <DeerSVG />, name: 'Deer' },
          ]}
        />

        <GroupCard
          name="Long-form"
          count={3}
          dragging
          rows={[
            { icon: <LeafletSVG />, name: 'Leaflet' },
            { icon: <MarginSVG />, name: 'Margin', dragging: true },
            { icon: <SembleSVG />, name: 'Semble' },
          ]}
        />

        <GroupCard
          name="Building"
          count={3}
          collapsed
          rows={[
            { icon: <TangledSVG />, name: 'Tangled' },
            { icon: <GrainSVG />, name: 'Grain' },
            { icon: <PdslsSVG />, name: 'pdsls' },
          ]}
        />
      </div>
    </div>
  );
}

type Row = {
  icon: React.ReactNode;
  name: string;
  dragging?: boolean;
};

function GroupCard({
  name,
  count,
  rows,
  collapsed,
  dragging,
}: {
  name: string;
  count: number;
  rows: Row[];
  collapsed?: boolean;
  dragging?: boolean;
}) {
  return (
    <div
      style={{
        border: dragging
          ? '1px solid var(--text-accent)'
          : '1px solid var(--border-subtle)',
        background: 'var(--bg-tertiary)',
        boxShadow: dragging ? '0 6px 16px rgba(0,0,0,0.25)' : undefined,
        transform: dragging ? 'translateY(-1px)' : undefined,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 10px',
          background: 'var(--bg-secondary)',
          borderBottom: collapsed
            ? '1px solid transparent'
            : '1px solid var(--border-subtle)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            color: dragging ? 'var(--text-accent)' : 'var(--text-tertiary)',
            cursor: 'grab',
          }}
          aria-hidden
        >
          <GripVertical size={12} />
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            color: 'var(--text-secondary)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
          aria-hidden
        >
          <ChevronDown size={12} />
        </span>
        <span
          style={{
            flex: 1,
            fontFamily: 'var(--font-serif)',
            fontWeight: 600,
            fontSize: '0.75rem',
            color: 'var(--text-primary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6rem',
            color: 'var(--text-secondary)',
            padding: '1px 6px',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-tertiary)',
          }}
        >
          {count}
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            color: 'var(--text-secondary)',
            border: '1px solid transparent',
          }}
          aria-hidden
        >
          <Plus size={12} />
        </span>
      </div>

      {/* Rows */}
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((row, i) => (
            <GroupRow key={`${name}-${i}`} {...row} isLast={i === rows.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupRow({
  icon,
  name,
  dragging,
  isLast,
}: Row & { isLast?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '7px 10px',
        background: dragging ? 'var(--bg-elevated, var(--bg-secondary))' : 'var(--bg-tertiary)',
        borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)',
        boxShadow: dragging ? '0 4px 12px rgba(0,0,0,0.25)' : undefined,
        outline: dragging ? '1px solid var(--text-accent)' : undefined,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          color: dragging ? 'var(--text-accent)' : 'var(--text-tertiary)',
          cursor: 'grab',
          flexShrink: 0,
        }}
        aria-hidden
      >
        <GripVertical size={11} />
      </span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          color: 'var(--text-accent)',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: '0.8rem',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-serif)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          color: 'var(--text-tertiary)',
        }}
        aria-hidden
      >
        <X size={11} />
      </span>
    </div>
  );
}

'use client';

import { ChevronDown, ChevronRight, GripVertical, Plus, X } from 'lucide-react';
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
 * Static mock of the extension's "Waypoints" settings tab, the group
 * organizer. Mirrors the real options page: cards with a drag handle,
 * a collapsible chevron, a group name, a count, and an add action;
 * rows inside the card show waypoint icon + name + their own drag
 * handle + a remove button. One group is shown mid-drag to
 * communicate the reorder affordance.
 */
export default function WaypointGroupsVisual() {
  return (
    <div className="fl-mock">
      {/* Settings page title strip: anchors the mock as a window inside
          the options page rather than the popup. */}
      <div className="fl-mock-head">
        <span className="fl-mock-head-stack">
          <span className="fl-mock-label">Settings · Waypoints</span>
          <span className="fl-mock-head-title">Your groups</span>
        </span>
        <span className="fl-mock-sub">3 groups · 9 visible</span>
      </div>

      <div className="fl-mock-body">
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
      className="fl-group"
      data-dragging={dragging ? '' : undefined}
      data-collapsed={collapsed ? '' : undefined}
    >
      <div className="fl-group-head">
        <span className="fl-grip" aria-hidden>
          <GripVertical size={13} />
        </span>
        <span className="fl-grip" aria-hidden>
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </span>
        <span className="fl-group-name">{name}</span>
        <span className="fl-count">{count}</span>
        <span className="fl-grip" aria-hidden>
          <Plus size={13} />
        </span>
      </div>

      {!collapsed &&
        rows.map((row, i) => (
          <div
            key={`${name}-${i}`}
            className="fl-group-row"
            data-dragging={row.dragging ? '' : undefined}
          >
            <span className="fl-grip" aria-hidden>
              <GripVertical size={12} />
            </span>
            <span className="fl-mock-icon" data-size="s">
              {row.icon}
            </span>
            <span className="fl-grow fl-ellipsis">{row.name}</span>
            <span className="fl-grip" aria-hidden>
              <X size={12} />
            </span>
          </div>
        ))}
    </div>
  );
}

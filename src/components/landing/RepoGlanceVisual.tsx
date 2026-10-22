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
    <div className="fl-mock">
      <div className="fl-mock-head">
        <span className="fl-mock-head-stack">
          <span className="fl-mock-label">Explore · @aturi.to</span>
          <span className="fl-mock-head-title">Repo at a glance</span>
        </span>
      </div>

      <div className="fl-stats">
        <Tile icon={<Boxes size={13} />} label="Namespaces" value="14" />
        <Tile icon={<Database size={13} />} label="Lexicons" value="63" />
        <Tile icon={<History size={13} />} label="Audit changes" value="8" />
        <Tile icon={<LinkIcon size={13} />} label="Backlinks" value="2.1k" />
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
      <div className="fl-idrow">
        <IdentityCell label="Handle" value="@aturi.to" />
        <IdentityCell label="DID" value="did:plc:gq4…23tj" />
        <IdentityCell label="PDS" value="pds.example.host" icon={<Server size={11} />} />
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
    <div className="fl-stat">
      <span className="fl-stat-label">
        {icon}
        {label}
      </span>
      <span className="fl-stat-value">{value}</span>
      {sublabel && <span className="fl-stat-sub">{sublabel}</span>}
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
    <div className="fl-idcell">
      <span className="fl-stat-label">{label}</span>
      <span className="fl-idcell-value">
        {icon}
        <span className="fl-ellipsis">{value}</span>
      </span>
    </div>
  );
}

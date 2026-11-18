'use client';

import {
  Activity,
  Database,
  Fingerprint,
  Hash,
  Link2,
  Settings,
} from 'lucide-react';

/**
 * Static mock of the extension's "Inspect" tab. Shows the breakdown
 * of an AT URI on the current page (authority DID, collection, record
 * key) alongside the resolved handle and PDS. Used on the /extension
 * landing page to communicate what the extension surfaces beyond just
 * app-switching.
 */
export default function InspectPanelVisual() {
  return (
    <div className="fl-mock" data-size="s">
      {/* Tab strip, as in the real popup: Open in / Inspect, then settings. */}
      <div className="fl-mock-tabs">
        <span className="fl-mock-tab">Open in</span>
        <span className="fl-mock-tab" data-active="">
          Inspect
          <span className="fl-count" data-on="" aria-label="3 detected URIs">
            3
          </span>
        </span>
        <span className="fl-mock-tab-gear" aria-label="Open settings">
          <Settings size={13} aria-hidden />
        </span>
      </div>

      {/* Source URI strip */}
      <div className="fl-mock-bar">
        <span className="fl-ellipsis">
          <span className="fl-faint">at://</span>
          <span className="fl-accent">did:plc:6te…33el</span>
          <span className="fl-faint">/</span>
          <span className="fl-dim">app.bsky.feed.post</span>
          <span className="fl-faint">/</span>
          <span className="fl-dim">3lq9c2fhz3k2v</span>
        </span>
      </div>

      <div className="fl-mock-body">
        <Field icon={<Fingerprint size={12} />} label="Authority">
          <span className="fl-accent">did:plc:6teuhlkizzebk6wdp42633el</span>
        </Field>
        <Field icon={<Hash size={12} />} label="Handle">
          @aturi.to
        </Field>
        <Field icon={<Database size={12} />} label="PDS">
          pds.atpota.to
        </Field>
        <Field icon={<Activity size={12} />} label="Collection">
          app.bsky.feed.post
        </Field>
        <Field icon={<Link2 size={12} />} label="Backlinks">
          <span className="fl-chip" data-on="">
            12 records
          </span>
        </Field>
      </div>
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
    <div className="fl-mock-field">
      <span className="fl-mock-field-key">
        {icon}
        {label}
      </span>
      <span className="fl-ellipsis">{children}</span>
    </div>
  );
}

'use client';

import { Check, Globe, Plus } from 'lucide-react';

/**
 * Static mock of the extension's "Add a custom waypoint" form. Each
 * waypoint is just a URL template like /u/{handle}/posts/{rkey} plus
 * a list of record types it supports; the extension parses the
 * template both ways (forward fill when generating links, regex
 * matching when detecting AT URIs on the source side).
 *
 * Used on /extension as a substitute for the "right-click context menu"
 * concept (the extension doesn't ship a context menu). Custom waypoints
 * are a real, documented feature on the Custom tab of the options page.
 */
export default function CustomWaypointVisual() {
  return (
    <div className="fl-mock" data-size="s">
      <div className="fl-mock-head">
        <span className="fl-mock-head-title">
          <Plus size={14} aria-hidden />
          Add a custom waypoint
        </span>
      </div>

      <div className="fl-mock-body fl-mock-form">
        <Field label="Name">My Reader</Field>

        <Field label="Profile URL template">
          <span className="fl-mono">
            <Host>example.com</Host>
            <Slash />
            <Literal>u</Literal>
            <Slash />
            <Placeholder>{'{handle}'}</Placeholder>
          </span>
        </Field>

        <Field label="Post URL template">
          <span className="fl-mono">
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

        <div className="fl-mock-formfield">
          <span className="fl-mock-formlabel">Supported record types</span>
          <div className="fl-chips">
            <Chip selected>Posts</Chip>
            <Chip selected>Profiles</Chip>
            <Chip>Lists</Chip>
            <Chip>Feeds</Chip>
          </div>
        </div>
      </div>

      <div className="fl-mock-foot">
        <span className="fl-meta-faint">
          <Globe size={12} aria-hidden />
          Two-way matching
        </span>
        <span className="fl-mock-btn">
          <Check size={12} aria-hidden /> Saved
        </span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fl-mock-formfield">
      <span className="fl-mock-formlabel">{label}</span>
      <div className="fl-mock-input">{children}</div>
    </div>
  );
}

function Chip({ children, selected }: { children: React.ReactNode; selected?: boolean }) {
  return (
    <span className="fl-chip" data-on={selected ? '' : undefined}>
      {selected && <Check size={11} aria-hidden />}
      {children}
    </span>
  );
}

function Host({ children }: { children: React.ReactNode }) {
  return <span className="fl-dim">{children}</span>;
}

function Slash() {
  return <span className="fl-faint">/</span>;
}

function Literal({ children }: { children: React.ReactNode }) {
  return <span>{children}</span>;
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return <span className="fl-accent">{children}</span>;
}

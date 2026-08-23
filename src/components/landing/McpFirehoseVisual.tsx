'use client';

import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';

/**
 * A stand-in for one `sample_firehose` window: the tool opens Jetstream,
 * collects for a few seconds, and closes. Rows arrive on a timer so the
 * page shows the shape of a bounded window filling up, then holding.
 *
 * The collections are ones that carry real traffic on the network; the
 * point of the visual is the mix (Bluesky is one lexicon among many) and
 * the fact that the window ends.
 */

type Event = { collection: string; op: 'create' | 'update' | 'delete'; actor: string };

const EVENTS: Event[] = [
  { collection: 'app.bsky.feed.post', op: 'create', actor: 'did:plc:2urn…' },
  { collection: 'sh.tangled.repo', op: 'create', actor: 'did:plc:ykf7…' },
  { collection: 'app.bsky.feed.like', op: 'delete', actor: 'did:plc:4qde…' },
  { collection: 'com.whtwnd.blog.entry', op: 'create', actor: 'did:plc:jm7z…' },
  { collection: 'social.grain.photo', op: 'create', actor: 'did:plc:h3xb…' },
  { collection: 'pub.leaflet.document', op: 'update', actor: 'did:plc:wq2m…' },
];

const OP_COLOR: Record<Event['op'], string> = {
  create: 'var(--accent-moss)',
  update: 'var(--text-accent)',
  delete: 'var(--text-tertiary)',
};

export default function McpFirehoseVisual() {
  const [shown, setShown] = useState(1);

  useEffect(() => {
    if (shown >= EVENTS.length) return;
    // Roughly the cadence of a quiet collection filter; the window closes
    // once every row is in, matching the tool's event cap.
    const timer = setTimeout(() => setShown((n) => n + 1), 700);
    return () => clearTimeout(timer);
  }, [shown]);

  const closed = shown >= EVENTS.length;

  return (
    <div style={{ width: '100%', border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          padding: '0.625rem 0.875rem',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-tertiary)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
          <Radio
            size={13}
            aria-hidden
            style={{ color: closed ? 'var(--text-tertiary)' : 'var(--accent-moss)' }}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
            sample_firehose
          </span>
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>
          {closed ? 'window closed' : `${shown}/${EVENTS.length}`}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {EVENTS.slice(0, shown).map((event, i) => (
          <div
            key={`${event.collection}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 0.875rem',
              borderBottom: i === shown - 1 ? 'none' : '1px solid var(--border-subtle)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.68rem',
            }}
          >
            <span style={{ color: OP_COLOR[event.op], width: '3.2rem', flexShrink: 0 }}>{event.op}</span>
            <span
              style={{
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {event.collection}
            </span>
            <span style={{ color: 'var(--text-tertiary)', marginLeft: 'auto', flexShrink: 0 }}>{event.actor}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

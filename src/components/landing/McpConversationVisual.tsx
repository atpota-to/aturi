'use client';

import { ArrowRight, CornerDownRight, Sparkles } from 'lucide-react';

/**
 * The hero visual for /mcp: one exchange, start to finish. A question in
 * plain language, the tools the agent picked, and the record it got back.
 *
 * The numbers are real. They are aturi.to's own top post from its own
 * account, read through the same two tools named in the visual, so the
 * demo is the product running rather than a mockup of it.
 */

const TOOL_CALLS = [
  { name: 'resolve_identity', detail: '→ did:plc:6teuh…' },
  { name: 'get_author_feed', detail: '→ 8 posts + counts' },
];

export default function McpConversationVisual() {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: '30rem',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.625rem 0.875rem',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-tertiary)',
        }}
      >
        <Sparkles size={13} style={{ color: 'var(--text-accent)' }} aria-hidden />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            letterSpacing: '0.06em',
            color: 'var(--text-tertiary)',
          }}
        >
          agent · aturi.to/api/mcp
        </span>
      </div>

      <div style={{ padding: '1rem 0.875rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        {/* The question */}
        <p
          style={{
            margin: 0,
            fontSize: '0.9rem',
            lineHeight: 1.5,
            color: 'var(--text-primary)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            padding: '0.625rem 0.75rem',
          }}
        >
          What has @aturi.to been posting about, and which post landed best?
        </p>

        {/* What the agent called */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          {TOOL_CALLS.map((call) => (
            <div
              key={call.name}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
            >
              <CornerDownRight size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} aria-hidden />
              <code
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.72rem',
                  color: 'var(--text-accent)',
                  border: '1px solid var(--border-subtle)',
                  padding: '0.15rem 0.4rem',
                  background: 'var(--bg-primary)',
                }}
              >
                {call.name}
              </code>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {call.detail}
              </span>
            </div>
          ))}
        </div>

        {/* What came back */}
        <div
          style={{
            border: '1px solid var(--border-medium)',
            borderLeft: '2px solid var(--accent-moss)',
            padding: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            background: 'var(--bg-primary)',
          }}
        >
          <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
            Spaces, record editing, and new client support. The Spaces
            announcement did best:
          </p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              41 <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>likes</span>
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              6 <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>reposts</span>
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              1 <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>reply</span>
            </span>
          </div>
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.68rem',
              color: 'var(--text-tertiary)',
              wordBreak: 'break-all',
              lineHeight: 1.4,
            }}
          >
            at://did:plc:6teuhlkizzebk6wdp42633el/app.bsky.feed.post/3mtkpzxkh5k2e
          </code>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.68rem',
              color: 'var(--text-accent)',
            }}
          >
            aturi.to/profile/aturi.to/app.bsky.feed.post/3mtkpzxkh5k2e
            <ArrowRight size={11} aria-hidden />
          </span>
        </div>
      </div>
    </div>
  );
}

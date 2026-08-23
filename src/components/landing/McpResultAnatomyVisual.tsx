'use client';

/**
 * One tool result, annotated. Every tool that names a record or an account
 * returns the same three things beside the data: the canonical at:// URI, an
 * aturi.to link a person can open in their own client, and the app link the
 * record came from. This visual is what that contract looks like on the wire.
 */

type Line = { code: string; note?: string; accent?: boolean };

const LINES: Line[] = [
  { code: '{' },
  { code: '  "uri": "at://did:plc:6teuh…/app.bsky.feed.post/3mtk…",', note: 'canonical identifier' },
  { code: '  "text": "Explore Atproto Spaces 🔭 …",' },
  { code: '  "likeCount": 41, "repostCount": 6,', note: 'engagement, from the AppView' },
  { code: '  "links": {', accent: true },
  { code: '    "aturi": "aturi.to/profile/aturi.to/…",', note: 'opens in any client', accent: true },
  { code: '    "bsky": "bsky.app/profile/aturi.to/post/…"', accent: true },
  { code: '  }', accent: true },
  { code: '}' },
];

export default function McpResultAnatomyVisual() {
  return (
    <div style={{ width: '100%', border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
      <div
        style={{
          padding: '0.5rem 0.875rem',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-tertiary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.68rem',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.06em',
        }}
      >
        tool result
      </div>
      <div style={{ padding: '0.75rem 0.875rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        {LINES.map((line, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.75rem',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
            }}
          >
            <code
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.68rem',
                lineHeight: 1.6,
                color: line.accent ? 'var(--text-accent)' : 'var(--text-secondary)',
                whiteSpace: 'pre',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {line.code}
            </code>
            {line.note && (
              <span
                style={{
                  fontSize: '0.65rem',
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-serif)',
                  whiteSpace: 'nowrap',
                }}
              >
                {line.note}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

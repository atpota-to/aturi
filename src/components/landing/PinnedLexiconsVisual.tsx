'use client';

import {
  ChevronDown,
  ChevronRight,
  Pin,
} from 'lucide-react';

/**
 * Static mock of the Lexicons tab on /explore/<repo> with the "Pinned"
 * section bubbled up to the top. Shows that the user can drag any
 * lexicon out of the hierarchy so the records they care about (their
 * own custom NSIDs, the lexicon they keep auditing) sit at eye-level.
 */
export default function PinnedLexiconsVisual() {
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
      {/* Header strip — anchors the mock as the Lexicons tab inside a
          repo page. */}
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
          Lexicons
        </div>
      </div>

      {/* Pinned section — highlighted with an accent border to mirror the
          real explorer. */}
      <section
        style={{
          margin: '10px',
          border: '1px solid var(--text-accent)',
          background: 'var(--bg-primary)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 10px',
            fontSize: '0.6rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-accent)',
          }}
        >
          <Pin size={11} aria-hidden />
          Pinned
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '0.62rem',
              letterSpacing: '0.04em',
              color: 'var(--text-tertiary)',
              textTransform: 'none',
            }}
          >
            3
          </span>
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', borderTop: '1px solid var(--border-subtle)' }}>
          <PinnedRow nsid="app.bsky.feed.post" />
          <PinnedRow nsid="net.anisota.identity" />
          <PinnedRow nsid="is.dame.now" />
        </ul>
      </section>

      {/* Regular hierarchical lexicon tree below the pinned section. */}
      <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <GroupRow prefix="app.bsky" count={14} open />
        <GroupRow prefix="net.anisota" count={5} />
        <GroupRow prefix="is.dame" count={2} />
        <GroupRow prefix="sh.tangled" count={6} />
      </div>
    </div>
  );
}

function PinnedRow({ nsid }: { nsid: string }) {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '7px 10px',
        borderBottom: '1px solid var(--border-subtle)',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.72rem',
        color: 'var(--text-primary)',
      }}
    >
      <span style={{ color: 'var(--text-accent)' }}>
        <Pin size={10} aria-hidden style={{ fill: 'currentColor' }} />
      </span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {nsid}
      </span>
    </li>
  );
}

function GroupRow({
  prefix,
  count,
  open,
}: {
  prefix: string;
  count: number;
  open?: boolean;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-tertiary)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '7px 10px',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            height: 14,
            color: 'var(--text-tertiary)',
          }}
          aria-hidden
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span
          style={{
            flex: 1,
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            color: 'var(--text-primary)',
          }}
        >
          {prefix}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6rem',
            color: 'var(--text-secondary)',
            padding: '1px 6px',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)',
          }}
        >
          {count}
        </span>
      </div>
      {open && (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {['feed.post', 'feed.like', 'graph.follow'].map((leaf, i) => (
            <li
              key={leaf}
              style={{
                padding: '5px 10px 5px 28px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.68rem',
                color: 'var(--text-secondary)',
                borderTop: i > 0 ? '1px solid var(--border-subtle)' : undefined,
                background:
                  i % 2 === 0 ? 'var(--bg-primary)' : 'transparent',
              }}
            >
              <span style={{ color: 'var(--text-tertiary)' }}>{prefix}.</span>
              {leaf}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

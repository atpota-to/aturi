'use client';

/**
 * Static mock of the signed-in `/explore/<you>/space` view for the spaces
 * landing hero. Mirrors the live page's two blocks: the SpaceGlance stat
 * cells and the SpaceRows list beneath them, using the same example
 * addresses as the spaces OG image (`my.bulletin.board/self`).
 *
 * The duplicate `my.bulletin.board self` rows are deliberate: `listSpaces`
 * spans spaces anchored on other people's DIDs, so type and key collide
 * constantly and the authority column is what tells the rows apart. The
 * mock keeps that property so it teaches the same thing the real list does.
 */

const CELLS: { label: string; value: string; hint: string }[] = [
  { label: 'Spaces', value: '3', hint: 'Spaces you have written to' },
  { label: 'Authorities', value: '2', hint: '1 run by someone else' },
  { label: 'Records', value: '32', hint: 'Across every space' },
];

const ROWS: { spaceType: string; skey: string; authority: string; yours?: boolean }[] = [
  { spaceType: 'my.bulletin.board', skey: 'self', authority: '@you.example', yours: true },
  { spaceType: 'my.bulletin.board', skey: 'self', authority: '@alice.example' },
  { spaceType: 'my.bulletin.board', skey: 'book-club', authority: '@alice.example' },
];

export default function SpacesGlanceVisual() {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: '460px',
        margin: '0 auto',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--shadow-overlay)',
        fontFamily: 'var(--font-serif)',
        color: 'var(--text-primary)',
        transform: 'rotate(0.3deg)',
      }}
    >
      <div
        style={{
          padding: '12px 16px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'linear-gradient(180deg, var(--bg-secondary), var(--bg-primary))',
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
          Explore · @you.example
        </div>
        <div style={{ fontSize: '0.95rem', fontWeight: 500, letterSpacing: '-0.01em' }}>
          Spaces at a glance
        </div>
      </div>

      {/* Stat cells, drawn with the same 1px-gap grid the live SpaceGlance
          uses so the dividers match. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '1px',
          background: 'var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {CELLS.map((cell) => (
          <div
            key={cell.label}
            style={{
              padding: '0.625rem 0.75rem',
              background: 'var(--bg-secondary)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.15rem',
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: '0.6rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-tertiary)',
              }}
            >
              {cell.label}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '1.1rem',
                color: 'var(--text-primary)',
              }}
            >
              {cell.value}
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)' }}>{cell.hint}</span>
          </div>
        ))}
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {ROWS.map((row, i) => (
          <li
            key={`${row.skey}-${row.authority}`}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              gap: '0.6rem',
              padding: '0.55rem 1rem',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              borderBottom: i < ROWS.length - 1 ? '1px solid var(--border-subtle)' : 'none',
            }}
          >
            <span style={{ color: 'var(--text-primary)' }}>{row.spaceType}</span>
            <span style={{ color: 'var(--text-tertiary)' }}>{row.skey}</span>
            <span
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: '0.4rem',
                color: 'var(--text-tertiary)',
              }}
            >
              {row.authority}
              {row.yours && (
                <span
                  style={{
                    fontSize: '0.6rem',
                    padding: '0.05rem 0.3rem',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  yours
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

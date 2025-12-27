import Link from 'next/link';

// IMPORTANT: If you fork aturi.to, you MUST keep it open source under GPL v3.
// This includes keeping the source code available and maintaining the same license.
// Attribution to the original project (made by dame) is appreciated.
// See LICENSE file for full details.

export default function Footer() {
  return (
    <footer
      style={{
        marginTop: '4rem',
        paddingTop: '2rem',
        paddingBottom: '2rem',
        borderTop: '1px solid var(--border-subtle)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          alignItems: 'center',
        }}
      >
        {/* Made by */}
        <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
          Made by{' '}
          <a
            href="https://anisota.net"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link-accent"
            style={{
              color: 'var(--text-accent)',
              textDecoration: 'none',
              transition: 'opacity 0.2s ease',
            }}
          >
            anisota.net
          </a>
          {' '}and{' '}
          <a
            href="https://atpota.to"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link-accent"
            style={{
              color: 'var(--text-accent)',
              textDecoration: 'none',
              transition: 'opacity 0.2s ease',
            }}
          >
            atpota.to
          </a>
        </div>

        {/* Links */}
        <div
          style={{
            display: 'flex',
            gap: '1.5rem',
            flexWrap: 'wrap',
            justifyContent: 'center',
            fontSize: '0.875rem',
          }}
        >
          <Link
            href="/terms"
            className="footer-link"
            style={{
              color: 'var(--text-tertiary)',
              textDecoration: 'none',
              transition: 'color 0.2s ease',
            }}
          >
            Terms & Privacy
          </Link>
          <a
            href="https://tangled.org/atpota.to/aturi"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
            style={{
              color: 'var(--text-tertiary)',
              textDecoration: 'none',
              transition: 'color 0.2s ease',
            }}
          >
            Source Code
          </a>
          <Link
            href="/integrate"
            className="footer-link"
            style={{
              color: 'var(--text-tertiary)',
              textDecoration: 'none',
              transition: 'color 0.2s ease',
            }}
          >
            Integrate
          </Link>
          <a
            href="https://tangled.org/atpota.to/aturi/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
            style={{
              color: 'var(--text-tertiary)',
              textDecoration: 'none',
              transition: 'color 0.2s ease',
            }}
          >
            License
          </a>
        </div>
      </div>
    </footer>
  );
}


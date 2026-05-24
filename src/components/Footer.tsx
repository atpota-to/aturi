import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

// IMPORTANT: If you fork aturi.to, you MUST keep it open source under GPL v3.
// This includes keeping the source code available and maintaining the same license.
// Attribution to the original project (made by dame) is appreciated.
// See LICENSE file for full details.

export default function Footer() {
  const t = useTranslations('footer');
  const madeBy = t.rich('madeBy', {
    a: (chunks) => (
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
        {chunks}
      </a>
    ),
    b: (chunks) => (
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
        {chunks}
      </a>
    ),
  });
  return (
    <footer
      style={{
        position: 'relative',
        zIndex: 1,
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
          {madeBy}
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
            {t('termsAndPrivacy')}
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
            {t('sourceCode')}
          </a>
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
            {t('license')}
          </a>
        </div>
      </div>
    </footer>
  );
}

import Link from 'next/link';
import Header from '@/components/Header';
import NotFoundPanel from '@/components/NotFoundPanel';

/**
 * Where a visitor who hit a dead URL can usefully go next. Deliberately
 * includes the machine-readable entry points: a 404 is the page automated
 * clients hit most often (they guess at paths), and pointing them at the
 * sitemap, llms.txt and the API spec is what turns a dead end into a recovery.
 */
const RECOVERY_LINKS: { href: string; label: string; note: string }[] = [
  { href: '/explore', label: '/explore', note: 'browse any account’s records' },
  { href: '/docs', label: '/docs', note: 'developer documentation' },
  { href: '/sitemap.xml', label: '/sitemap.xml', note: 'every static page' },
  { href: '/llms.txt', label: '/llms.txt', note: 'overview for automated clients' },
  { href: '/openapi.json', label: '/openapi.json', note: 'the public API, typed' },
];

/**
 * Global 404 page. Lives at src/app/not-found.tsx so it covers every
 * Next.js 404 — the notFound() helper, missing dynamic routes, mistyped
 * paths. Shares NotFoundPanel with the client-side resolve-error states
 * inside the explorer so every dead end reads the same.
 */
export default function NotFound() {
  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="container-narrow" style={{ padding: '2rem 2rem 0' }}>
        <Header compact />
      </div>
      {/* Mirror the explore layout's gutter so the panel doesn't sit flush
          against the viewport edges on this top-level route. The panel
          itself no longer self-pads. */}
      <div className="container-narrow" style={{ padding: '0 2rem 4rem' }}>
        <NotFoundPanel />

        {/* Kept out of NotFoundPanel itself: that component is also used for
            resolve-error states inside the explorer, where a list of top-level
            site links is noise. Here it's the whole point. */}
        <nav
          aria-label="Where to look next"
          style={{ maxWidth: '40rem', margin: '0 auto' }}
        >
          <h2
            style={{
              fontSize: '0.7rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-serif)',
              color: 'var(--text-tertiary)',
              margin: '0 0 0.75rem',
            }}
          >
            Where to look next
          </h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {RECOVERY_LINKS.map(({ href, label, note }) => (
              <li key={href} style={{ marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                <Link
                  href={href}
                  style={{
                    color: 'var(--text-accent)',
                    textDecoration: 'none',
                    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                  }}
                >
                  {label}
                </Link>
                <span style={{ color: 'var(--text-tertiary)' }}> — {note}</span>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

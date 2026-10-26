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
    <div style={{ position: 'relative', overflowX: 'clip' }}>
      <Header compact />
      <div className="fn-c-error-wrap">
        <NotFoundPanel />

        {/* Kept out of NotFoundPanel itself: that component is also used for
            resolve-error states inside the explorer, where a list of top-level
            site links is noise. Here it's the whole point. */}
        <nav aria-label="Where to look next" className="fn-c-next">
          <h2>Where to look next</h2>
          <ul>
            {RECOVERY_LINKS.map(({ href, label, note }) => (
              <li key={href}>
                <Link href={href}>
                  <span className="fn-c-next-path">{label}</span>
                  <span className="fn-c-next-note">{note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

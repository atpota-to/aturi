import Header from '@/components/Header';
import NotFoundPanel from '@/components/NotFoundPanel';

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
      <NotFoundPanel />
    </div>
  );
}

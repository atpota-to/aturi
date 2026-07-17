'use client';

/**
 * Last-resort error boundary — catches errors thrown by the root layout
 * itself, where globals.css and the site chrome may not be available.
 * Everything is inline-styled for that reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          color: '#e8e8e6',
          fontFamily: 'Georgia, serif',
        }}
      >
        <div style={{ maxWidth: '32rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>
            aturi.to hit an unexpected error.
          </h1>
          <p style={{ color: '#b8b8b6', lineHeight: 1.6, marginBottom: '1.5rem' }}>
            Reloading usually fixes it.
            {error.digest ? ` (Reference: ${error.digest})` : ''}
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: '0.6rem 1.2rem',
              border: '1px solid #4a5a3f',
              background: '#1a1a1a',
              color: '#e8e8e6',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}

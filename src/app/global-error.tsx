'use client';

/**
 * Last-resort error boundary — catches errors thrown by the root layout
 * itself, where globals.css and the site chrome may not be available.
 * Everything is inline-styled for that reason, with the Field Notes paper
 * palette written out literally (the CSS tokens may not exist here).
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
          padding: '16px',
          boxSizing: 'border-box',
          background: '#f6f4ee',
          color: '#1c1e19',
          fontFamily: "Figtree, system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: '28rem',
            width: '100%',
            padding: '28px',
            boxSizing: 'border-box',
            background: '#ffffff',
            border: '1px solid #e2ded3',
            borderRadius: '12px',
          }}
        >
          <h1
            style={{
              margin: '0 0 8px',
              fontSize: '22px',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1.25,
            }}
          >
            aturi.to hit an unexpected error.
          </h1>
          <p style={{ margin: '0 0 20px', color: '#4a4c44', fontSize: '15px', lineHeight: 1.6 }}>
            Reloading usually fixes it.
            {error.digest ? ` (Reference: ${error.digest})` : ''}
          </p>
          <button
            onClick={() => reset()}
            style={{
              height: '36px',
              padding: '0 16px',
              border: '1px solid #3f5e2e',
              borderRadius: '8px',
              background: '#3f5e2e',
              color: '#ffffff',
              fontFamily: 'inherit',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}

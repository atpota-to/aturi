import Link from 'next/link';

export default function IntegrationPromo() {
  return (
    <footer
      style={{
        marginTop: '4rem',
        paddingTop: '2rem',
        borderTop: '1px solid var(--border-subtle)',
        textAlign: 'center',
        color: 'var(--text-tertiary)',
        fontSize: '0.875rem',
      }}
    >
      <p style={{ marginBottom: '0.5rem' }}>
        Create your own shareable links
      </p>
      <Link
        href="/integrate"
        style={{
          color: 'var(--text-accent)',
          textDecoration: 'underline',
          textUnderlineOffset: '3px',
        }}
      >
        Integrate aturi.to into your app
      </Link>
    </footer>
  );
}







import Link from 'next/link';

interface HeaderProps {
  simple?: boolean; // If true, shows a smaller version without the tagline
}

export default function Header({ simple = false }: HeaderProps) {
  if (simple) {
    return (
      <header
        style={{
          textAlign: 'center',
          marginBottom: '3rem',
          paddingTop: '2rem',
        }}
      >
        <Link
          href="/"
          style={{
            textDecoration: 'none',
          }}
        >
          <h1
            style={{
              fontSize: '2rem',
              marginBottom: '0.5rem',
              fontWeight: 300,
              letterSpacing: '-0.01em',
              background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--text-accent) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            aturi.to
          </h1>
        </Link>
        <p
          style={{
            fontSize: '1rem',
            color: 'var(--text-secondary)',
            fontWeight: 300,
          }}
        >
          Universal links for the ATmosphere
        </p>
      </header>
    );
  }

  return (
    <header
      style={{
        textAlign: 'center',
        marginBottom: '6rem',
        paddingTop: '4rem',
      }}
    >
      <h1
        style={{
          fontSize: '3.5rem',
          marginBottom: '1.5rem',
          fontWeight: 300,
          letterSpacing: '-0.01em',
          background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--text-accent) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        aturi.to
      </h1>
      <p
        style={{
          fontSize: '1.5rem',
          color: 'var(--text-secondary)',
          maxWidth: '600px',
          margin: '0 auto 2rem',
          fontWeight: 300,
        }}
      >
        Universal links for the ATmosphere
      </p>
      <p
        style={{
          fontSize: '1.125rem',
          color: 'var(--text-tertiary)',
          maxWidth: '500px',
          margin: '0 auto',
        }}
      >
        Share ATProto content with anyone, let them choose where to view it
      </p>
    </header>
  );
}


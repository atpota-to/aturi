import Link from 'next/link';
import { Home, Link2, Code } from 'lucide-react';

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
            marginBottom: '2rem',
          }}
        >
          Universal links for the ATmosphere
        </p>

        {/* Organic Navigation */}
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
            maxWidth: '500px',
            margin: '0 auto',
          }}
        >
          <Link href="/" className="nav-link">
            <Home size={14} />
            <span>about</span>
          </Link>
          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>·</span>
          <Link href="/create" className="nav-link">
            <Link2 size={14} />
            <span>create</span>
          </Link>
          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>·</span>
          <Link href="/integrate" className="nav-link">
            <Code size={14} />
            <span>integrate</span>
          </Link>
        </nav>
      </header>
    );
  }

  return (
    <header
      style={{
        textAlign: 'center',
        marginBottom: '3rem',
        paddingTop: '2rem',
      }}
    >
      <h1
        style={{
          fontSize: '3.5rem',
          marginBottom: '1rem',
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
          margin: '0 auto 1.5rem',
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
          margin: '0 auto 2rem',
        }}
      >
        Share ATProto content with anyone, let them choose where to view it
      </p>

      {/* Organic Navigation */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <Link href="/" className="nav-link">
          <Home size={16} />
          <span>about</span>
        </Link>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>·</span>
        <Link href="/create" className="nav-link">
          <Link2 size={16} />
          <span>create</span>
        </Link>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>·</span>
        <Link href="/integrate" className="nav-link">
          <Code size={16} />
          <span>integrate</span>
        </Link>
      </nav>
    </header>
  );
}


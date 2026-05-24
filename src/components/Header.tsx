'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Home, Leaf, Telescope } from 'lucide-react';
import { motion } from 'framer-motion';
import ThemeToggle from './ThemeToggle';
import SessionMenu from './SessionMenu';
import SessionPanel from './SessionPanel';

interface HeaderProps {
  simple?: boolean; // If true, shows a smaller version without the tagline
  compact?: boolean; // If true, shows ultra-compact inline header with expandable menu
}

export default function Header({ simple = false, compact = false }: HeaderProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  // Click outside to close menu
  useEffect(() => {
    if (!compact || !isExpanded) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [compact, isExpanded]);

  // Ultra-compact mode for link preview pages
  if (compact) {
    return (
      <header
        ref={headerRef}
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          marginBottom: '2rem',
        }}
      >
        <div
          className="container-narrow"
          style={{
            padding: '2rem 2rem 0.75rem',
          }}
        >
        <div style={{ position: 'relative' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            padding: '0.75rem 1rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            transform: 'rotate(-0.2deg)',
            transition: 'all 0.3s ease',
            boxShadow: 'var(--shadow-overlay)',
          }}
        >
          {/* Logo/Wordmark with Tagline */}
          <Link
            href="/"
            style={{
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              flex: 1,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: '1.25rem',
                fontWeight: 300,
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--text-accent) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                aturi
              </span>
              <span
                style={{
                  color: 'var(--text-tertiary)',
                  opacity: 0.5,
                }}
              >
                .to
              </span>
            </span>
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 300,
                color: 'var(--text-tertiary)',
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              tour the atmosphere
            </span>
          </Link>

          {/* Expandable menu button — session controls live INSIDE the panel,
              not in the always-visible row, so the compact header stays
              minimal at this level. */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              padding: '0.5rem',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-accent)',
              transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
              transform: isExpanded ? 'rotate(90deg) scale(1.1)' : 'rotate(0deg)',
            }}
            aria-label="Toggle menu"
            aria-expanded={isExpanded}
          >
            <Leaf size={18} style={{
              transition: 'all 0.3s ease',
              opacity: isExpanded ? 0.6 : 1,
            }} />
          </button>
        </div>

        {/* Expanding organic nav panel */}
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '0.5rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            transformOrigin: 'top center',
            transform: isExpanded
              ? 'scaleY(1) translateY(0) rotate(0.3deg)'
              : 'scaleY(0) translateY(-10px) rotate(0deg)',
            opacity: isExpanded ? 1 : 0,
            transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
            pointerEvents: isExpanded ? 'auto' : 'none',
            zIndex: 50,
            overflow: 'hidden',
          }}
        >
          <nav
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
              padding: '0.75rem',
            }}
          >
            <Link href="/" className="compact-nav-link">
              <Home size={16} />
              <span>home</span>
            </Link>
            <Link href="/explore" className="compact-nav-link">
              <Telescope size={16} />
              <span>explore</span>
            </Link>
            <div style={{ marginTop: '0.5rem' }}>
              <ThemeToggle variant="row" />
            </div>

            {/* Session controls: sign in (signed out) OR user info + my repo /
                account / sign out (signed in). Lives inside the expanded
                panel so the compact header stays uncluttered. */}
            <div
              style={{
                marginTop: '0.5rem',
                paddingTop: '0.5rem',
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <SessionPanel onNavigate={() => setIsExpanded(false)} />
            </div>
          </nav>
        </div>
        </div>
        </div>
      </header>
    );
  }

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
            }}
          >
            <span
              style={{
                background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--text-accent) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              aturi
            </span>
            <span
              style={{
                color: 'var(--text-tertiary)',
                opacity: 0.5,
              }}
            >
              .to
            </span>
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
          Tour the Atmosphere
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
            <span>home</span>
          </Link>
          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>·</span>
          <Link href="/explore" className="nav-link">
            <Telescope size={14} />
            <span>explore</span>
          </Link>
          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>·</span>
          <ThemeToggle variant="inline" />
          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>·</span>
          <SessionMenu variant="inline" />
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
      <motion.h1
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number] }}
        style={{
          fontSize: '3.5rem',
          marginBottom: '1rem',
          fontWeight: 300,
          letterSpacing: '-0.01em',
        }}
      >
        <span
          style={{
            background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--text-accent) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          aturi
        </span>
        <span
          style={{
            color: 'var(--text-tertiary)',
            opacity: 0.5,
          }}
        >
          .to
        </span>
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1, ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number] }}
        style={{
          fontSize: '1.5rem',
          color: 'var(--text-secondary)',
          maxWidth: '600px',
          margin: '0 auto 1.5rem',
          fontWeight: 300,
        }}
      >
        Tour the Atmosphere
      </motion.p>
      <motion.p
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2, ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number] }}
        style={{
          fontSize: '1.125rem',
          color: 'var(--text-tertiary)',
          maxWidth: '560px',
          margin: '0 auto 2rem',
        }}
      >
        Switch between clients, share universal links, and browse through any account&rsquo;s PDS data.
      </motion.p>

      {/* Organic Navigation */}
      <motion.nav
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3, ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number] }}
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
          <span>home</span>
        </Link>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>·</span>
        <Link href="/explore" className="nav-link">
          <Telescope size={16} />
          <span>explore</span>
        </Link>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>·</span>
        <ThemeToggle variant="inline" />
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>·</span>
        <SessionMenu variant="inline" />
      </motion.nav>
    </header>
  );
}


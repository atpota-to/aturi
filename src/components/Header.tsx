'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Compass,
  Download,
  Home,
  Menu,
  MessageSquareHeart,
  Orbit,
  Search,
  Telescope,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import ThemeToggle from './ThemeToggle';
import SessionMenu from './SessionMenu';
import SessionPanel from './SessionPanel';
import CompactSearchPanel from './CompactSearchPanel';
import StickyBreadcrumbBar from './explore/StickyBreadcrumbBar';
import WhatsNewBadge from './whatsnew/WhatsNewBadge';

interface HeaderProps {
  simple?: boolean; // If true, shows a smaller version without the tagline
  compact?: boolean; // If true, shows ultra-compact inline header with expandable menu
}

export default function Header({ simple = false, compact = false }: HeaderProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  // When SessionPanel's inline sign-in flow is active, the panel collapses
  // the rest of the nav (home/explore/extension/universal-links + theme
  // toggle) so the handle input and scope picker don't push the popover
  // into a tall, scrolly layout. `useCallback` so SessionPanel's effect
  // doesn't fire on every Header render.
  const [isSignInActive, setIsSignInActive] = useState(false);
  const handleSignInActiveChange = useCallback((active: boolean) => {
    setIsSignInActive(active);
  }, []);
  const headerRef = useRef<HTMLElement>(null);

  // Click outside to close either panel. The menu and search panels are
  // mutually exclusive but share the same outside-click closing behavior.
  useEffect(() => {
    if (!compact || (!isExpanded && !isSearchExpanded)) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
        setIsSearchExpanded(false);
      }
    };

    // Escape closes whichever panel is open — keyboard users otherwise had no
    // way to dismiss the expanded nav menu (only an outside mouse click).
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExpanded(false);
        setIsSearchExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [compact, isExpanded, isSearchExpanded]);

  // Ultra-compact mode for link preview pages
  if (compact) {
    return (
      <header
        ref={headerRef}
        className="compact-header"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          marginBottom: '2rem',
        }}
      >
        <div
          className="container-narrow compact-header-inner"
          style={{
            padding: '2rem 2rem 0.75rem',
          }}
        >
        <div style={{ position: 'relative' }}>
        <div
          style={{
            display: 'flex',
            // Column so the condensed breadcrumb can sit as a full-width
            // section beneath the logo/menu row. The card itself is unpadded
            // so that section's top border reaches both edges — the row and
            // the breadcrumb each carry their own padding instead.
            flexDirection: 'column',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            transform: 'rotate(-0.2deg)',
            transition: 'all 0.3s ease',
            boxShadow: 'var(--shadow-overlay)',
          }}
        >
          <div
            className="compact-header-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '0.75rem 1rem',
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

            {/* Search shortcut — opens an inline search bar below the header
                so visitors can jump into the explorer without leaving the
                page. Mutually exclusive with the nav menu. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {/* Only renders when there's unread news, so the row stays at
                  two buttons the rest of the time. */}
              <WhatsNewBadge />

              <button
                onClick={() => {
                  setIsSearchExpanded((v) => !v);
                  setIsExpanded(false);
                }}
                style={{
                  padding: '0.5rem',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-accent)',
                  transition: 'all 0.3s ease',
                  transform: isSearchExpanded ? 'scale(1.08)' : 'scale(1)',
                }}
                aria-label="Search the explorer"
                aria-expanded={isSearchExpanded}
              >
                <Search
                  size={18}
                  style={{
                    transition: 'all 0.3s ease',
                    opacity: isSearchExpanded ? 0.7 : 1,
                  }}
                />
              </button>

              {/* Expandable menu button — session controls live INSIDE the panel,
                  not in the always-visible row, so the compact header stays
                  minimal at this level. */}
              <button
                onClick={() => {
                  setIsExpanded((v) => !v);
                  setIsSearchExpanded(false);
                }}
                style={{
                  padding: '0.5rem',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-accent)',
                  transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  transform: isExpanded ? 'scale(1.1)' : 'scale(1)',
                }}
                // Names the action rather than the control: "Toggle menu" left
                // a screen-reader user to infer which way it would go.
                aria-label={isExpanded ? 'Close menu' : 'Open menu'}
                aria-expanded={isExpanded}
              >
                {/* A hamburger reads as a button on sight where the old leaf
                    read as decoration, and swapping it for an X while open is
                    the other half of that signal. The previous 90° rotation
                    went with the leaf; spun on a hamburger it just looks like
                    a broken glyph, so the open state is carried by the icon
                    swap instead. */}
                {isExpanded ? (
                  <X size={18} style={{ transition: 'all 0.3s ease' }} />
                ) : (
                  <Menu size={18} style={{ transition: 'all 0.3s ease' }} />
                )}
              </button>
            </div>
          </div>

          {/* Condensed breadcrumb that drops in once you scroll past the
              in-page one, keeping the explorer path anchored at the top.
              A full-width section below the row; renders nothing off the
              explorer routes (no trail registered).

              The nav says where you are; what you can do lives at the other
              end of the screen, in <ExploreChromeBar>. */}
          <StickyBreadcrumbBar />
        </div>

        {/* Search panel — sits in the same expanding region as the menu
            panel but is its own card so the two slide independently. */}
        <div
          // Keep the collapsed search input out of the tab order / a11y tree.
          inert={!isSearchExpanded}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '0.5rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            transformOrigin: 'top center',
            transform: isSearchExpanded
              ? 'scaleY(1) translateY(0) rotate(-0.3deg)'
              : 'scaleY(0) translateY(-10px) rotate(0deg)',
            opacity: isSearchExpanded ? 1 : 0,
            transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
            pointerEvents: isSearchExpanded ? 'auto' : 'none',
            zIndex: 50,
            overflow: 'hidden',
            padding: '0.75rem',
          }}
        >
          <CompactSearchPanel
            active={isSearchExpanded}
            onDone={() => setIsSearchExpanded(false)}
          />
        </div>

        {/* Expanding organic nav panel */}
        <div
          // `inert` when collapsed removes the hidden panel's links and
          // controls from the tab order and accessibility tree. scaleY(0) +
          // opacity + pointerEvents alone left keyboard users tabbing through
          // an invisible menu.
          inert={!isExpanded}
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
            {/* When the sign-in flow is active inside SessionPanel, hide the
                nav rows and theme toggle so the handle input / scope
                picker can claim the panel's vertical space. The session
                controls below carry their own visual chrome (input field,
                scope-picker list) so we drop the divider rule too. */}
            {!isSignInActive && (
              <>
                <div className="compact-nav-grid">
                  <Link href="/" className="compact-nav-link">
                    <Home size={16} />
                    <span>home</span>
                  </Link>
                  <Link href="/explore" className="compact-nav-link">
                    <Telescope size={16} />
                    <span>explore</span>
                  </Link>
                  <Link href="/extension" className="compact-nav-link">
                    <Download size={16} />
                    <span>extension</span>
                  </Link>
                  <Link href="/links" className="compact-nav-link">
                    <Compass size={16} />
                    <span>links</span>
                  </Link>
                  <Link href="/explore/spaces" className="compact-nav-link">
                    <Orbit size={16} />
                    <span>spaces</span>
                  </Link>
                  <Link href="/docs" className="compact-nav-link">
                    <BookOpen size={16} />
                    <span>docs</span>
                  </Link>
                  <Link href="/feedback" className="compact-nav-link">
                    <MessageSquareHeart size={16} />
                    <span>feedback</span>
                  </Link>
                  <ThemeToggle variant="row" />
                </div>
              </>
            )}

            {/* Session controls: sign in (signed out) OR user info + my repo /
                account / sign out (signed in). Lives inside the expanded
                panel so the compact header stays uncluttered. */}
            <div
              style={
                isSignInActive
                  ? undefined
                  : {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                      marginTop: '0.5rem',
                      paddingTop: '0.5rem',
                      borderTop: '1px solid var(--border-subtle)',
                    }
              }
            >
              <SessionPanel
                onNavigate={() => setIsExpanded(false)}
                onSignInActiveChange={handleSignInActiveChange}
              />
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
          <Link href="/extension" className="nav-link">
            <Download size={14} />
            <span>extension</span>
          </Link>
          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>·</span>
          <Link href="/links" className="nav-link">
            <Compass size={14} />
            <span>links</span>
          </Link>
          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>·</span>
          <Link href="/docs" className="nav-link">
            <BookOpen size={14} />
            <span>docs</span>
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
        <Link href="/extension" className="nav-link">
          <Download size={16} />
          <span>extension</span>
        </Link>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>·</span>
        <Link href="/links" className="nav-link">
          <Compass size={16} />
          <span>links</span>
        </Link>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>·</span>
        <Link href="/docs" className="nav-link">
          <BookOpen size={16} />
          <span>docs</span>
        </Link>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>·</span>
        <ThemeToggle variant="inline" />
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>·</span>
        <SessionMenu variant="inline" />
      </motion.nav>
    </header>
  );
}


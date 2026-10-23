'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  Braces,
  Compass,
  Download,
  Leaf,
  Menu,
  MessageSquareHeart,
  Orbit,
  Plug,
  Search,
  Telescope,
  X,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import SessionMenu from './SessionMenu';
import SessionPanel from './SessionPanel';
import CompactSearchPanel from './CompactSearchPanel';
import StickyBreadcrumbBar from './explore/StickyBreadcrumbBar';
import { isEventOutside } from '@/lib/outsideClick';
import WhatsNewBadge from './whatsnew/WhatsNewBadge';

/**
 * Every destination the header links to. `inline` ones sit in the bar on wide
 * screens; all of them are in the menu panel. Lexicons and Spaces live under
 * /explore, so they are listed before Explore in ACTIVE_ORDER below to claim
 * their own paths first.
 */
const NAV_ITEMS = [
  { href: '/explore', label: 'Explore', icon: Telescope, inline: true },
  { href: '/explore/lexicons', label: 'Lexicons', icon: Braces, inline: true },
  { href: '/explore/spaces', label: 'Spaces', icon: Orbit, inline: true },
  { href: '/links', label: 'Links', icon: Compass, inline: true },
  { href: '/extension', label: 'Extension', icon: Download, inline: true },
  { href: '/mcp', label: 'MCP', icon: Plug, inline: true },
  { href: '/docs', label: 'Docs', icon: BookOpen, inline: true },
  { href: '/feedback', label: 'Feedback', icon: MessageSquareHeart, inline: true },
];

/** Longest prefix first, so /explore/lexicons is Lexicons, not Explore. */
const ACTIVE_ORDER = [...NAV_ITEMS].sort((a, b) => b.href.length - a.href.length);

function activeNavHref(pathname: string | null): string | null {
  if (!pathname) return null;
  const hit = ACTIVE_ORDER.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return hit?.href ?? null;
}

/** Leaf mark + wordmark, linking home. */
function Brand() {
  return (
    <Link href="/" prefetch={false} className="fn-brand" aria-label="aturi.to home">
      <Leaf className="fn-brand-mark" aria-hidden strokeWidth={2.2} />
      <span className="fn-wordmark">
        aturi<span className="fn-wordmark-tld">.to</span>
      </span>
    </Link>
  );
}

interface HeaderProps {
  /**
   * Every call site passes this; the full-width bar is the only header. The
   * centered "simple" and "hero" variants it once switched between had no
   * callers left and were removed.
   */
  compact?: boolean;
}

/**
 * Every nav link below sets `prefetch={false}`.
 *
 * Next's default prefetches a link once it scrolls into the viewport, and under
 * the App Router's segment cache each one costs four or five requests — the
 * route's `_tree`, `_head` and `_index` segments plus the page's own. Between
 * them this header and the footer render on every page, so a single render
 * fanned out to roughly forty-five requests across the nine destinations they
 * point at.
 *
 * That is a fair trade when the visitor goes on to click one. It is not when
 * the visitor is a crawler: they execute JavaScript, so they triggered the
 * prefetch too, and they never click. Over 24h those nine paths were 4.9M of
 * the site's 9.7M requests — /terms, which appears only in the footer and below
 * the fold, was still fetched 204k times. The counts tracked where a link sat
 * on the page rather than anything a reader did, which is the tell.
 *
 * `false` disables hover prefetching as well as viewport prefetching; Next
 * gates both on the same flag and offers no hover-only setting. So a real
 * visitor's first click on a nav link is a cold navigation. These are small
 * pages, and that is the whole of the cost.
 */
// Takes no props any more; the type keeps `<Header compact />` call sites valid.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function Header(_props: HeaderProps) {
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
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname);
  const onExplorer = pathname === '/explore' || !!pathname?.startsWith('/explore/');

  // Click outside to close either panel. The menu and search panels are
  // mutually exclusive but share the same outside-click closing behavior.
  useEffect(() => {
    if (!isExpanded && !isSearchExpanded) return;

    const handleClickOutside = (event: MouseEvent) => {
      // isEventOutside, not `contains`: picking a typeahead suggestion inside
      // either panel unmounts the row being clicked, and a detached target
      // reads as a click on the page behind the nav.
      if (isEventOutside(headerRef.current, event)) {
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
  }, [isExpanded, isSearchExpanded]);

  return (
    <header ref={headerRef} className="compact-header fn-header">
      <div className="fn-header-bar">
        <Brand />

        {/* Primary sections inline on wide screens; below the nav
            breakpoint they move into the menu panel (CSS hides this). */}
        <nav aria-label="Primary" className="fn-nav">
          {NAV_ITEMS.filter((item) => item.inline).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className="fn-nav-link"
              aria-current={activeHref === item.href ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="fn-header-actions">
          {/* Explorer pages carry the "go to" field in the bar itself, as
              the design does; it gives way to the search button below
              the tablet breakpoint (CSS). */}
          {onExplorer && (
            <div className="fn-header-search">
              <CompactSearchPanel
                variant="bar"
                active={false}
                onDone={() => setIsSearchExpanded(false)}
              />
            </div>
          )}

          {/* Search shortcut: opens an inline search card below the bar
              so visitors can jump into the explorer without leaving the
              page. Mutually exclusive with the nav menu. */}
          <button
            type="button"
            className={`fn-icon-btn fn-search-toggle${onExplorer ? ' fn-search-toggle-explorer' : ''}`}
            onClick={() => {
              setIsSearchExpanded((v) => !v);
              setIsExpanded(false);
            }}
            aria-label="Search the explorer"
            aria-expanded={isSearchExpanded}
          >
            <Search size={18} />
          </button>

          {/* Only renders when there are release notes to show. */}
          <WhatsNewBadge />

          <span className="fn-header-theme">
            <ThemeToggle variant="inline" />
          </span>

          <span className="fn-header-session">
            <SessionMenu variant="compact" />
          </span>

          {/* Expandable menu button: holds every destination plus the theme
              and session controls, so it is the whole nav below the
              desktop breakpoint. */}
          <button
            type="button"
            className="fn-icon-btn fn-menu-toggle"
            onClick={() => {
              setIsExpanded((v) => !v);
              setIsSearchExpanded(false);
            }}
            // Names the action rather than the control: "Toggle menu" left
            // a screen-reader user to infer which way it would go.
            aria-label={isExpanded ? 'Close menu' : 'Open menu'}
            aria-expanded={isExpanded}
          >
            {/* A hamburger reads as a button on sight, and swapping it for
                an X while open is the other half of that signal. */}
            {isExpanded ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Condensed breadcrumb that drops in once you scroll past the
          in-page one, keeping the explorer path anchored at the top.
          A full-width section below the bar; renders nothing off the
          explorer routes (no trail registered).

          The nav says where you are; what you can do lives at the other
          end of the screen, in <ExploreChromeBar>. */}
      <StickyBreadcrumbBar />

      {/* Search card: drops below the bar. Its own card so it and the
          menu open independently. */}
      <div
        // Keep the collapsed search input out of the tab order / a11y tree.
        inert={!isSearchExpanded}
        className="fn-header-panel fn-header-search-panel"
        data-open={isSearchExpanded || undefined}
      >
        <CompactSearchPanel
          active={isSearchExpanded}
          onDone={() => setIsSearchExpanded(false)}
        />
      </div>

      {/* Menu card */}
      <div
        // `inert` when collapsed removes the hidden panel's links and
        // controls from the tab order and accessibility tree. Opacity and
        // pointerEvents alone left keyboard users tabbing through an
        // invisible menu.
        inert={!isExpanded}
        className="fn-header-panel fn-header-menu-panel"
        data-open={isExpanded || undefined}
        // Clipped by default. The sign-in flow is the exception: its handle
        // typeahead drops a listbox below the input, taller than the panel
        // has room for, and clipping cut the suggestions in half. Relaxed
        // only while the panel is actually open; collapsed, `opacity: 0`
        // and `inert` still cover anything that would escape.
        style={{ overflow: isExpanded && isSignInActive ? 'visible' : 'hidden' }}
      >
        <nav aria-label="Menu" className="fn-menu">
          {/* When the sign-in flow is active inside SessionPanel, hide the
              nav rows and theme toggle so the handle input / scope picker
              can claim the panel's vertical space. */}
          {!isSignInActive && (
            <div className="compact-nav-grid">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="compact-nav-link"
                  prefetch={false}
                  aria-current={activeHref === href ? 'page' : undefined}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                </Link>
              ))}
              <ThemeToggle variant="row" />
            </div>
          )}

          {/* Session controls: sign in (signed out) OR user info + my repo /
              account / sign out (signed in). */}
          <div className={isSignInActive ? undefined : 'fn-menu-session'}>
            <SessionPanel
              onNavigate={() => setIsExpanded(false)}
              onSignInActiveChange={handleSignInActiveChange}
            />
          </div>
        </nav>
      </div>
    </header>
  );
}

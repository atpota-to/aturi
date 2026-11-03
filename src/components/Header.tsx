'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  BookOpen,
  Braces,
  Download,
  Leaf,
  Link2,
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
import { JumpField } from './explore/ChromeField';
import { useMediaQuery } from './explore/useIsNarrow';
import { isEventOutside } from '@/lib/outsideClick';
import { SITE_MENU_TOGGLE_ATTR, setSiteMenuOpen, toggleSiteMenu } from '@/lib/siteMenu';
import SiteMenuButton, { useSiteMenuOpen } from './SiteMenuButton';
import SiteNavButtons from './SiteNavButtons';
import { useCondenseOnScroll } from './useCondenseOnScroll';
import WhatsNewBadge, {
  OPEN_WHATS_NEW_EVENT,
  useUnreadReleaseCount,
} from './whatsnew/WhatsNewBadge';

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
  { href: '/links', label: 'Links', icon: Link2, inline: true },
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

/**
 * Pages that introduce the site rather than do a job on it. On a phone the
 * header bar gives way to the bottom toolbar, and these are the pages that
 * still open with the logo and tagline at the top. Tool pages (the explorer,
 * a universal link, settings, the feedback board) start straight at their
 * own content instead: the top of a small screen is what the reader came
 * for, and the menu one tap away at the bottom has the logo and Home.
 */
const LANDING_PATHS = ['/', '/extension', '/links', '/mcp', '/docs', '/about', '/contact', '/terms', '/fork'];

function isLandingPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return LANDING_PATHS.some(
    (path) => pathname === path || (path !== '/' && pathname.startsWith(`${path}/`)),
  );
}

/**
 * How far down a press on the open menu sheet has to drag before letting go
 * closes it. Only from the sheet's top, so scrolling a tall sheet back up
 * isn't read as a dismissal.
 */
const SHEET_SWIPE_CLOSE_PX = 64;

/** The phone layout of the header (chrome.css, `max-width: 639px`). */
const PHONE_QUERY = '(max-width: 639px)';

/**
 * Leaf mark + wordmark, linking home, then the tagline. The tagline sits
 * outside the link: it is not part of the link's name, and the click target
 * stays the mark. CSS shows it only where the bar has room for it: on wide
 * screens, and from tablet width up once the nav has folded into the menu.
 * On a phone the bar itself is gone and this renders again as the landing
 * pages' masthead, where the tagline always shows.
 */
function Brand() {
  return (
    <div className="fn-header-brand">
      <Link href="/" prefetch={false} className="fn-brand" aria-label="aturi.to home">
        <Leaf className="fn-brand-mark" aria-hidden strokeWidth={2.2} />
        <span className="fn-wordmark">
          aturi<span className="fn-wordmark-tld">.to</span>
        </span>
      </Link>
      <span className="fn-tagline">Tour the Atmosphere</span>
    </div>
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
  // Shared rather than local, because on a phone the button that opens the
  // menu can live in <ExploreChromeBar> (src/lib/siteMenu.ts).
  const isExpanded = useSiteMenuOpen();
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
  const landing = isLandingPath(pathname);
  const phone = useMediaQuery(PHONE_QUERY);
  const unread = useUnreadReleaseCount();
  const swipeStartRef = useRef<number | null>(null);

  // The phone toolbar slims as the reader scrolls down, except while it's in
  // use: the menu open, or its field focused.
  const [barFocused, setBarFocused] = useState(false);
  const barCondensed = useCondenseOnScroll(phone && !isExpanded && !barFocused);

  // The open state outlives this header (it's shared, and every page mounts
  // its own header), so a navigation closes it here rather than by remount.
  useEffect(() => {
    setSiteMenuOpen(false);
  }, [pathname]);

  // On a phone the bell is folded into the menu: its row closes the menu and
  // asks the bell, still mounted in the hidden bar, to open its notes, which
  // chrome.css lifts into a sheet over the toolbar.
  const openWhatsNew = () => {
    setSiteMenuOpen(false);
    window.dispatchEvent(new CustomEvent(OPEN_WHATS_NEW_EVENT, { cancelable: true }));
  };

  // Click outside to close either panel. The menu and search panels are
  // mutually exclusive but share the same outside-click closing behavior.
  useEffect(() => {
    if (!isExpanded && !isSearchExpanded) return;

    const handleClickOutside = (event: MouseEvent) => {
      // isEventOutside, not `contains`: picking a typeahead suggestion inside
      // either panel unmounts the row being clicked, and a detached target
      // reads as a click on the page behind the nav.
      // The phone toolbar's menu button can sit outside the header; it
      // toggles the menu itself.
      if ((event.target as Element | null)?.closest?.(`[${SITE_MENU_TOGGLE_ATTR}]`)) return;
      if (isEventOutside(headerRef.current, event)) {
        setSiteMenuOpen(false);
        setIsSearchExpanded(false);
      }
    };

    // Escape closes whichever panel is open — keyboard users otherwise had no
    // way to dismiss the expanded nav menu (only an outside mouse click).
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSiteMenuOpen(false);
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
    <>
      {/* Phone-only masthead (chrome.css), on the landing pages alone. It
          sits in the page's flow above the header rather than inside it, so
          it scrolls away instead of sticking. */}
      {landing && (
        <div className="fn-masthead">
          <Brand />
        </div>
      )}
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
                setSiteMenuOpen(false);
              }}
              aria-label="Search the explorer"
              aria-expanded={isSearchExpanded}
            >
              <Search size={18} />
            </button>

            {/* Only renders when there are release notes to show. On a phone
                its button hides with the rest of the bar but it stays mounted:
                the menu's "What's new" row opens its notes. */}
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
                toggleSiteMenu();
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
          // On a phone the menu is a sheet over the bottom toolbar, and a
          // downward swipe from its top puts it away, as sheets do.
          onTouchStart={(e) => {
            swipeStartRef.current =
              phone && e.currentTarget.scrollTop <= 0 ? e.touches[0].clientY : null;
          }}
          onTouchEnd={(e) => {
            const start = swipeStartRef.current;
            swipeStartRef.current = null;
            if (start === null) return;
            if (e.changedTouches[0].clientY - start > SHEET_SWIPE_CLOSE_PX) setSiteMenuOpen(false);
          }}
        >
          {/* The sheet's handle on a phone; hidden wider. */}
          <span className="fn-menu-grabber" aria-hidden />
          <nav aria-label="Menu" className="fn-menu">
            {/* When the sign-in flow is active inside SessionPanel, hide the
                nav rows and theme toggle so the handle input / scope picker
                can claim the panel's vertical space. */}
            {!isSignInActive && (
              <>
                {/* Phone only: with no header bar on screen, the logo moves
                    into the menu as the way home. */}
                <Link
                  href="/"
                  prefetch={false}
                  className="compact-nav-link fn-menu-home"
                  aria-label="aturi.to home"
                  aria-current={pathname === '/' ? 'page' : undefined}
                >
                  <Leaf size={16} strokeWidth={2.2} aria-hidden className="fn-brand-mark" />
                  <span className="fn-wordmark">
                    aturi<span className="fn-wordmark-tld">.to</span>
                  </span>
                  <span className="compact-nav-tag">Home</span>
                </Link>
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
                  {/* Phone only, paired with the theme row: the bell's place
                      once the bar it sits in has stepped aside. */}
                  <button
                    type="button"
                    className="compact-nav-link fn-menu-whatsnew"
                    onClick={openWhatsNew}
                    aria-label={unread > 0 ? `What's new, ${unread} unread` : "What's new"}
                  >
                    <Bell size={16} aria-hidden />
                    <span>What&rsquo;s new</span>
                    {unread > 0 && <span className="fn-menu-dot" aria-hidden />}
                  </button>
                  <ThemeToggle variant="row" />
                </div>
              </>
            )}

            {/* Session controls: sign in (signed out) OR user info + my repo /
                account / sign out (signed in). */}
            <div className={isSignInActive ? undefined : 'fn-menu-session'}>
              <SessionPanel
                onNavigate={() => setSiteMenuOpen(false)}
                onSignInActiveChange={handleSignInActiveChange}
              />
            </div>
          </nav>
        </div>

        {/* Phone toolbar: the jump search, Back and Home, and the menu
            button, pinned to the bottom of the screen where a thumb rests.
            Explorer routes hide it
            for <ExploreChromeBar>, which is the same toolbar with the route's
            own field and actions in it; this one serves every other page.
            Built from that bar's classes so the two are one object. */}
        <div
          className="fn-phone-bar"
          data-condensed={barCondensed || undefined}
          onFocus={() => setBarFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setBarFocused(false);
          }}
        >
          <div className="explore-chrome-card">
            <div className="explore-chrome-inner">
              <JumpField />
              <SiteNavButtons />
              <SiteMenuButton />
            </div>
          </div>
        </div>
      </header>

      {/* Dims the page behind the phone menu sheet. Outside the header so a
          press on it counts as outside, which is what closes the menu. */}
      <div className="fn-menu-scrim" data-open={isExpanded || undefined} aria-hidden />
    </>
  );
}

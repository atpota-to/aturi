'use client';

import {
  useCallback,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  BookOpen,
  Braces,
  ChevronDown,
  Download,
  Leaf,
  Link2,
  Menu,
  MessageSquareHeart,
  Orbit,
  Plug,
  Search,
  Telescope,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import SessionMenu from './SessionMenu';
import SessionPanel from './SessionPanel';
import CompactSearchPanel from './CompactSearchPanel';
import StickyBreadcrumbBar from './explore/StickyBreadcrumbBar';
import { JumpField } from './explore/ChromeField';
import { usePhoneSearchOwner } from './explore/PhoneSearchSheet';
import { useMediaQuery } from './explore/useIsNarrow';
import { isEventOutside } from '@/lib/outsideClick';
import { motionAllowed } from '@/lib/motion';
import { SITE_MENU_TOGGLE_ATTR, setSiteMenuOpen, toggleSiteMenu } from '@/lib/siteMenu';
import SiteMenuButton, { useSiteMenuOpen } from './SiteMenuButton';
import SiteNavButtons, { MenuBackButton } from './SiteNavButtons';
import { useCondenseOnScroll } from './useCondenseOnScroll';
import WhatsNewBadge, {
  OPEN_WHATS_NEW_EVENT,
  useUnreadReleaseCount,
} from './whatsnew/WhatsNewBadge';

/**
 * One destination. `label` is its short name, on a bar link or a menu tile;
 * a group's flyout has room for the fuller `title` and a line of `desc`.
 */
type NavLeaf = {
  href: string;
  label: string;
  icon: LucideIcon;
  title?: string;
  desc?: string;
};

/** Destinations that share one item in the bar: a button that opens a flyout. */
type NavGroup = { id: string; label: string; items: NavLeaf[] };

/**
 * The bar's items on wide screens, in order. A plain entry is a link. One
 * with `items` is a group, a button that opens a flyout of its destinations:
 * eight destinations as four items, which is what leaves the bar room for
 * the go-to field and the tagline, and lets it stay a bar on a narrower
 * window.
 *
 * Explore gathers what you browse on the site; Products, what you take away
 * from it. A group's first item is the one its name promises, so it is the
 * row under the pointer when the flyout opens.
 */
const NAV: Array<NavLeaf | NavGroup> = [
  {
    id: 'explore',
    label: 'Explore',
    items: [
      {
        href: '/explore',
        label: 'Explorer',
        desc: 'Browse any account’s records',
        icon: Telescope,
      },
      {
        href: '/explore/lexicons',
        label: 'Lexicons',
        desc: 'Search every record type',
        icon: Braces,
      },
      { href: '/explore/spaces', label: 'Spaces', desc: 'Browse shared spaces', icon: Orbit },
    ],
  },
  { href: '/tools', label: 'Tools', icon: Wrench },
  {
    id: 'products',
    label: 'Products',
    items: [
      {
        href: '/links',
        label: 'Links',
        title: 'Universal links',
        desc: 'One link, every client',
        icon: Link2,
      },
      {
        href: '/extension',
        label: 'Extension',
        title: 'Browser extension',
        desc: 'Jump between clients in a click',
        icon: Download,
      },
      {
        href: '/mcp',
        label: 'MCP',
        title: 'MCP server',
        desc: 'Read-only tools for your AI',
        icon: Plug,
      },
    ],
  },
  { href: '/docs', label: 'Docs', icon: BookOpen },
];

/**
 * Not a section of the site so much as a way to reach the people behind it,
 * so on wide screens it is an icon beside the bell: what you send, next to
 * what you're sent. In the menu, where every destination has a label, it is
 * a tile like the rest.
 */
const FEEDBACK: NavLeaf = { href: '/feedback', label: 'Feedback', icon: MessageSquareHeart };

/**
 * The menu panel's sections, on screens too narrow for the bar: the bar's
 * two groups under their own names, then what stands alone in it. Three
 * destinations each, which is what lets the menu set them three across.
 */
const MENU_SECTIONS: NavGroup[] = [
  ...NAV.filter((entry): entry is NavGroup => 'items' in entry),
  {
    id: 'more',
    label: 'More',
    items: [...NAV.filter((entry): entry is NavLeaf => !('items' in entry)), FEEDBACK],
  },
];

/**
 * Every destination, flat. Lexicons and Spaces live under /explore, so they
 * are listed before Explore in ACTIVE_ORDER below to claim their own paths
 * first.
 */
const NAV_ITEMS: NavLeaf[] = MENU_SECTIONS.flatMap((section) => section.items);

/**
 * A group opens under a pointer that rests on its button, not one passing
 * over it: this long, so crossing the bar on the way to the go-to field
 * opens nothing.
 */
const FLYOUT_OPEN_MS = 90;

/**
 * How long the pointer may be off a flyout that hovering opened before it
 * closes: enough to cut the corner on the way down to a row.
 */
const FLYOUT_CLOSE_MS = 140;

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
 *
 * /explore/spaces counts as a landing despite living under /explore: it is
 * a product page built like /extension and /links, not an explorer view. A
 * space itself is at /explore/{repo}/space, so the prefix match below
 * reaches nothing else.
 */
const LANDING_PATHS = [
  '/',
  '/extension',
  '/links',
  '/mcp',
  '/explore/spaces',
  '/docs',
  '/about',
  '/contact',
  '/terms',
  '/fork',
];

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

/**
 * Where the last header's active pill sat. Every page mounts its own header,
 * so the pill can't slide inside one instance; the next header reads this
 * and slides from the section you left to the one you opened.
 */
let lastActivePill: { x: number; w: number } | null = null;

function placePill(pill: HTMLElement, at: { x: number; w: number }, instant: boolean) {
  if (instant) pill.style.transition = 'none';
  pill.style.transform = `translateX(${at.x}px)`;
  pill.style.width = `${at.w}px`;
  if (instant) {
    void pill.offsetWidth;
    pill.style.transition = '';
  }
}

/**
 * Where a bar item sits in the nav, for a pill to lie under it. A group's
 * button is inside its own positioned wrapper (the flyout hangs from it), so
 * its place in the bar is the wrapper's.
 */
function pillTarget(item: HTMLElement): { x: number; w: number } {
  const box = item.closest<HTMLElement>('.fn-nav-group') ?? item;
  return { x: box.offsetLeft, w: box.offsetWidth };
}

/**
 * The inline section links, with two shared shapes behind them (chrome.css,
 * "Gliding pills"): a hover pill that follows the pointer from link to link,
 * and the green active pill. Until this has measured the links, each link
 * paints its own fills, so the bar reads the same before hydration.
 *
 * A group (NAV) is a button with a flyout of its destinations under it
 * (chrome.css, "Nav groups"). Resting the pointer on the button opens it and
 * leaving closes it; a click, a tap or a key press opens it to stay, until
 * Escape, a press elsewhere, or the focus moving on. Its links follow the
 * button in the document, so Tab walks into them and out the other side.
 */
function PrimaryNav({
  activeHref,
  pathname,
  onPin,
}: {
  activeHref: string | null;
  pathname: string | null;
  /** A flyout was opened to stay: the bar's other panels should make way. */
  onPin: () => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const hoverRef = useRef<HTMLSpanElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);
  // The open group, with the path it was opened on. The explorer's layout
  // keeps one header across its routes, so a flyout would otherwise outlive
  // the navigation it led to; one opened on another path counts as closed.
  const [flyout, setFlyout] = useState<{ id: string; path: string | null } | null>(null);
  const openGroup = flyout && flyout.path === pathname ? flyout.id : null;
  // Opened by a click rather than by hovering, so leaving doesn't close it.
  const pinnedRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  const cancelTimer = () => window.clearTimeout(timerRef.current);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const closeFlyout = () => {
    cancelTimer();
    setFlyout(null);
  };

  useEffect(() => {
    if (!openGroup) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (isEventOutside(navRef.current, event)) setFlyout(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // The flyout goes inert as it closes, which would drop a focus that
      // was inside it: hand it back to the button first.
      const group = navRef.current?.querySelector<HTMLElement>(`[data-group="${openGroup}"]`);
      if (group?.contains(document.activeElement)) {
        group.querySelector<HTMLElement>('.fn-nav-trigger')?.focus();
      }
      setFlyout(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openGroup]);

  const onGroupEnter = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse') return;
    cancelTimer();
    if (openGroup === id) return;
    // With one flyout open, moving along the bar swaps it for the next at
    // once, and keeps whether it was opened to stay.
    if (openGroup) {
      setFlyout({ id, path: pathname });
      return;
    }
    timerRef.current = window.setTimeout(() => {
      pinnedRef.current = false;
      setFlyout({ id, path: pathname });
    }, FLYOUT_OPEN_MS);
  };

  const onGroupLeave = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse') return;
    cancelTimer();
    if (pinnedRef.current) return;
    const panel = event.currentTarget.querySelector('.fn-nav-flyout');
    timerRef.current = window.setTimeout(() => {
      // Left open while the keyboard is inside it.
      if (panel?.contains(document.activeElement)) return;
      setFlyout((current) => (current?.id === id ? null : current));
    }, FLYOUT_CLOSE_MS);
  };

  const onGroupBlur = (id: string, event: ReactFocusEvent<HTMLElement>) => {
    // Tabbing on past the group closes it. No next target means a press on
    // something that takes no focus, which the mousedown listener rules on.
    const next = event.relatedTarget as Node | null;
    if (next && !event.currentTarget.contains(next)) {
      setFlyout((current) => (current?.id === id ? null : current));
    }
  };

  const onTriggerClick = (id: string) => {
    cancelTimer();
    if (openGroup !== id) {
      pinnedRef.current = true;
      setFlyout({ id, path: pathname });
      onPin();
    } else if (pinnedRef.current) {
      setFlyout(null);
    } else {
      // Hovering had already opened it. Closing it under the click that was
      // on its way would read as a flicker; the click keeps it open instead.
      pinnedRef.current = true;
    }
  };

  useLayoutEffect(() => {
    const nav = navRef.current;
    const pill = activeRef.current;
    if (!nav || !pill) return;
    const place = (from: { x: number; w: number } | null) => {
      const link = nav.querySelector<HTMLElement>(
        '.fn-nav-link[aria-current="page"], .fn-nav-link[data-current]',
      );
      // Below the nav breakpoint the bar is hidden (width 0): nothing to place.
      if (!link || link.offsetWidth === 0) {
        pill.removeAttribute('data-on');
        return;
      }
      const to = pillTarget(link);
      const slide = !!from && motionAllowed() && (from.x !== to.x || from.w !== to.w);
      placePill(pill, slide && from ? from : to, true);
      pill.setAttribute('data-on', '');
      if (slide) placePill(pill, to, false);
      lastActivePill = to;
    };
    place(lastActivePill);
    nav.setAttribute('data-glide', '');
    // Fonts landing and the breakpoint both change the links' widths; the
    // first callback reports the size we already measured and is skipped.
    let width = nav.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (nav.offsetWidth === width) return;
      width = nav.offsetWidth;
      pill.removeAttribute('data-on');
      place(null);
    });
    ro.observe(nav);
    return () => ro.disconnect();
  }, [activeHref]);

  const onLinkEnter = (event: ReactPointerEvent<HTMLElement>) => {
    const nav = navRef.current;
    const pill = hoverRef.current;
    if (!nav || !pill || event.pointerType !== 'mouse') return;
    // Arriving from outside the bar, the pill appears under the link rather
    // than sliding in from wherever it last faded out.
    const arriving = !nav.hasAttribute('data-hovering');
    placePill(pill, pillTarget(event.currentTarget), arriving);
    nav.setAttribute('data-hovering', '');
  };

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      className="fn-nav"
      onPointerLeave={() => navRef.current?.removeAttribute('data-hovering')}
    >
      <span ref={hoverRef} className="fn-nav-pill fn-nav-pill-hover" aria-hidden />
      <span ref={activeRef} className="fn-nav-pill fn-nav-pill-active" aria-hidden />
      {NAV.map((entry) => {
        if (!('items' in entry)) {
          return (
            <Link
              key={entry.href}
              href={entry.href}
              prefetch={false}
              className="fn-nav-link"
              aria-current={activeHref === entry.href ? 'page' : undefined}
              onPointerEnter={onLinkEnter}
            >
              {entry.label}
            </Link>
          );
        }
        const open = openGroup === entry.id;
        const flyoutId = `fn-nav-flyout-${entry.id}`;
        return (
          <span
            key={entry.id}
            className="fn-nav-group"
            data-group={entry.id}
            onPointerEnter={(event) => onGroupEnter(entry.id, event)}
            onPointerLeave={(event) => onGroupLeave(entry.id, event)}
            onBlur={(event) => onGroupBlur(entry.id, event)}
          >
            {/* A button, not a link: what it opens is the list of places to
                go. `data-current` marks the group you are in for the active
                pill; the link inside carries `aria-current`. */}
            <button
              type="button"
              className="fn-nav-link fn-nav-trigger"
              aria-expanded={open}
              aria-controls={flyoutId}
              data-current={entry.items.some((item) => item.href === activeHref) || undefined}
              onPointerEnter={onLinkEnter}
              onClick={() => onTriggerClick(entry.id)}
            >
              {entry.label}
              <ChevronDown size={13} aria-hidden className="fn-nav-chevron" />
            </button>
            {/* Stays mounted, as the header's panels do, so it shrinks back
                as well as growing; `inert` keeps its links out of the tab
                order and the accessibility tree while it is closed. */}
            <div id={flyoutId} className="fn-nav-flyout" data-open={open || undefined} inert={!open}>
              {entry.items.map(({ href, label, title, desc, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  prefetch={false}
                  className="fn-nav-flyout-row"
                  aria-current={activeHref === href ? 'page' : undefined}
                  onClick={closeFlyout}
                >
                  <span className="fn-nav-flyout-icon" aria-hidden>
                    <Icon size={16} />
                  </span>
                  <span className="fn-nav-flyout-text">
                    <span className="fn-nav-flyout-title">{title ?? label}</span>
                    {desc && <span className="fn-nav-flyout-desc">{desc}</span>}
                  </span>
                </Link>
              ))}
            </div>
          </span>
        );
      })}
    </nav>
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
  // use: the menu open, its field focused, or the search sheet up.
  const [barFocused, setBarFocused] = useState(false);
  const searching = usePhoneSearchOwner() !== null;
  const barCondensed = useCondenseOnScroll(phone && !isExpanded && !barFocused && !searching);

  // The open state outlives this header (it's shared, and every page mounts
  // its own header), so a navigation closes it here rather than by remount.
  useEffect(() => {
    setSiteMenuOpen(false);
  }, [pathname]);

  // On a phone the bell is folded into the menu: its tile closes the menu and
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
          <PrimaryNav
            activeHref={activeHref}
            pathname={pathname}
            onPin={() => setIsSearchExpanded(false)}
          />

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

            {/* Feedback, as an icon beside the bell (FEEDBACK above). Shown
                only while the nav is inline (CSS): once it folds, the menu's
                Feedback tile is the way there. */}
            <Link
              href={FEEDBACK.href}
              prefetch={false}
              className="fn-icon-btn fn-feedback-link"
              aria-label={FEEDBACK.label}
              title={FEEDBACK.label}
              aria-current={activeHref === FEEDBACK.href ? 'page' : undefined}
            >
              <MessageSquareHeart size={18} aria-hidden />
            </Link>

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
                {/* Phone only: with no header bar on screen, this row is
                    the bar. The logo is the way home, and the bell and the
                    theme switch end it as icons, as they end the bar on a
                    wider screen. Back joins it on a page whose toolbar gave
                    Back its place (the stream monitor). */}
                <div className="fn-menu-top">
                  <MenuBackButton onBack={() => setSiteMenuOpen(false)} />
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
                  {/* The bell's place once the bar it sits in has stepped
                      aside: it closes the menu and opens the notes. */}
                  <button
                    type="button"
                    className="compact-nav-link fn-menu-chip"
                    onClick={openWhatsNew}
                    aria-label={unread > 0 ? `What's new, ${unread} unread` : "What's new"}
                    title="What's new"
                  >
                    <Bell size={18} aria-hidden />
                    {unread > 0 && <span className="fn-menu-dot" aria-hidden />}
                  </button>
                  <ThemeToggle variant="chip" />
                </div>
                {/* The destinations, in the bar's groups: a label, then its
                    three as tiles across (chrome.css, "Menu sections"). */}
                {MENU_SECTIONS.map((section) => (
                  <div
                    key={section.id}
                    className="fn-menu-section"
                    role="group"
                    aria-labelledby={`fn-menu-${section.id}`}
                  >
                    <span id={`fn-menu-${section.id}`} className="fn-menu-kicker">
                      {section.label}
                    </span>
                    <div className="fn-menu-tiles">
                      {section.items.map(({ href, label, icon: Icon }) => (
                        <Link
                          key={href}
                          href={href}
                          className="compact-nav-link fn-menu-tile"
                          prefetch={false}
                          aria-current={activeHref === href ? 'page' : undefined}
                        >
                          <Icon size={18} />
                          <span>{label}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
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

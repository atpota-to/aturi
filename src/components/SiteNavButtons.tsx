'use client';

import { useEffect, useSyncExternalStore, type MouseEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft, House } from 'lucide-react';
import { getReduceMotionSnapshot } from '@/lib/a11y';
import {
  getCanGoBackServerSnapshot,
  getCanGoBackSnapshot,
  noteSitePath,
  subscribeSiteHistory,
} from '@/lib/siteHistory';

/**
 * Back and Home, side by side between the search field and the menu button
 * on a phone's bottom toolbar: the two moves a reader makes most, which the
 * browser's own bar tucks away or, in a home-screen install, doesn't have.
 *
 * Back is greyed out, as a browser's is, when there's no page of this site
 * to go back to: a visit that started here from a link, or a home-screen
 * launch, where going back would leave the site or do nothing
 * (src/lib/siteHistory.ts). On the home page, Home is marked as the current
 * page and scrolls back to the top. Both keep their places either way, so
 * the toolbar doesn't reflow from one page to the next.
 *
 * While the search field is in use the pair folds away and the field grows
 * into its room (chrome.css). Hidden above phone width with the menu button,
 * where the header's nav and the browser's own controls are in reach.
 */
export default function SiteNavButtons() {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const canGoBack = useSyncExternalStore(
    subscribeSiteHistory,
    getCanGoBackSnapshot,
    getCanGoBackServerSnapshot,
  );

  useEffect(() => {
    noteSitePath(pathname);
  }, [pathname]);

  const onHomePage = pathname === '/';
  const onHome = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onHomePage) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: getReduceMotionSnapshot() ? 'auto' : 'smooth' });
  };

  return (
    <div className="fn-site-nav">
      <button
        type="button"
        onClick={() => router.back()}
        disabled={!canGoBack}
        aria-label="Back"
        className="explore-chrome-button fn-site-nav-btn"
      >
        <ChevronLeft size={20} aria-hidden />
      </button>
      <Link
        href="/"
        prefetch={false}
        onClick={onHome}
        aria-label="Home"
        aria-current={onHomePage ? 'page' : undefined}
        className="explore-chrome-button fn-site-nav-btn"
      >
        <House size={18} aria-hidden />
      </Link>
    </div>
  );
}

/**
 * Back, as a tile in the phone menu sheet beside the logo's Home row. Drawn
 * only on a page whose bottom toolbar gave Back and Home's place to its own
 * controls (the stream monitor's Pause and Stop): chrome.css shows it while
 * the toolbar holds a transport (`.fn-menu-back`). Greyed out on the same
 * terms as the toolbar's Back.
 */
export function MenuBackButton({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const canGoBack = useSyncExternalStore(
    subscribeSiteHistory,
    getCanGoBackSnapshot,
    getCanGoBackServerSnapshot,
  );
  return (
    <button
      type="button"
      onClick={() => {
        onBack();
        router.back();
      }}
      disabled={!canGoBack}
      className="compact-nav-link fn-menu-back"
    >
      <ChevronLeft size={16} aria-hidden />
      <span>Back</span>
    </button>
  );
}

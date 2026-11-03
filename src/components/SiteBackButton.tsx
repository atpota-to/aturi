'use client';

import { useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft, House } from 'lucide-react';
import {
  getCanGoBackServerSnapshot,
  getCanGoBackSnapshot,
  noteSitePath,
  subscribeSiteHistory,
} from '@/lib/siteHistory';

/**
 * Beside the menu button on a phone's bottom toolbar: Back while there is a
 * page of this site to go back to, and Home when there isn't, where the
 * browser's own back would leave the site or, in a home-screen launch, do
 * nothing (src/lib/siteHistory.ts). The icon says which, so the button never
 * does something other than what it shows. On the home page with nowhere to
 * go back to it has nothing to offer, and steps aside.
 *
 * Styled as one of the toolbar's chips, and hidden above phone width with the
 * menu button (chrome.css), where the header's nav and the browser's own
 * controls are in reach.
 */
export default function SiteBackButton() {
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

  if (canGoBack) {
    return (
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Back"
        className="explore-chrome-button fn-site-back-btn"
      >
        <ChevronLeft size={20} aria-hidden />
      </button>
    );
  }

  if (pathname === '/') return null;

  return (
    <Link
      href="/"
      prefetch={false}
      aria-label="Home"
      className="explore-chrome-button fn-site-back-btn"
    >
      <House size={18} aria-hidden />
    </Link>
  );
}

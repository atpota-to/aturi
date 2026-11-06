'use client';

import { useSyncExternalStore } from 'react';
import { Menu, X } from 'lucide-react';
import {
  getSiteMenuServerSnapshot,
  getSiteMenuSnapshot,
  subscribeSiteMenu,
  toggleSiteMenu,
} from '@/lib/siteMenu';
import { closePhoneSearch } from '@/lib/phoneSearch';
import { useUnreadReleaseCount } from './whatsnew/WhatsNewBadge';
import { usePhoneSearchOwner } from './explore/PhoneSearchSheet';

/** Whether the site menu is open (see src/lib/siteMenu.ts). */
export function useSiteMenuOpen(): boolean {
  return useSyncExternalStore(
    subscribeSiteMenu,
    getSiteMenuSnapshot,
    getSiteMenuServerSnapshot,
  );
}

/**
 * The menu button at the left end of a phone's bottom toolbar: the header's
 * hamburger, moved to where a thumb rests. It opens the same menu, which on a
 * phone rises out of the toolbar as a sheet (chrome.css).
 *
 * Carries the what's-new dot as well, because on a phone the bell it belongs
 * to is inside the menu this opens. Styled as one of the toolbar's chips, and
 * hidden above phone width, where the header has its own button.
 *
 * While the search sheet is open (PhoneSearchSheet.tsx) it is that sheet's
 * Close instead: the menu has nowhere to open over a search, and this is the
 * way back to the page. Closing also drops the keyboard.
 *
 * Both icons are always drawn, stacked, and chrome.css turns one into the
 * other, so the hamburger becomes the X rather than being swapped for it.
 */
export default function SiteMenuButton() {
  const open = useSiteMenuOpen();
  const unread = useUnreadReleaseCount();
  const searching = usePhoneSearchOwner() !== null;

  let label = 'Open menu';
  if (searching) label = 'Close search';
  else if (open) label = 'Close menu';
  else if (unread > 0) label = `Open menu, ${unread} unread in What's new`;

  const showX = open || searching;

  return (
    <button
      type="button"
      // Exempts this button from the header's close-on-outside-press.
      data-site-menu-toggle=""
      onClick={() => {
        if (!searching) {
          toggleSiteMenu();
          return;
        }
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        closePhoneSearch();
      }}
      aria-expanded={searching ? undefined : open}
      aria-label={label}
      className="explore-chrome-button fn-site-menu-btn"
      data-open={(!searching && open) || undefined}
    >
      <span className="fn-site-menu-icon" data-x={showX || undefined} aria-hidden>
        <Menu size={18} />
        <X size={18} />
      </span>
      {!showX && unread > 0 && <span className="fn-site-menu-dot" aria-hidden />}
    </button>
  );
}

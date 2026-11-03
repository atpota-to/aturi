'use client';

import { useSyncExternalStore } from 'react';
import { Menu, X } from 'lucide-react';
import {
  getSiteMenuServerSnapshot,
  getSiteMenuSnapshot,
  subscribeSiteMenu,
  toggleSiteMenu,
} from '@/lib/siteMenu';
import { useUnreadReleaseCount } from './whatsnew/WhatsNewBadge';

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
 */
export default function SiteMenuButton() {
  const open = useSiteMenuOpen();
  const unread = useUnreadReleaseCount();

  let label = 'Open menu';
  if (open) label = 'Close menu';
  else if (unread > 0) label = `Open menu, ${unread} unread in What's new`;

  return (
    <button
      type="button"
      // Exempts this button from the header's close-on-outside-press.
      data-site-menu-toggle=""
      onClick={toggleSiteMenu}
      aria-expanded={open}
      aria-label={label}
      className="explore-chrome-button fn-site-menu-btn"
      data-open={open || undefined}
    >
      {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
      {!open && unread > 0 && <span className="fn-site-menu-dot" aria-hidden />}
    </button>
  );
}

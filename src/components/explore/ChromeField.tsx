'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ClipboardPaste, Search, X } from 'lucide-react';
import { resolveSearchPathAsync } from '@/utils/atproto/searchRouting';
import { recordQueryVisit } from '@/utils/searchHistory';
import {
  closePhoneSearch,
  getPhoneSearchOwner,
  openPhoneSearch,
  subscribePhoneSearch,
} from '@/lib/phoneSearch';
import { setSiteMenuOpen } from '@/lib/siteMenu';
import PhoneSearchSheet, { usePhoneSearchOwner } from './PhoneSearchSheet';
import { useMediaQuery } from './useIsNarrow';

/** The phone toolbar's width (chrome.css, Phone toolbar), where the search sheet opens. */
const PHONE_QUERY = '(max-width: 639px)';

/*
 * The search field the bottom chrome bars are built around. <ExploreChromeBar>
 * fills it with the route's own filter or, failing that, the jump search; on a
 * phone the site-wide toolbar in <Header> carries the jump search on every
 * other page. Kept apart from the explorer bar so the header can use it
 * without pulling the whole explorer toolbar into every page.
 */

/**
 * Fallback for routes with no list to narrow — a single record, a lexicon,
 * the explorer landing. Same routing as the header search: handles, DIDs,
 * at:// URIs, and client URLs all resolve to their explorer page.
 *
 * On a phone, focusing it opens the search sheet (PhoneSearchSheet.tsx) over
 * the page, and the field drives it from the toolbar. A route's own filter
 * (RouteField in ExploreChromeBar) never does: its point is the list it
 * narrows, which the sheet would hide.
 */
export function JumpField() {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards a second Enter while an unrecognized URL is being resolved
  // through /api/at-tags.
  const resolvingRef = useRef(false);
  const fieldId = useId();
  const sheetId = `${fieldId}-sheet`;
  const phone = useMediaQuery(PHONE_QUERY);
  const sheetOpen = usePhoneSearchOwner() === fieldId;
  const canPaste = useCanReadClipboard();
  // The sheet's primary row (what Search runs), set by the sheet.
  const primaryRef = useRef<(() => void) | null>(null);

  // A landed navigation is the end of that query — don't leave it sitting in
  // the bar on the page it took you to, or the sheet open over it.
  useEffect(() => {
    setValue('');
    if (getPhoneSearchOwner() === fieldId) closePhoneSearch();
  }, [pathname, fieldId]);

  // Closing the sheet, from here or from the toolbar's Close button, ends
  // the search, as Cancel does in an iOS search field.
  useEffect(() => {
    let mine = getPhoneSearchOwner() === fieldId;
    const unsubscribe = subscribePhoneSearch(() => {
      const now = getPhoneSearchOwner() === fieldId;
      if (mine && !now) setValue('');
      mine = now;
    });
    return () => {
      unsubscribe();
      if (getPhoneSearchOwner() === fieldId) closePhoneSearch();
    };
  }, [fieldId]);

  // Widened past phone width (a rotation, a resized window): the sheet and
  // the page-hiding behind it are phone-only, so put the page back.
  useEffect(() => {
    if (!phone && sheetOpen) closePhoneSearch();
  }, [phone, sheetOpen]);

  const openSheet = () => {
    if (!phone || getPhoneSearchOwner() === fieldId) return;
    setSiteMenuOpen(false);
    openPhoneSearch(fieldId);
  };

  async function go(query: string) {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    try {
      const path = await resolveSearchPathAsync(query);
      if (path) {
        recordQueryVisit(query, path);
        // Closed here as well as on landing, for a jump to the page that is
        // already open, where the path never changes.
        if (getPhoneSearchOwner() === fieldId) closePhoneSearch();
        router.push(path);
      }
    } finally {
      resolvingRef.current = false;
    }
  }

  /*
   * Pasting a link someone shared is the most common way into this field,
   * and on a phone that otherwise means a long press, a menu, then Search.
   * The browser decides whether the read goes through (Safari asks with its
   * own Paste bubble, Chrome with a permission prompt), so a refusal is an
   * ordinary outcome and leaves the field as it was.
   *
   * A handle, DID, at:// URI or URL has no spaces in it. Anything that does
   * would only route to a not-found repo page, so it goes into the field to
   * be edited rather than followed.
   */
  async function pasteAndGo() {
    let text: string;
    try {
      text = (await navigator.clipboard.readText()).trim();
    } catch {
      return;
    }
    if (!text) return;
    setValue(text);
    if (!/\s/.test(text)) await go(text);
  }

  return (
    <>
      <FieldForm
        inputRef={inputRef}
        label="Go to a handle, DID, or at:// URI"
        placeholder="Go to a handle, DID or at:// URI"
        value={value}
        onChange={(next) => {
          setValue(next);
          // Typing reopens it too: Escape closes the sheet but leaves the
          // field focused, so focus alone wouldn't bring it back.
          openSheet();
        }}
        onSubmit={() => {
          if (sheetOpen && primaryRef.current) primaryRef.current();
          else void go(value);
        }}
        onClear={() => {
          setValue('');
          inputRef.current?.focus();
        }}
        onPasteAndGo={pasteAndGo}
        onFocus={openSheet}
        onEscapeEmpty={sheetOpen ? closePhoneSearch : undefined}
        controls={sheetOpen ? sheetId : undefined}
      />
      {sheetOpen && (
        <PhoneSearchSheet
          id={sheetId}
          query={value}
          onJump={() => void go(value)}
          onPaste={canPaste ? pasteAndGo : null}
          onDone={closePhoneSearch}
          primaryRef={primaryRef}
        />
      )}
    </>
  );
}

const noSubscription = () => () => {};

/**
 * Whether this browser can read the clipboard from script at all (Firefox
 * only gained it in 125, and it needs a secure context). False on the
 * server, so the button only appears once hydrated.
 */
function useCanReadClipboard(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => typeof navigator.clipboard?.readText === 'function',
    () => false,
  );
}

export function FieldForm({
  inputRef,
  label,
  placeholder,
  value,
  status,
  onChange,
  onSubmit,
  onClear,
  onPasteAndGo,
  onFocus,
  onEscapeEmpty,
  controls,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  label: string;
  placeholder: string;
  value: string;
  status?: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  /** Only the jump search offers this; a route's filter has nothing to go to. */
  onPasteAndGo?: () => void;
  onFocus?: () => void;
  /** Escape on an empty field: the jump search closes its phone sheet. */
  onEscapeEmpty?: () => void;
  /** The id of the results this field drives, while they're showing. */
  controls?: string;
}) {
  const canPaste = useCanReadClipboard() && !!onPasteAndGo;
  return (
    <form
      role="search"
      aria-label={label}
      className="explore-chrome-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Search size={13} aria-hidden className="explore-chrome-search-icon" />
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        aria-label={label}
        aria-controls={controls}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={(e) => {
          // Escape clears rather than closes — the bar is permanent chrome,
          // so there's nothing to dismiss. The phone sheet is the exception:
          // once the field is empty, the next Escape puts it away.
          if (e.key !== 'Escape') return;
          if (value) {
            e.preventDefault();
            onClear();
          } else if (onEscapeEmpty) {
            e.preventDefault();
            onEscapeEmpty();
          }
        }}
        className="explore-chrome-input"
      />
      {status && (
        // Read as one unit so a mid-type update doesn't get announced
        // digit by digit.
        <span aria-live="polite" aria-atomic className="explore-chrome-status">
          {status}
        </span>
      )}
      {value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear"
          title="Clear"
          className="explore-chrome-clear"
        >
          <X size={14} aria-hidden />
        </button>
      ) : (
        // Clear's slot while the field is empty, so the row on a phone,
        // already short of width, doesn't give up any more of it.
        canPaste && (
          <button
            type="button"
            onClick={onPasteAndGo}
            aria-label="Paste and go"
            title="Paste and go"
            className="explore-chrome-clear explore-chrome-paste"
          >
            <ClipboardPaste size={15} aria-hidden />
          </button>
        )
      )}
    </form>
  );
}

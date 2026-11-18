'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ClipboardPaste, Search, X } from 'lucide-react';
import { resolveSearchPathAsync } from '@/utils/atproto/searchRouting';
import { recordQueryVisit } from '@/utils/searchHistory';
import {
  closePhoneSearch,
  getPhoneSearchOwner,
  isCurrentPath,
  openPhoneSearch,
  runPhoneSearchPrimary,
  setPhoneSearchQuery,
  subscribePhoneSearch,
} from '@/lib/phoneSearch';
import { setSiteMenuOpen } from '@/lib/siteMenu';
import { PHONE_SEARCH_SHEET_ID, usePhoneSearchOwner } from './PhoneSearchSheet';
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
 * the page, and the field drives it from the toolbar: it hands the sheet its
 * text and the two things the sheet can ask of it, jump and paste. A
 * route's own filter (RouteField in ExploreChromeBar) never opens the sheet:
 * its point is the list it narrows, which the sheet would hide.
 */
export function JumpField() {
  const pathname = usePathname();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const jump = useJump();
  const fieldId = useId();
  const phone = useMediaQuery(PHONE_QUERY);
  const sheetOpen = usePhoneSearchOwner() === fieldId;
  const canPaste = useCanReadClipboard();

  // A landed navigation is the end of that query — don't leave it sitting in
  // the bar on the page it took you to. (The sheet's host closes the sheet.)
  useEffect(() => {
    setValue('');
  }, [pathname]);

  // The sheet searches what the field holds.
  useEffect(() => {
    setPhoneSearchQuery(fieldId, value);
  }, [fieldId, value]);

  // Closing the sheet, from here or from the toolbar's Close button, ends
  // the search, as Cancel does in an iOS search field. A field that goes
  // while it owns the sheet (its page's toolbar unmounting) closes it.
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

  /** Resolve and go; false when the text named nowhere. */
  const go = (query: string) =>
    jump(query, (path) => {
      // The sheet's host closes it when the next page lands; a jump to the
      // page already open lands nowhere new, so close it here.
      if (isCurrentPath(path)) closePhoneSearch();
    });

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
    const text = await readClipboard();
    if (!text) return;
    setValue(text);
    if (!/\s/.test(text)) await go(text);
  }

  const openSheet = (query: string) => {
    if (!phone) return;
    if (getPhoneSearchOwner() !== fieldId) setSiteMenuOpen(false);
    openPhoneSearch(fieldId, query, {
      jump: go,
      paste: canPaste ? () => void pasteAndGo() : null,
    });
  };

  return (
    <FieldForm
      inputRef={inputRef}
      label="Go to a handle, DID, or at:// URI"
      placeholder="Go to a handle, DID or at:// URI"
      value={value}
      onChange={(next) => {
        setValue(next);
        // Typing reopens it too: Escape closes the sheet but leaves the
        // field focused, so focus alone wouldn't bring it back.
        openSheet(next);
      }}
      onSubmit={() => {
        if (sheetOpen && runPhoneSearchPrimary()) return;
        void go(value);
      }}
      onClear={() => {
        setValue('');
        inputRef.current?.focus();
      }}
      onPasteAndGo={pasteAndGo}
      onFocus={() => openSheet(value)}
      onEscapeEmpty={sheetOpen ? closePhoneSearch : undefined}
      controls={sheetOpen ? PHONE_SEARCH_SHEET_ID : undefined}
    />
  );
}

/**
 * The jump search's routing, for any field that can send you somewhere:
 * resolve the text to its explorer page (handles, DIDs, at:// URIs, client
 * URLs, AT Tags for an unrecognized URL) and push it. Resolves false when the
 * text named nowhere. `beforePush` sees the path first, for a caller with
 * something to tidy before the page changes.
 */
export function useJump() {
  const router = useRouter();
  // Guards a second Enter while an unrecognized URL is being resolved
  // through /api/at-tags.
  const resolvingRef = useRef(false);

  return async (query: string, beforePush?: (path: string) => void): Promise<boolean> => {
    if (resolvingRef.current) return false;
    resolvingRef.current = true;
    try {
      const path = await resolveSearchPathAsync(query);
      if (!path) return false;
      recordQueryVisit(query, path);
      beforePush?.(path);
      router.push(path);
      return true;
    } finally {
      resolvingRef.current = false;
    }
  };
}

/**
 * Text that can only mean "take me there": an at:// URI or an http(s) link.
 * A route's filter takes over the bar from the jump search, but these still
 * jump on Enter or Paste and go, since a pasted link is the commonest way
 * into the bar. The filter still narrows by them as they're typed (a record
 * search can match a like's subject URI); a live filter has nothing for
 * Enter to do, so Enter is free to mean go. A handle or DID stays a filter,
 * because a list of repos or members is narrowed by exactly those, and a
 * half-typed one would jump to a repo that doesn't exist.
 */
export function isJumpQuery(text: string): boolean {
  const v = text.trim();
  return !/\s/.test(v) && (v.startsWith('at://') || /^https?:\/\//i.test(v));
}

/**
 * The clipboard's text, trimmed, for a Paste and go button; null when it's
 * empty or the browser refused the read (see JumpField's pasteAndGo).
 */
export async function readClipboard(): Promise<string | null> {
  try {
    return (await navigator.clipboard.readText()).trim() || null;
  } catch {
    return null;
  }
}

const noSubscription = () => () => {};

/**
 * Whether this browser can read the clipboard from script at all (Firefox
 * only gained it in 125, and it needs a secure context). False on the
 * server, so the button only appears once hydrated.
 */
export function useCanReadClipboard(): boolean {
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
  /** Shown in Clear's slot while the field is empty, where the clipboard can be read. */
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
            // Chromium focuses a button on press, and focus in the form folds
            // Back and Home away on a phone (chrome.css) so the field grows
            // right, carrying this button out from under the finger before
            // the click lands. Refusing focus keeps it where it was tapped.
            onMouseDown={(e) => e.preventDefault()}
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

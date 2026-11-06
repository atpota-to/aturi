'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ClipboardPaste, Search, X } from 'lucide-react';
import { resolveSearchPathAsync } from '@/utils/atproto/searchRouting';

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
 */
export function JumpField() {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards a second Enter while an unrecognized URL is being resolved
  // through /api/at-tags.
  const resolvingRef = useRef(false);

  // A landed navigation is the end of that query — don't leave it sitting in
  // the bar on the page it took you to.
  useEffect(() => {
    setValue('');
  }, [pathname]);

  async function go(query: string) {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    try {
      const path = await resolveSearchPathAsync(query);
      if (path) router.push(path);
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
    <FieldForm
      inputRef={inputRef}
      label="Go to a handle, DID, or at:// URI"
      placeholder="Go to a handle, DID or at:// URI"
      value={value}
      onChange={setValue}
      onSubmit={() => go(value)}
      onClear={() => {
        setValue('');
        inputRef.current?.focus();
      }}
      onPasteAndGo={pasteAndGo}
    />
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
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Escape clears rather than closes — the bar is permanent chrome,
          // so there's nothing to dismiss.
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onClear();
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

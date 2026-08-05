'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Check, Link2, Search, X } from 'lucide-react';
import { resolveSearchPathAsync } from '@/utils/atproto/searchRouting';
import { useChromeBar } from './ChromeBarContext';

/**
 * Thin bar pinned to the bottom of the viewport on every explorer route, so
 * the two things you always want are one reach away instead of a scroll away:
 *
 *   - Left: the find action for wherever you are. Routes publish it through
 *     <ChromeBarProvider> — "Filter lexicons…" on a repo, "Search records…"
 *     in a collection, "Search repos…" on a PDS — and it stays in lockstep
 *     with the in-page control when there is one. Routes with nothing to
 *     filter (a single record, a lexicon page) fall back to the global jump
 *     search, which resolves a handle / DID / at:// URI / URL the same way
 *     the header's search does.
 *   - Right: copy the link to the page you're on.
 *
 * The bar reserves its own height as padding on <body> (see
 * `.has-explore-chrome` in globals.css), so it never covers the end of a
 * list or the site footer.
 */
export default function ExploreChromeBar() {
  const { field } = useChromeBar();
  const barRef = useRef<HTMLDivElement>(null);

  // Reserve the bar's real height at the bottom of the document — measured,
  // not assumed, since the row wraps to two lines on narrow screens. The CSS
  // fallback covers first paint (and any browser without ResizeObserver).
  useEffect(() => {
    const node = barRef.current;
    if (!node) return undefined;
    const root = document.documentElement;
    document.body.classList.add('has-explore-chrome');
    const apply = () => {
      root.style.setProperty('--explore-chrome-h', `${node.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.body.classList.remove('has-explore-chrome');
      root.style.removeProperty('--explore-chrome-h');
    };
  }, []);

  return (
    <div ref={barRef} className="explore-chrome-bar">
      <div className="container-narrow explore-chrome-inner">
        {field ? <RouteField key="route" /> : <JumpField key="jump" />}
        <CopyLinkButton />
      </div>
    </div>
  );
}

/**
 * The route's own filter/search, driven straight from the published snapshot
 * so typing here and typing in the in-page control are the same edit.
 */
function RouteField() {
  const { field } = useChromeBar();
  const inputRef = useRef<HTMLInputElement>(null);
  if (!field) return null;

  return (
    <FieldForm
      inputRef={inputRef}
      label={field.label}
      placeholder={field.placeholder}
      value={field.value}
      status={field.status}
      onChange={field.onChange}
      onSubmit={() => field.onSubmit?.()}
      onClear={() => {
        field.onChange('');
        inputRef.current?.focus();
      }}
    />
  );
}

/**
 * Fallback for routes with no list to narrow — a single record, a lexicon,
 * the explorer landing. Same routing as the header search: handles, DIDs,
 * at:// URIs, and client URLs all resolve to their explorer page.
 */
function JumpField() {
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

  async function submit() {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    try {
      const path = await resolveSearchPathAsync(value);
      if (path) router.push(path);
    } finally {
      resolvingRef.current = false;
    }
  }

  return (
    <FieldForm
      inputRef={inputRef}
      label="Go to a handle, DID, or at:// URI"
      placeholder="Go to handle, DID, at:// URI…"
      value={value}
      onChange={setValue}
      onSubmit={submit}
      onClear={() => {
        setValue('');
        inputRef.current?.focus();
      }}
    />
  );
}

function FieldForm({
  inputRef,
  label,
  placeholder,
  value,
  status,
  onChange,
  onSubmit,
  onClear,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  label: string;
  placeholder: string;
  value: string;
  status?: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
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
      {value && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear"
          title="Clear"
          className="explore-chrome-clear"
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </form>
  );
}

/** Copies the URL of the page you're looking at, query string and all. */
function CopyLinkButton() {
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Drop a stale "Copied" the moment you navigate somewhere else, so the
  // confirmation never reads as applying to the new page.
  useEffect(() => {
    setCopied(false);
  }, [pathname]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const onClick = useCallback(async () => {
    const href = window.location.href;
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      // Restricted clipboard contexts (older Safari, insecure origins) still
      // support the legacy selection-based copy.
      const ta = document.createElement('textarea');
      ta.value = href;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }, []);

  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? 'Copied!' : 'Copy link to this page'}
      aria-label={copied ? 'Page link copied' : 'Copy link to this page'}
      className="explore-chrome-copy"
      data-copied={copied || undefined}
    >
      {copied ? <Check size={13} aria-hidden /> : <Link2 size={13} aria-hidden />}
      <span className="explore-chrome-copy-label">{copied ? 'Copied' : 'Copy link'}</span>
    </button>
  );
}

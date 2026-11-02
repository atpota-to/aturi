'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AppWindow,
  ArrowUp,
  AtSign,
  Bell,
  BookOpen,
  Braces,
  Command,
  Compass,
  Contrast,
  Copy,
  Download,
  FileCode,
  FileText,
  Fingerprint,
  GitFork,
  Github,
  Home,
  Info,
  Keyboard,
  Link2,
  LogIn,
  LogOut,
  Mail,
  MessageSquareHeart,
  Moon,
  Orbit,
  Palette,
  Plug,
  Scale,
  Settings,
  SlidersHorizontal,
  Sun,
  SunMoon,
  Telescope,
  Type,
  User,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { useAtprotoSession } from './AtprotoSessionProvider';
import { encodeRepo } from '@/utils/atproto/urls';
import {
  applyTheme,
  setStoredTheme,
  THEME_STORAGE_KEY,
  type Theme,
} from '@/lib/theme';
import {
  applyFontScale,
  getStoredFontScale,
  isFontScale,
  setStoredFontScale,
  DEFAULT_FONT_SCALE,
  FONT_SCALE_OPTIONS,
  FONT_SCALE_STORAGE_KEY,
  type FontScale,
} from '@/lib/fontScale';
import {
  applyHighContrast,
  applyReduceMotion,
  getHighContrastSnapshot,
  getReduceMotionSnapshot,
  setStoredHighContrast,
  setStoredReduceMotion,
  HIGH_CONTRAST_STORAGE_KEY,
  REDUCE_MOTION_STORAGE_KEY,
} from '@/lib/a11y';
import {
  atUriFor,
  explorePathFor,
  isLinkable,
  pageContextFromPath,
  universalPathFor,
  type PageContext,
} from '@/lib/pageContext';
import {
  COMMANDS,
  DEFAULT_KEYBINDINGS_STATE,
  KEYBINDINGS_STORAGE_KEY,
  effectiveBindings,
  eventToStep,
  getPlatform,
  isDirectlyRunnable,
  normalizeBinding,
  parseBinding,
  readKeybindingsState,
  writeKeybindingsState,
  type CommandId,
  type CommandMeta,
  type CommandWhen,
  type KeybindingsState,
  type PaletteList,
  type Platform,
} from '@/lib/keybindings';
import { OPEN_WHATS_NEW_EVENT } from './whatsnew/WhatsNewBadge';
import CommandPalette from './CommandPalette';
import ShortcutsHelp from './ShortcutsHelp';

/** How long a chord waits for its next key before it gives up (ms). */
const CHORD_TIMEOUT_MS = 1200;

/** The canonical repo; the footer links it too. */
const SOURCE_URL = 'https://github.com/atpota-to/aturi';

const COMMAND_ICONS: Record<CommandId, LucideIcon> = {
  'command-palette': Command,
  'shortcuts-help': Keyboard,
  'whats-new': Bell,
  'toggle-theme': SunMoon,
  'theme-light': Sun,
  'theme-dark': Moon,
  'color-scheme': Palette,
  'text-larger': Type,
  'text-smaller': Type,
  'text-reset': Type,
  'toggle-reduce-motion': Waves,
  'toggle-high-contrast': Contrast,
  'copy-link': Copy,
  'copy-at-uri': AtSign,
  'copy-universal-link': Link2,
  'open-in': AppWindow,
  'open-in-explorer': Telescope,
  'go-up': ArrowUp,
  'view-markdown': FileText,
  'go-home': Home,
  'go-explore': Telescope,
  'go-my-repo': User,
  'go-lexicons': Braces,
  'go-spaces': Orbit,
  'go-links': Compass,
  'go-extension': Download,
  'go-mcp': Plug,
  'go-docs': BookOpen,
  'go-feedback': MessageSquareHeart,
  'go-settings': Settings,
  'go-about': Info,
  'go-contact': Mail,
  'go-terms': Scale,
  'settings-account': User,
  'settings-general': SlidersHorizontal,
  'settings-keyboard': Keyboard,
  'settings-sections': SlidersHorizontal,
  'settings-waypoints': Compass,
  'settings-redirects': Compass,
  'settings-custom': SlidersHorizontal,
  'sign-in': LogIn,
  'sign-out': LogOut,
  'copy-my-did': Fingerprint,
  'copy-mcp-url': Plug,
  'open-llms-txt': FileText,
  'open-openapi': FileCode,
  'go-fork': GitFork,
  'view-source': Github,
};

/**
 * Commands that are a plain trip to a fixed page. Their runner navigates and
 * their `href` lets the palette open them in a new tab on ⌘/Ctrl+Enter.
 */
const STATIC_HREFS: Partial<Record<CommandId, string>> = {
  'go-home': '/',
  'go-explore': '/explore',
  'go-lexicons': '/explore/lexicons',
  'go-spaces': '/explore/spaces',
  'go-links': '/links',
  'go-extension': '/extension',
  'go-mcp': '/mcp',
  'go-docs': '/docs',
  'go-feedback': '/feedback',
  'go-settings': '/account',
  'go-about': '/about',
  'go-contact': '/contact',
  'go-terms': '/terms',
  'go-fork': '/fork',
  'settings-account': '/account#account',
  'settings-general': '/account#general',
  'settings-keyboard': '/account#keyboard',
  'settings-sections': '/account#sections',
  'settings-waypoints': '/account#waypoints',
  'settings-redirects': '/account#redirects',
  'settings-custom': '/account#custom',
  'sign-in': '/account#account',
  'open-llms-txt': '/llms.txt',
  'open-openapi': '/openapi.json',
  'view-source': SOURCE_URL,
};

/**
 * Plain-text documents (route handlers, not pages): opened in a new tab so
 * reading one doesn't drop you out of the app, and loaded by the browser
 * rather than the client router, which only knows how to render pages.
 */
const DOCUMENT_COMMANDS = new Set<CommandId>(['open-llms-txt', 'open-openapi', 'view-markdown']);

/** Whether a command's `when` condition holds on the current page. */
function whenHolds(when: CommandWhen | undefined, ctx: PageContext, signedIn: boolean): boolean {
  switch (when) {
    case undefined:
      return true;
    case 'signed-out':
      return !signedIn;
    case 'repo':
      return ctx.subject !== null;
    case 'linkable':
      return isLinkable(ctx.subject);
    case 'universal':
      return ctx.surface === 'universal' && ctx.subject !== null;
    case 'parent':
      return ctx.parentPath !== null;
    case 'markdown':
      return ctx.markdownPath !== null;
  }
}

/**
 * Clipboard write with the textarea fallback ShareLinkChip uses, for browsers
 * that refuse the async API outside a direct click (a palette Enter counts in
 * most, not all).
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function currentFontScale(): FontScale {
  const attr = document.documentElement.dataset.fontScale;
  return isFontScale(attr) ? attr : getStoredFontScale();
}

/**
 * Same-tab `storage` events don't fire, so the settings toggles that read
 * these values through useSyncExternalStore get nudged by hand — the same
 * thing the settings pickers do after a change.
 */
function nudgeStorage(key: string, newValue: string) {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
}

/** A catalog command with its runtime binding, icon, availability, action. */
export type ResolvedCommand = {
  meta: CommandMeta;
  icon: LucideIcon;
  /** Bindings in effect right now (override or defaults). */
  bindings: string[];
  /**
   * False when the command can't run here: auth-gated while signed out, or
   * its `when` page condition doesn't hold.
   */
  available: boolean;
  /**
   * Where the command goes, when it goes somewhere. Lets the palette open it
   * in a new tab (⌘/Ctrl+Enter) instead of running it.
   */
  href?: string;
  /** `href` leaves aturi.to. */
  external?: boolean;
  run: () => void;
};

type KeyboardShortcutsValue = {
  state: KeybindingsState;
  platform: Platform;
  commands: ResolvedCommand[];
  /** What the current page is about, for page-aware commands. */
  pageContext: PageContext;
  paletteOpen: boolean;
  helpOpen: boolean;
  /** Opens the palette, optionally straight onto one of its lists. */
  openPalette: (list?: PaletteList) => void;
  closePalette: () => void;
  openHelp: () => void;
  closeHelp: () => void;
  setBinding: (id: CommandId, binding: string) => void;
  unbind: (id: CommandId) => void;
  resetBinding: (id: CommandId) => void;
  resetAll: () => void;
  setEnabled: (v: boolean) => void;
  setChords: (v: boolean) => void;
  /** Settings pauses the global listener while capturing a new binding. */
  setCaptureActive: (v: boolean) => void;
  announce: (message: string) => void;
};

const Ctx = createContext<KeyboardShortcutsValue | null>(null);

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute('role');
  return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}

function arrEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Global keyboard-shortcut engine. Owns the browser-local keybinding state,
 * runs the single window-level keydown listener (with chord buffering), and
 * renders the command palette, the shortcuts help sheet, and a small live
 * announcer for hotkey feedback.
 *
 * Mounted once in the root layout, inside the session + preferences providers
 * so commands can navigate and read the signed-in DID.
 */
export function KeyboardShortcutsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { did, signOut } = useAtprotoSession();
  const pageContext = useMemo(() => pageContextFromPath(pathname), [pathname]);

  const [state, setState] = useState<KeybindingsState>(DEFAULT_KEYBINDINGS_STATE);
  const [platform, setPlatform] = useState<Platform>('other');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteList, setPaletteList] = useState<PaletteList | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate browser-local state + platform after mount (SSR renders defaults).
  // Deferred a tick so the state updates land outside the synchronous effect
  // body — the shortcuts are on-by-default, so nothing observable waits on it.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setState(readKeybindingsState());
      setPlatform(getPlatform());
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // Cross-tab sync: mirror edits made in another tab.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === KEYBINDINGS_STORAGE_KEY) setState(readKeybindingsState());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const announce = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const openPalette = useCallback((list?: PaletteList) => {
    setHelpOpen(false);
    setPaletteList(list ?? null);
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openHelp = useCallback(() => {
    setPaletteOpen(false);
    setHelpOpen(true);
  }, []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  // --- state mutators (write-through to localStorage) ----------------------
  const setBinding = useCallback((id: CommandId, binding: string) => {
    setState((prev) => {
      const next: KeybindingsState = {
        ...prev,
        overrides: { ...prev.overrides, [id]: normalizeBinding(binding) },
      };
      writeKeybindingsState(next);
      return next;
    });
  }, []);
  const unbind = useCallback((id: CommandId) => {
    setState((prev) => {
      const next: KeybindingsState = {
        ...prev,
        overrides: { ...prev.overrides, [id]: '' },
      };
      writeKeybindingsState(next);
      return next;
    });
  }, []);
  const resetBinding = useCallback((id: CommandId) => {
    setState((prev) => {
      const overrides = { ...prev.overrides };
      delete overrides[id];
      const next: KeybindingsState = { ...prev, overrides };
      writeKeybindingsState(next);
      return next;
    });
  }, []);
  const resetAll = useCallback(() => {
    setState((prev) => {
      const next: KeybindingsState = { ...prev, overrides: {} };
      writeKeybindingsState(next);
      return next;
    });
  }, []);
  const setEnabled = useCallback((v: boolean) => {
    setState((prev) => {
      const next = { ...prev, enabled: v };
      writeKeybindingsState(next);
      return next;
    });
  }, []);
  const setChords = useCallback((v: boolean) => {
    setState((prev) => {
      const next = { ...prev, chords: v };
      writeKeybindingsState(next);
      return next;
    });
  }, []);

  // Settings toggles this off/on around live key capture so the global
  // listener doesn't swallow the keys being recorded. A ref (not state) —
  // the listener reads it synchronously and it drives no rendering.
  const captureActiveRef = useRef(false);
  const setCaptureActive = useCallback((v: boolean) => {
    captureActiveRef.current = v;
  }, []);

  const copyText = useCallback(
    async (text: string, done: string) => {
      announce((await writeClipboard(text)) ? done : 'Couldn’t copy to the clipboard');
    },
    [announce],
  );

  /**
   * Navigate anywhere a command or palette row points. Off-site links open in
   * a new tab. A settings tab on the settings page is a hash change, which
   * the client router would apply silently; assigning `location.hash` fires
   * the `hashchange` SettingsShell listens for, so the tab actually switches.
   */
  const go = useCallback(
    (href: string, opts?: { newTab?: boolean; document?: boolean }) => {
      const url = new URL(href, window.location.origin);
      if (opts?.newTab || url.origin !== window.location.origin) {
        window.open(url.href, '_blank', 'noopener,noreferrer');
        return;
      }
      if (opts?.document) {
        window.location.assign(url.href);
        return;
      }
      if (url.hash && url.pathname === window.location.pathname) {
        window.location.hash = url.hash;
        return;
      }
      router.push(url.pathname + url.search + url.hash);
    },
    [router],
  );

  const setTheme = useCallback((next: Theme) => {
    setStoredTheme(next);
    applyTheme(next);
    // Same-tab storage events don't fire; nudge subscribers (ThemeToggle etc).
    window.dispatchEvent(
      new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: next }),
    );
  }, []);

  const stepFontScale = useCallback(
    (delta: -1 | 0 | 1) => {
      const order = FONT_SCALE_OPTIONS.map((o) => o.value);
      const at = order.indexOf(currentFontScale());
      const next =
        delta === 0
          ? DEFAULT_FONT_SCALE
          : order[Math.max(0, Math.min(order.length - 1, at + delta))];
      setStoredFontScale(next);
      applyFontScale(next);
      nudgeStorage(FONT_SCALE_STORAGE_KEY, next);
      const label = FONT_SCALE_OPTIONS.find((o) => o.value === next)?.label ?? next;
      announce(
        delta !== 0 && next === order[at] ? `Text size is already ${label}` : `Text size: ${label}`,
      );
    },
    [announce],
  );

  const commands = useMemo<ResolvedCommand[]>(() => {
    const { subject, parentPath, markdownPath } = pageContext;
    const universal = subject ? universalPathFor(subject) : null;

    // Context-dependent destinations. Each is only reachable while its
    // command is available, which is exactly when the value is set.
    const hrefs: Partial<Record<CommandId, string>> = {
      ...STATIC_HREFS,
      ...(did ? { 'go-my-repo': `/explore/${encodeRepo(did)}` } : {}),
      ...(parentPath ? { 'go-up': parentPath } : {}),
      ...(subject ? { 'open-in-explorer': explorePathFor(subject) } : {}),
      ...(markdownPath ? { 'view-markdown': markdownPath } : {}),
    };
    const navigate = (id: CommandId) => () => {
      const href = hrefs[id];
      if (!href) return;
      go(href, DOCUMENT_COMMANDS.has(id) ? { newTab: true } : undefined);
    };

    const runners: Record<CommandId, () => void> = {
      'command-palette': () => openPalette(),
      'shortcuts-help': () => openHelp(),
      'whats-new': () => {
        // The header bell owns the notes. A cancelable event lets it say it
        // handled the request; on a page without one, say so instead.
        const unhandled = window.dispatchEvent(
          new CustomEvent(OPEN_WHATS_NEW_EVENT, { cancelable: true }),
        );
        if (unhandled) announce('What’s new isn’t available on this page');
      },
      'toggle-theme': () => {
        const current: Theme =
          document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
        const next: Theme = current === 'dark' ? 'light' : 'dark';
        setTheme(next);
        announce(`Switched to ${next} theme`);
      },
      'theme-light': () => {
        setTheme('light');
        announce('Switched to light theme');
      },
      'theme-dark': () => {
        setTheme('dark');
        announce('Switched to dark theme');
      },
      'color-scheme': () => openPalette('color-scheme'),
      'text-larger': () => stepFontScale(1),
      'text-smaller': () => stepFontScale(-1),
      'text-reset': () => stepFontScale(0),
      'toggle-reduce-motion': () => {
        const next = !getReduceMotionSnapshot();
        setStoredReduceMotion(next);
        applyReduceMotion(next);
        nudgeStorage(REDUCE_MOTION_STORAGE_KEY, next ? 'true' : 'false');
        announce(next ? 'Reduce motion on' : 'Reduce motion off');
      },
      'toggle-high-contrast': () => {
        const next = !getHighContrastSnapshot();
        setStoredHighContrast(next);
        applyHighContrast(next);
        nudgeStorage(HIGH_CONTRAST_STORAGE_KEY, next ? 'true' : 'false');
        announce(next ? 'High contrast on' : 'High contrast off');
      },
      'copy-link': () => {
        void copyText(window.location.href, 'Page link copied');
      },
      'copy-at-uri': () => {
        if (subject) void copyText(atUriFor(subject), 'at:// URI copied');
      },
      'copy-universal-link': () => {
        if (universal) {
          void copyText(`${window.location.origin}${universal}`, 'Universal link copied');
        }
      },
      'open-in': () => openPalette('open-in'),
      'open-in-explorer': navigate('open-in-explorer'),
      'go-up': navigate('go-up'),
      'view-markdown': navigate('view-markdown'),
      'go-home': navigate('go-home'),
      'go-explore': navigate('go-explore'),
      'go-my-repo': navigate('go-my-repo'),
      'go-lexicons': navigate('go-lexicons'),
      'go-spaces': navigate('go-spaces'),
      'go-links': navigate('go-links'),
      'go-extension': navigate('go-extension'),
      'go-mcp': navigate('go-mcp'),
      'go-docs': navigate('go-docs'),
      'go-feedback': navigate('go-feedback'),
      'go-settings': navigate('go-settings'),
      'go-about': navigate('go-about'),
      'go-contact': navigate('go-contact'),
      'go-terms': navigate('go-terms'),
      'settings-account': navigate('settings-account'),
      'settings-general': navigate('settings-general'),
      'settings-keyboard': navigate('settings-keyboard'),
      'settings-sections': navigate('settings-sections'),
      'settings-waypoints': navigate('settings-waypoints'),
      'settings-redirects': navigate('settings-redirects'),
      'settings-custom': navigate('settings-custom'),
      'sign-in': navigate('sign-in'),
      'sign-out': () => {
        void signOut().then(
          () => announce('Signed out'),
          () => announce('Couldn’t sign out'),
        );
      },
      'copy-my-did': () => {
        if (did) void copyText(did, 'DID copied');
      },
      'copy-mcp-url': () => {
        void copyText(`${window.location.origin}/api/mcp`, 'MCP server URL copied');
      },
      'open-llms-txt': navigate('open-llms-txt'),
      'open-openapi': navigate('open-openapi'),
      'go-fork': navigate('go-fork'),
      'view-source': navigate('view-source'),
    };
    return COMMANDS.map((meta) => {
      const href = hrefs[meta.id];
      return {
        meta,
        icon: COMMAND_ICONS[meta.id],
        bindings: effectiveBindings(state, meta.id),
        available:
          (meta.requiresAuth ? Boolean(did) : true) &&
          whenHolds(meta.when, pageContext, Boolean(did)),
        href,
        external: href ? /^https?:/i.test(href) : undefined,
        run: runners[meta.id],
      };
    });
  }, [
    state,
    did,
    pageContext,
    go,
    openPalette,
    openHelp,
    setTheme,
    stepFontScale,
    copyText,
    signOut,
    announce,
  ]);

  // Live snapshot for the window listener so it never needs re-subscribing.
  // Updated in a post-render effect (not during render) so the ref write
  // doesn't race the commit.
  const liveRef = useRef({ state, commands, paletteOpen, helpOpen });
  useEffect(() => {
    liveRef.current = { state, commands, paletteOpen, helpOpen };
  });

  // The single global keydown listener. Subscribed once; reads everything it
  // needs from refs.
  useEffect(() => {
    const platformNow = getPlatform();
    let buffer: string[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    function clearBuffer() {
      buffer = [];
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function fire(id: CommandId) {
      const cmd = liveRef.current.commands.find((c) => c.meta.id === id);
      // Never let a keystroke run a destructive command directly — those must
      // go through their own on-screen confirmation, not a hotkey.
      if (cmd && cmd.available && isDirectlyRunnable(cmd.meta)) cmd.run();
    }

    function onKeyDown(e: KeyboardEvent) {
      const live = liveRef.current;
      if (!live.state.enabled) return;
      if (captureActiveRef.current) return; // settings is recording a binding
      if (live.paletteOpen || live.helpOpen) return; // a modal owns the keyboard
      // Same for any other modal <dialog> (the image lightbox): while one is
      // up it owns the keyboard, so `g h` shouldn't navigate out from under it.
      if (document.querySelector('dialog[open]')) return;
      if (e.defaultPrevented) return;

      const step = eventToStep(e, platformNow);
      if (!step) return;

      const editable = isEditableTarget(e.target);
      const hasAccel = e.metaKey || e.ctrlKey || e.altKey;
      // While typing in a field, only accelerator-led shortcuts (⌘K etc.) run;
      // bare letters and chords must not steal the keystroke.
      if (editable && !hasAccel) {
        clearBuffer();
        return;
      }

      // Build the currently-active (command, steps) entries.
      const entries: { id: CommandId; steps: string[] }[] = [];
      for (const cmd of live.commands) {
        if (!cmd.available) continue;
        if (!isDirectlyRunnable(cmd.meta)) continue; // destructive: no hotkey path
        for (const binding of cmd.bindings) {
          const steps = parseBinding(binding);
          if (steps.length === 0) continue;
          if (!live.state.chords && steps.length > 1) continue;
          entries.push({ id: cmd.meta.id, steps });
        }
      }

      const findFull = (buf: string[]) => entries.filter((en) => arrEq(en.steps, buf));
      const findPrefix = (buf: string[]) =>
        entries.filter(
          (en) => en.steps.length > buf.length && arrEq(en.steps.slice(0, buf.length), buf),
        );

      let next = [...buffer, step];
      let full = findFull(next);
      let prefix = findPrefix(next);

      // If extending the buffer leads nowhere, restart from this key alone.
      if (full.length === 0 && prefix.length === 0) {
        next = [step];
        full = findFull(next);
        prefix = findPrefix(next);
      }

      // Nothing matches — let the key through untouched.
      if (full.length === 0 && prefix.length === 0) {
        clearBuffer();
        return;
      }

      e.preventDefault();

      if (prefix.length > 0) {
        // A longer chord is still possible; wait for the next key. On timeout,
        // settle for a full match at the current depth if one exists.
        buffer = next;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const settle = findFull(buffer);
          clearBuffer();
          if (settle.length > 0) fire(settle[0].id);
        }, CHORD_TIMEOUT_MS);
        return;
      }

      // Unambiguous full match.
      clearBuffer();
      fire(full[0].id);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const value = useMemo<KeyboardShortcutsValue>(
    () => ({
      state,
      platform,
      commands,
      pageContext,
      paletteOpen,
      helpOpen,
      openPalette,
      closePalette,
      openHelp,
      closeHelp,
      setBinding,
      unbind,
      resetBinding,
      resetAll,
      setEnabled,
      setChords,
      setCaptureActive,
      announce,
    }),
    [
      state,
      platform,
      commands,
      pageContext,
      paletteOpen,
      helpOpen,
      openPalette,
      closePalette,
      openHelp,
      closeHelp,
      setBinding,
      unbind,
      resetBinding,
      resetAll,
      setEnabled,
      setChords,
      setCaptureActive,
      announce,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <CommandPalette
        open={paletteOpen}
        initialList={paletteList}
        onClose={closePalette}
        commands={commands}
        platform={platform}
        pageContext={pageContext}
        onNavigate={go}
        onOpenHelp={openHelp}
      />
      <ShortcutsHelp
        open={helpOpen}
        onClose={closeHelp}
        commands={commands}
        platform={platform}
      />
      {/* Live region for hotkey feedback (copy, theme). Visually a transient
          pill; always present in the DOM so screen readers announce it. */}
      <div className="kbd-live-region" role="status" aria-live="polite">
        {toast}
      </div>
      {toast && (
        <div className="kbd-toast" aria-hidden="true">
          {toast}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useKeyboardShortcuts(): KeyboardShortcutsValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      'useKeyboardShortcuts must be used inside <KeyboardShortcutsProvider>',
    );
  }
  return v;
}

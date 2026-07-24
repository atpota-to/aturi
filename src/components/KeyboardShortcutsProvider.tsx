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
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  Command,
  Compass,
  Copy,
  Download,
  Home,
  Keyboard,
  Settings,
  SunMoon,
  Telescope,
  User,
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
  type KeybindingsState,
  type Platform,
} from '@/lib/keybindings';
import CommandPalette from './CommandPalette';
import ShortcutsHelp from './ShortcutsHelp';

/** How long a chord waits for its next key before it gives up (ms). */
const CHORD_TIMEOUT_MS = 1200;

const COMMAND_ICONS: Record<CommandId, LucideIcon> = {
  'command-palette': Command,
  'shortcuts-help': Keyboard,
  'toggle-theme': SunMoon,
  'copy-link': Copy,
  'go-home': Home,
  'go-explore': Telescope,
  'go-my-repo': User,
  'go-links': Compass,
  'go-extension': Download,
  'go-docs': BookOpen,
  'go-settings': Settings,
};

/** A catalog command with its runtime binding, icon, availability, action. */
export type ResolvedCommand = {
  meta: CommandMeta;
  icon: LucideIcon;
  /** Bindings in effect right now (override or defaults). */
  bindings: string[];
  /** False for auth-gated commands when signed out. */
  available: boolean;
  run: () => void;
};

type KeyboardShortcutsValue = {
  state: KeybindingsState;
  platform: Platform;
  commands: ResolvedCommand[];
  paletteOpen: boolean;
  helpOpen: boolean;
  openPalette: () => void;
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
  const { did } = useAtprotoSession();

  const [state, setState] = useState<KeybindingsState>(DEFAULT_KEYBINDINGS_STATE);
  const [platform, setPlatform] = useState<Platform>('other');
  const [paletteOpen, setPaletteOpen] = useState(false);
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

  const openPalette = useCallback(() => {
    setHelpOpen(false);
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

  const toggleTheme = useCallback((): Theme => {
    const current: Theme =
      document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const next: Theme = current === 'dark' ? 'light' : 'dark';
    setStoredTheme(next);
    applyTheme(next);
    // Same-tab storage events don't fire; nudge subscribers (ThemeToggle etc).
    window.dispatchEvent(
      new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: next }),
    );
    return next;
  }, []);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      announce('Page link copied');
    } catch {
      announce('Couldn’t copy link');
    }
  }, [announce]);

  const commands = useMemo<ResolvedCommand[]>(() => {
    const runners: Record<CommandId, () => void> = {
      'command-palette': () => openPalette(),
      'shortcuts-help': () => openHelp(),
      'toggle-theme': () => {
        const next = toggleTheme();
        announce(`Switched to ${next} theme`);
      },
      'copy-link': () => {
        void copyLink();
      },
      'go-home': () => router.push('/'),
      'go-explore': () => router.push('/explore'),
      'go-my-repo': () => {
        if (did) router.push(`/explore/${encodeRepo(did)}`);
      },
      'go-links': () => router.push('/links'),
      'go-extension': () => router.push('/extension'),
      'go-docs': () => router.push('/docs'),
      'go-settings': () => router.push('/account'),
    };
    return COMMANDS.map((meta) => ({
      meta,
      icon: COMMAND_ICONS[meta.id],
      bindings: effectiveBindings(state, meta.id),
      available: meta.requiresAuth ? Boolean(did) : true,
      run: runners[meta.id],
    }));
  }, [state, did, router, openPalette, openHelp, toggleTheme, copyLink, announce]);

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
        onClose={closePalette}
        commands={commands}
        platform={platform}
        onNavigate={(path) => router.push(path)}
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

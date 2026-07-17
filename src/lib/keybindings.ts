/**
 * Keyboard shortcut engine + command catalog.
 *
 * Desktop keyboard shortcuts are browser-local (like theme / font-scale /
 * a11y), not synced to the PDS: a binding that feels right on one keyboard
 * layout may collide on another, so the customization lives per-device in
 * localStorage under `aturi.keybindings.v1`.
 *
 * A *binding* is a normalized string:
 *
 *   - A single step:  `mod+k`, `mod+shift+c`, `?`, `/`, `t`
 *   - A chord (sequence of steps, GitHub/Linear style):  `g h`, `g e`
 *
 * `mod` is the platform-primary accelerator — ⌘ on macOS, Ctrl elsewhere —
 * so one default works cross-platform. Modifiers are always emitted in the
 * canonical order `mod ctrl meta alt shift` so a binding produced from a live
 * KeyboardEvent string-compares equal to a stored one.
 *
 * This module is pure (no React, no lucide) so the command catalog and the
 * matching logic stay unit-testable and SSR-safe; the runtime wiring (actions,
 * icons, the global listener) lives in KeyboardShortcutsProvider.
 */

export const KEYBINDINGS_STORAGE_KEY = 'aturi.keybindings.v1';

export type Platform = 'mac' | 'other';

/** Every command the shortcut engine and command palette know about. */
export type CommandId =
  | 'command-palette'
  | 'shortcuts-help'
  | 'toggle-theme'
  | 'copy-link'
  | 'go-home'
  | 'go-explore'
  | 'go-links'
  | 'go-docs'
  | 'go-extension'
  | 'go-settings'
  | 'go-my-repo';

export type CommandGroup = 'general' | 'navigation' | 'page';

export type CommandMeta = {
  id: CommandId;
  /** Human label, shown in the palette, help sheet, and settings. */
  label: string;
  /** One-line description for the settings row and palette subtitle. */
  description: string;
  group: CommandGroup;
  /**
   * Zero or more default bindings. All of them fire out of the box; a user
   * override (see `KeybindingsState.overrides`) replaces the whole set with a
   * single binding, or the empty string to unbind entirely.
   */
  defaultBindings: string[];
  /** Extra terms the palette fuzzy-search matches against. */
  keywords?: string[];
  /** Command only does something for a signed-in user (e.g. "my repo"). */
  requiresAuth?: boolean;
};

export const COMMAND_GROUPS: { id: CommandGroup; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'page', label: 'Current page' },
];

/**
 * The command catalog. Ordering here is the display order within each group
 * and the tie-break order when two commands share a binding (first wins).
 */
export const COMMANDS: CommandMeta[] = [
  {
    id: 'command-palette',
    label: 'Command palette',
    description: 'Search commands and jump anywhere.',
    group: 'general',
    defaultBindings: ['mod+k', '/'],
    keywords: ['search', 'command', 'palette', 'jump', 'goto', 'find'],
  },
  {
    id: 'shortcuts-help',
    label: 'Keyboard shortcuts',
    description: 'Show this list of shortcuts.',
    group: 'general',
    defaultBindings: ['?'],
    keywords: ['help', 'keys', 'cheat sheet', 'shortcuts'],
  },
  {
    id: 'toggle-theme',
    label: 'Toggle theme',
    description: 'Switch between dark and light.',
    group: 'general',
    defaultBindings: ['t'],
    keywords: ['dark', 'light', 'appearance', 'theme', 'mode'],
  },
  {
    id: 'go-home',
    label: 'Go to home',
    description: 'The aturi.to landing page.',
    group: 'navigation',
    defaultBindings: ['g h'],
    keywords: ['home', 'landing', 'start'],
  },
  {
    id: 'go-explore',
    label: 'Go to explorer',
    description: 'Browse any repo, collection, or record.',
    group: 'navigation',
    defaultBindings: ['g e'],
    keywords: ['explore', 'explorer', 'browse', 'repo', 'pds'],
  },
  {
    id: 'go-my-repo',
    label: 'Go to my repo',
    description: 'Open your own repo in the explorer.',
    group: 'navigation',
    defaultBindings: ['g m'],
    keywords: ['my', 'repo', 'mine', 'me', 'account data'],
    requiresAuth: true,
  },
  {
    id: 'go-links',
    label: 'Go to universal links',
    description: 'The at:// universal link tools.',
    group: 'navigation',
    defaultBindings: ['g l'],
    keywords: ['links', 'universal', 'share'],
  },
  {
    id: 'go-extension',
    label: 'Go to browser extension',
    description: 'Install the client-switcher extension.',
    group: 'navigation',
    defaultBindings: ['g x'],
    keywords: ['extension', 'browser', 'install', 'download'],
  },
  {
    id: 'go-docs',
    label: 'Go to docs',
    description: 'Read the documentation.',
    group: 'navigation',
    defaultBindings: ['g d'],
    keywords: ['docs', 'documentation', 'help', 'guide'],
  },
  {
    id: 'go-settings',
    label: 'Go to settings',
    description: 'Your account and preferences.',
    group: 'navigation',
    defaultBindings: ['g s'],
    keywords: ['settings', 'preferences', 'account', 'config'],
  },
  {
    id: 'copy-link',
    // Unbound by default: the obvious "copy" combo (⌘/Ctrl+Shift+C) is the
    // browser's own inspect-element shortcut, which we can't reliably
    // preventDefault. It stays in the palette and is fully bindable here — a
    // good showcase for the customization the settings tab offers.
    label: 'Copy page link',
    description: 'Copy the current page URL to the clipboard.',
    group: 'page',
    defaultBindings: [],
    keywords: ['copy', 'link', 'url', 'share', 'clipboard'],
  },
];

export const COMMANDS_BY_ID: Record<CommandId, CommandMeta> = COMMANDS.reduce(
  (acc, c) => {
    acc[c.id] = c;
    return acc;
  },
  {} as Record<CommandId, CommandMeta>,
);

// --- Persisted state -------------------------------------------------------

export type KeybindingsState = {
  /** Master switch. When off, no global shortcut fires. */
  enabled: boolean;
  /** Allow multi-step navigation chords (`g` then a letter). */
  chords: boolean;
  /**
   * Per-command overrides. A present key replaces that command's default
   * bindings with a single binding; the empty string means "unbound".
   * Absent means "use the defaults".
   */
  overrides: Partial<Record<CommandId, string>>;
};

export const DEFAULT_KEYBINDINGS_STATE: KeybindingsState = {
  enabled: true,
  chords: true,
  overrides: {},
};

function isCommandId(value: string): value is CommandId {
  return Object.prototype.hasOwnProperty.call(COMMANDS_BY_ID, value);
}

/** Coerce an untrusted parsed blob into a valid state, dropping junk. */
export function mergeKeybindingsState(
  input: Partial<KeybindingsState> | null | undefined,
): KeybindingsState {
  if (!input || typeof input !== 'object') return { ...DEFAULT_KEYBINDINGS_STATE };
  const overrides: Partial<Record<CommandId, string>> = {};
  if (input.overrides && typeof input.overrides === 'object') {
    for (const [id, binding] of Object.entries(input.overrides)) {
      if (isCommandId(id) && typeof binding === 'string') {
        overrides[id] = normalizeBinding(binding);
      }
    }
  }
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
    chords: typeof input.chords === 'boolean' ? input.chords : true,
    overrides,
  };
}

export function readKeybindingsState(): KeybindingsState {
  if (typeof window === 'undefined') return { ...DEFAULT_KEYBINDINGS_STATE };
  try {
    const raw = window.localStorage.getItem(KEYBINDINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_KEYBINDINGS_STATE };
    return mergeKeybindingsState(JSON.parse(raw) as Partial<KeybindingsState>);
  } catch {
    return { ...DEFAULT_KEYBINDINGS_STATE };
  }
}

export function writeKeybindingsState(state: KeybindingsState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or storage disabled — non-fatal.
  }
}

/**
 * The bindings actually in effect for a command: the override (as a
 * one-element list, or empty when unbound) when present, else the defaults.
 */
export function effectiveBindings(state: KeybindingsState, id: CommandId): string[] {
  const override = state.overrides[id];
  if (override === undefined) return COMMANDS_BY_ID[id]?.defaultBindings ?? [];
  return override === '' ? [] : [override];
}

// --- Platform --------------------------------------------------------------

export function getPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  // `userAgentData.platform` is the modern signal; fall back to the legacy
  // `platform` string. Any Apple desktop/laptop maps to the ⌘ accelerator.
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const raw =
    nav.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(raw) ? 'mac' : 'other';
}

// --- Event → step ----------------------------------------------------------

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

/**
 * The base key for an event, plus whether its shift is "implied" (already
 * baked into a printable symbol like `?`, so we must not also emit `shift`).
 * Returns null for a bare modifier press.
 */
function baseKeyFromEvent(e: KeyboardEvent): { key: string; impliedShift: boolean } | null {
  const k = e.key;
  if (!k || MODIFIER_KEYS.has(k)) return null;
  if (k === ' ' || k === 'Spacebar') return { key: 'space', impliedShift: false };
  if (k.length === 1) {
    // Printable character. Letters normalize to lowercase and let `shift` ride
    // as a real modifier (so `mod+shift+c` round-trips); symbols keep the
    // typed glyph, which already reflects the shift state (`?`, `<`, `:`).
    if (/[a-zA-Z]/.test(k)) return { key: k.toLowerCase(), impliedShift: false };
    return { key: k, impliedShift: true };
  }
  return { key: k.toLowerCase(), impliedShift: false };
}

/**
 * Normalize a live KeyboardEvent into a canonical single-step string, or null
 * when it can't be a shortcut (bare modifier / dead key / IME composition).
 */
export function eventToStep(e: KeyboardEvent, platform: Platform): string | null {
  if (e.isComposing || e.keyCode === 229) return null;
  const base = baseKeyFromEvent(e);
  if (!base) return null;

  const mods: string[] = [];
  const primary = platform === 'mac' ? e.metaKey : e.ctrlKey;
  if (primary) mods.push('mod');
  // The non-primary accelerator is rare but valid (Ctrl on mac, ⊞ elsewhere).
  if (platform === 'mac' && e.ctrlKey) mods.push('ctrl');
  if (platform !== 'mac' && e.metaKey) mods.push('meta');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey && !base.impliedShift) mods.push('shift');

  return [...mods, base.key].join('+');
}

// --- Binding parse / normalize ---------------------------------------------

const MOD_ORDER = ['mod', 'ctrl', 'meta', 'alt', 'shift'];

/** Canonicalize a single step string (sort modifiers, lowercase letters). */
function normalizeStep(step: string): string {
  const parts = step.trim().split('+').filter(Boolean);
  if (parts.length === 0) return '';
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
  const ordered = MOD_ORDER.filter((m) => mods.includes(m));
  // A single-letter key normalizes to lowercase; everything else is kept.
  const normKey = key.length === 1 && /[a-zA-Z]/.test(key) ? key.toLowerCase() : key;
  return [...ordered, normKey].join('+');
}

/** Split a binding into its ordered list of canonical step strings. */
export function parseBinding(binding: string): string[] {
  return binding
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeStep)
    .filter(Boolean);
}

/** Canonical string form of a binding (idempotent). */
export function normalizeBinding(binding: string): string {
  return parseBinding(binding).join(' ');
}

/** Whether a binding is a single step (no chord). */
export function isSingleStep(binding: string): boolean {
  return parseBinding(binding).length === 1;
}

// --- Display ---------------------------------------------------------------

const MOD_DISPLAY: Record<string, Record<Platform, string>> = {
  mod: { mac: '⌘', other: 'Ctrl' },
  ctrl: { mac: '⌃', other: 'Ctrl' },
  meta: { mac: '⌘', other: 'Win' },
  alt: { mac: '⌥', other: 'Alt' },
  shift: { mac: '⇧', other: 'Shift' },
};

const KEY_DISPLAY: Record<string, string> = {
  space: 'Space',
  enter: 'Enter',
  escape: 'Esc',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  backspace: '⌫',
  delete: 'Del',
  tab: 'Tab',
};

/** Human tokens for one step, e.g. `mod+shift+c` → ['⌘','⇧','C']. */
export function stepTokens(step: string, platform: Platform): string[] {
  const parts = parseBinding(step)[0]?.split('+') ?? [];
  if (parts.length === 0) return [];
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const modTokens = mods.map((m) => MOD_DISPLAY[m]?.[platform] ?? m);
  const keyToken =
    KEY_DISPLAY[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return [...modTokens, keyToken];
}

/** Human tokens for a whole binding: one token array per step. */
export function bindingTokens(binding: string, platform: Platform): string[][] {
  return parseBinding(binding).map((step) => stepTokens(step, platform));
}

// --- Conflicts -------------------------------------------------------------

/**
 * Map of binding-string → command ids that currently claim it. A command is
 * in conflict when its binding appears against more than one id. Only the
 * first command in catalog order actually fires (see the provider's matcher),
 * so surfacing the collision lets the user resolve it deliberately.
 */
export function bindingConflicts(state: KeybindingsState): Map<string, CommandId[]> {
  const byBinding = new Map<string, CommandId[]>();
  for (const cmd of COMMANDS) {
    for (const binding of effectiveBindings(state, cmd.id)) {
      const list = byBinding.get(binding) ?? [];
      list.push(cmd.id);
      byBinding.set(binding, list);
    }
  }
  const conflicts = new Map<string, CommandId[]>();
  for (const [binding, ids] of byBinding) {
    if (ids.length > 1) conflicts.set(binding, ids);
  }
  return conflicts;
}

/** Command ids (other than `self`) whose bindings collide with `binding`. */
export function conflictingCommands(
  state: KeybindingsState,
  self: CommandId,
  binding: string,
): CommandId[] {
  const normalized = normalizeBinding(binding);
  if (!normalized) return [];
  const hits: CommandId[] = [];
  for (const cmd of COMMANDS) {
    if (cmd.id === self) continue;
    if (effectiveBindings(state, cmd.id).includes(normalized)) hits.push(cmd.id);
  }
  return hits;
}

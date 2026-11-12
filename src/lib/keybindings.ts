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
  | 'whats-new'
  | 'toggle-theme'
  | 'theme-light'
  | 'theme-dark'
  | 'color-scheme'
  | 'text-larger'
  | 'text-smaller'
  | 'text-reset'
  | 'toggle-reduce-motion'
  | 'toggle-high-contrast'
  | 'copy-link'
  | 'copy-at-uri'
  | 'copy-universal-link'
  | 'open-in'
  | 'open-in-explorer'
  | 'go-up'
  | 'view-markdown'
  | 'go-home'
  | 'go-explore'
  | 'go-my-repo'
  | 'go-lexicons'
  | 'go-spaces'
  | 'go-tools'
  | 'go-links'
  | 'go-extension'
  | 'go-mcp'
  | 'go-docs'
  | 'go-feedback'
  | 'go-settings'
  | 'go-about'
  | 'go-contact'
  | 'go-terms'
  | 'settings-account'
  | 'settings-general'
  | 'settings-keyboard'
  | 'settings-sections'
  | 'settings-waypoints'
  | 'settings-redirects'
  | 'settings-custom'
  | 'sign-in'
  | 'sign-out'
  | 'copy-my-did'
  | 'copy-mcp-url'
  | 'open-llms-txt'
  | 'open-openapi'
  | 'go-fork'
  | 'view-source';

export type CommandGroup =
  | 'general'
  | 'page'
  | 'navigation'
  | 'appearance'
  | 'settings'
  | 'account'
  | 'developer';

/**
 * Where a command makes sense. The provider derives the current page's context
 * from its pathname (see `pageContext.ts`) and hides a command whose condition
 * doesn't hold, both from the palette and from the keydown engine.
 *
 *   - `signed-out`: only while nobody is signed in (sign in).
 *   - `repo`:       the page addresses a repo, collection or record.
 *   - `linkable`:   the page addresses a profile or record, the two shapes a
 *                   universal link and the waypoints can open.
 *   - `universal`:  the page is a universal link (the waypoint picker).
 *   - `parent`:     the page sits below another explorer page.
 *   - `markdown`:   the page has a Markdown twin (`markdownVariants.ts`).
 */
export type CommandWhen =
  | 'signed-out'
  | 'repo'
  | 'linkable'
  | 'universal'
  | 'parent'
  | 'markdown';

/** A list the palette can drill into, in place of its command list. */
export type PaletteList = 'open-in' | 'color-scheme';

/**
 * How the settings tab describes where a `when`-gated command can run, so a
 * binding that does nothing on the settings page itself isn't a mystery.
 */
export const WHEN_LABELS: Record<CommandWhen, string> = {
  'signed-out': 'when signed out',
  repo: 'on explorer pages',
  linkable: 'on profile and record pages',
  universal: 'on universal link pages',
  parent: 'inside the explorer',
  markdown: 'on pages with a Markdown version',
};

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
  /** Page context the command needs; absent means "anywhere". */
  when?: CommandWhen;
  /**
   * The command opens a list inside the palette instead of acting at once
   * ("Open in…", "Color scheme…"). Bound to a key, it opens the palette
   * straight onto that list.
   */
  opensList?: PaletteList;
  /**
   * Marks an irreversible / data-mutating action (e.g. deleting a record).
   * INVARIANT: a shortcut must never destroy data on a single keystroke. The
   * keydown engine refuses to fire a destructive command directly (see
   * `isDirectlyRunnable`), and the palette runs it as a *request* only — the
   * action itself must still surface the app's on-screen "…this cannot be
   * undone" confirmation before anything is deleted. No built-in command is
   * destructive today; this exists so that if one is ever added, the
   * "confirm on screen" guarantee is enforced by construction, not convention.
   */
  destructive?: boolean;
};

/**
 * Whether a command's effect may run straight from a global keydown. Anything
 * destructive is barred here so a stray or rebound key can't delete records
 * without the on-screen confirmation the delete UIs already require.
 */
export function isDirectlyRunnable(meta: CommandMeta): boolean {
  return !meta.destructive;
}

/**
 * Display order for the groups, in the palette, the help sheet and settings.
 * "Current page" sits second so the palette's empty state leads with what you
 * can do where you are; its commands only exist on pages they apply to.
 */
export const COMMAND_GROUPS: { id: CommandGroup; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'page', label: 'Current page' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'settings', label: 'Settings' },
  { id: 'account', label: 'Account' },
  { id: 'developer', label: 'Developers' },
];

/**
 * The command catalog. Ordering here is the display order within each group
 * and the tie-break order when two commands share a binding (first wins).
 *
 * Every command here is non-destructive (navigate, toggle, copy, and signing
 * out, which ends a session but leaves every record in place). Deleting or
 * otherwise mutating records is intentionally NOT a shortcut — those flows keep
 * their own on-screen "…this cannot be undone" confirmation. If a destructive
 * command is ever added, mark it `destructive: true`; see `isDirectlyRunnable`.
 */
export const COMMANDS: CommandMeta[] = [
  // --- General -------------------------------------------------------------
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
    id: 'whats-new',
    label: 'What’s new',
    description: 'Read the latest release notes.',
    group: 'general',
    defaultBindings: [],
    keywords: ['changelog', 'release', 'notes', 'updates', 'new', 'whats new'],
  },

  // --- Current page --------------------------------------------------------
  // Each of these only exists on a page it applies to (`when`), so the
  // palette's "Current page" group is a list of what you can do right here.
  {
    id: 'open-in',
    label: 'Open in…',
    description: 'Pick an app to open this profile or record in.',
    group: 'page',
    defaultBindings: ['o'],
    keywords: ['open', 'in', 'app', 'client', 'waypoint', 'bluesky', 'switch', 'view'],
    when: 'linkable',
    opensList: 'open-in',
  },
  {
    id: 'open-in-explorer',
    label: 'Open in explorer',
    description: 'Browse this profile or record in the Atmosphere Explorer.',
    group: 'page',
    defaultBindings: [],
    keywords: ['explore', 'explorer', 'inspect', 'raw', 'json', 'record'],
    when: 'universal',
  },
  {
    id: 'go-up',
    label: 'Go up a level',
    description: 'From a record to its collection, a collection to its repo.',
    group: 'page',
    defaultBindings: ['g u'],
    keywords: ['up', 'parent', 'back', 'collection', 'repo', 'breadcrumb'],
    when: 'parent',
  },
  {
    id: 'copy-at-uri',
    label: 'Copy at:// URI',
    description: 'The AT URI of the repo, collection or record on this page.',
    group: 'page',
    defaultBindings: [],
    keywords: ['copy', 'at uri', 'aturi', 'uri', 'at://', 'clipboard'],
    when: 'repo',
  },
  {
    id: 'copy-universal-link',
    label: 'Copy universal link',
    description: 'An aturi.to link that opens in whichever app the reader picks.',
    group: 'page',
    defaultBindings: [],
    keywords: ['copy', 'share', 'universal', 'link', 'aturi.to', 'clipboard'],
    when: 'linkable',
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
  {
    id: 'view-markdown',
    label: 'View as Markdown',
    description: 'This page as plain Markdown, the way agents read it.',
    group: 'page',
    defaultBindings: [],
    keywords: ['markdown', 'md', 'raw', 'text', 'source', 'agent', 'llm'],
    when: 'markdown',
  },

  // --- Navigation ----------------------------------------------------------
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
    id: 'go-lexicons',
    label: 'Go to lexicons',
    description: 'Every record type in the Atmosphere, and what’s trending.',
    group: 'navigation',
    defaultBindings: ['g n'],
    keywords: ['lexicons', 'nsid', 'schema', 'collections', 'trending', 'record types'],
  },
  {
    id: 'go-spaces',
    label: 'Go to spaces',
    description: 'Permissioned spaces: data shared with a group, not the world.',
    group: 'navigation',
    defaultBindings: [],
    keywords: ['spaces', 'permissioned', 'private', 'groups'],
  },
  {
    id: 'go-tools',
    label: 'Go to tools',
    description: 'Small utilities: a handle debugger, a record validator, an XRPC console, a live monitor and more.',
    group: 'navigation',
    defaultBindings: [],
    keywords: [
      'tools', 'utilities', 'jetstream', 'firehose', 'plc', 'stream', 'monitor', 'live',
      'handle', 'debugger', 'validator', 'validate', 'xrpc', 'console', 'decoder', 'decode',
      'labels', 'feed', 'relay', 'oauth', 'resolver', 'calendar', 'inspector',
    ],
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
    id: 'go-mcp',
    label: 'Go to MCP server',
    description: 'Connect an AI agent to the Atmosphere over MCP.',
    group: 'navigation',
    defaultBindings: [],
    keywords: ['mcp', 'model context protocol', 'ai', 'agent', 'llm', 'claude', 'tools'],
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
    id: 'go-feedback',
    label: 'Go to feedback',
    description: 'Report a bug, suggest a feature, vote on what’s next.',
    group: 'navigation',
    defaultBindings: ['g f'],
    keywords: ['feedback', 'bug', 'report', 'feature', 'request', 'suggest', 'idea'],
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
    id: 'go-about',
    label: 'Go to about',
    description: 'What aturi.to is and who makes it.',
    group: 'navigation',
    defaultBindings: [],
    keywords: ['about', 'info', 'who', 'what'],
  },
  {
    id: 'go-contact',
    label: 'Go to contact',
    description: 'How to reach the people behind aturi.to.',
    group: 'navigation',
    defaultBindings: [],
    keywords: ['contact', 'email', 'reach', 'support'],
  },
  {
    id: 'go-terms',
    label: 'Go to terms & privacy',
    description: 'The terms of use and privacy policy.',
    group: 'navigation',
    defaultBindings: [],
    keywords: ['terms', 'privacy', 'policy', 'legal', 'tos'],
  },

  // --- Appearance ----------------------------------------------------------
  {
    id: 'toggle-theme',
    label: 'Toggle theme',
    description: 'Switch between dark and light.',
    group: 'appearance',
    defaultBindings: ['t'],
    keywords: ['dark', 'light', 'appearance', 'theme', 'mode'],
  },
  {
    id: 'theme-light',
    label: 'Use light theme',
    description: 'Paper and ink.',
    group: 'appearance',
    defaultBindings: [],
    keywords: ['light', 'theme', 'day', 'appearance', 'mode'],
  },
  {
    id: 'theme-dark',
    label: 'Use dark theme',
    description: 'Easy on the eyes at night.',
    group: 'appearance',
    defaultBindings: [],
    keywords: ['dark', 'theme', 'night', 'appearance', 'mode'],
  },
  {
    id: 'color-scheme',
    label: 'Change color scheme…',
    description: 'Moss, Ember, Tide, Dusk and the rest.',
    group: 'appearance',
    defaultBindings: [],
    keywords: ['color', 'colour', 'scheme', 'palette', 'hue', 'accent', 'appearance'],
    opensList: 'color-scheme',
  },
  {
    id: 'text-larger',
    label: 'Increase text size',
    description: 'One step up the font-size scale.',
    group: 'appearance',
    defaultBindings: [],
    keywords: ['font', 'text', 'size', 'bigger', 'larger', 'zoom', 'accessibility'],
  },
  {
    id: 'text-smaller',
    label: 'Decrease text size',
    description: 'One step down the font-size scale.',
    group: 'appearance',
    defaultBindings: [],
    keywords: ['font', 'text', 'size', 'smaller', 'zoom', 'accessibility'],
  },
  {
    id: 'text-reset',
    label: 'Reset text size',
    description: 'Back to the default font size.',
    group: 'appearance',
    defaultBindings: [],
    keywords: ['font', 'text', 'size', 'default', 'reset', 'zoom'],
  },
  {
    id: 'toggle-reduce-motion',
    label: 'Toggle reduce motion',
    description: 'Pause drifting backgrounds and page transitions.',
    group: 'appearance',
    defaultBindings: [],
    keywords: ['motion', 'animation', 'reduce', 'accessibility', 'a11y'],
  },
  {
    id: 'toggle-high-contrast',
    label: 'Toggle high contrast',
    description: 'Stronger text and borders, no glow or grain.',
    group: 'appearance',
    defaultBindings: [],
    keywords: ['contrast', 'high', 'accessibility', 'a11y', 'readability'],
  },

  // --- Settings ------------------------------------------------------------
  // One per settings tab, so a tab is a keystroke away rather than a page
  // load plus a click. They deep-link through the tab hash (/account#…).
  {
    id: 'settings-account',
    label: 'Settings: Account',
    description: 'Your identity, your repo and where settings are kept.',
    group: 'settings',
    defaultBindings: [],
    keywords: ['settings', 'account', 'identity', 'devices', 'sessions'],
  },
  {
    id: 'settings-general',
    label: 'Settings: General',
    description: 'Appearance, notifications and explorer behavior.',
    group: 'settings',
    defaultBindings: [],
    keywords: ['settings', 'general', 'appearance', 'preferences'],
  },
  {
    id: 'settings-keyboard',
    label: 'Settings: Keyboard',
    description: 'Rebind shortcuts and turn chords on or off.',
    group: 'settings',
    defaultBindings: [],
    keywords: ['settings', 'keyboard', 'shortcuts', 'bindings', 'rebind', 'keys'],
  },
  {
    id: 'settings-sections',
    label: 'Settings: Sections',
    description: 'Which explorer sections show, and in what order.',
    group: 'settings',
    defaultBindings: [],
    keywords: ['settings', 'sections', 'explorer', 'layout', 'order'],
  },
  {
    id: 'settings-waypoints',
    label: 'Settings: Waypoints',
    description: 'The groups and layout of the universal-link picker.',
    group: 'settings',
    defaultBindings: [],
    keywords: ['settings', 'waypoints', 'apps', 'clients', 'groups', 'picker'],
  },
  {
    id: 'settings-redirects',
    label: 'Settings: Redirects',
    description: 'Open links straight in the client you prefer.',
    group: 'settings',
    defaultBindings: [],
    keywords: ['settings', 'redirects', 'auto redirect', 'default client'],
  },
  {
    id: 'settings-custom',
    label: 'Settings: Custom waypoints',
    description: 'Your own waypoints, written as URL templates.',
    group: 'settings',
    defaultBindings: [],
    keywords: ['settings', 'custom', 'waypoints', 'templates', 'url'],
  },

  // --- Account -------------------------------------------------------------
  {
    id: 'sign-in',
    label: 'Sign in',
    description: 'Sign in with your atproto handle to sync settings.',
    group: 'account',
    defaultBindings: [],
    keywords: ['sign in', 'login', 'log in', 'oauth', 'account'],
    when: 'signed-out',
  },
  {
    id: 'copy-my-did',
    label: 'Copy my DID',
    description: 'Your decentralized identifier, to the clipboard.',
    group: 'account',
    defaultBindings: [],
    keywords: ['did', 'copy', 'identifier', 'me', 'my', 'account'],
    requiresAuth: true,
  },
  {
    id: 'sign-out',
    label: 'Sign out',
    description: 'End this browser’s session. Your data stays in your repo.',
    group: 'account',
    defaultBindings: [],
    keywords: ['sign out', 'logout', 'log out', 'account'],
    requiresAuth: true,
  },

  // --- Developers ----------------------------------------------------------
  {
    id: 'copy-mcp-url',
    label: 'Copy MCP server URL',
    description: 'The Streamable HTTP endpoint to add to your agent.',
    group: 'developer',
    defaultBindings: [],
    keywords: ['mcp', 'server', 'url', 'endpoint', 'copy', 'agent', 'ai', 'claude'],
  },
  {
    id: 'open-llms-txt',
    label: 'Open llms.txt',
    description: 'The site summarized for language models.',
    group: 'developer',
    defaultBindings: [],
    keywords: ['llms', 'llm', 'txt', 'ai', 'agent', 'docs'],
  },
  {
    id: 'open-openapi',
    label: 'Open OpenAPI spec',
    description: 'The REST endpoints, as openapi.json.',
    group: 'developer',
    defaultBindings: [],
    keywords: ['openapi', 'api', 'rest', 'swagger', 'json', 'spec', 'endpoints'],
  },
  {
    id: 'go-fork',
    label: 'Fork & self-host',
    description: 'Run your own aturi.to.',
    group: 'developer',
    defaultBindings: [],
    keywords: ['fork', 'self host', 'deploy', 'host', 'open source'],
  },
  {
    id: 'view-source',
    label: 'View source on GitHub',
    description: 'The open-source repo behind aturi.to.',
    group: 'developer',
    defaultBindings: [],
    keywords: ['source', 'github', 'code', 'repo', 'open source', 'contribute'],
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

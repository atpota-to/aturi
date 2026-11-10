/**
 * Which layout the account explorer draws at /explore/{repo} and below.
 *
 *   - `workbench`: a dashboard that fills the window. The account and its
 *     collections in a rail, the records in a list, the open record in an
 *     inspector beside it.
 *   - `files`: the same data as a file browser. Namespaces and collections
 *     are folders, records are files and the lexicon is the file's kind.
 *   - `classic`: the three scrolling pages (repo, collection, record) the
 *     explorer has always had.
 *
 * All three read the same URLs, so switching keeps the visitor's place.
 *
 * The choice is browser-local, like the theme, rather than a synced
 * preference: the layouts are being tried side by side, a phone and a desk
 * can reasonably differ, and it keeps the synced preference record (which
 * the extension and the iOS app also read) out of an experiment.
 *
 * Read it with `useSyncExternalStore(subscribeExplorerView,
 * getExplorerView, getExplorerViewOnServer)`, as the site menu is read.
 */

import { SPACE_MARKER } from '@/utils/atproto/spaceUri';

export const EXPLORER_VIEWS = ['workbench', 'files', 'classic'] as const;
export type ExplorerView = (typeof EXPLORER_VIEWS)[number];

/** What a visitor who has never chosen sees, and what the server renders. */
export const DEFAULT_EXPLORER_VIEW: ExplorerView = 'workbench';

export const EXPLORER_VIEW_LABELS: Record<ExplorerView, string> = {
  workbench: 'Workbench',
  files: 'Files',
  classic: 'Classic',
};

/** How the Files view draws a folder's contents. */
export const FILES_LAYOUTS = ['icons', 'list'] as const;
export type FilesLayout = (typeof FILES_LAYOUTS)[number];
export const DEFAULT_FILES_LAYOUT: FilesLayout = 'icons';

const VIEW_KEY = 'aturi.explorerView';
const LAYOUT_KEY = 'aturi.explorerFilesLayout';

const listeners = new Set<() => void>();

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return allowed.includes(raw as T) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage can throw in private modes; the choice then lasts the tab.
  }
}

// Held in memory once read, so a browser that refuses storage still switches.
let view: ExplorerView | null = null;
let layout: FilesLayout | null = null;

export function subscribeExplorerView(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changing the view changes this one too.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== VIEW_KEY && event.key !== LAYOUT_KEY) return;
    view = null;
    layout = null;
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function getExplorerView(): ExplorerView {
  if (view === null) view = read(VIEW_KEY, EXPLORER_VIEWS, DEFAULT_EXPLORER_VIEW);
  return view;
}

export function getExplorerViewOnServer(): ExplorerView {
  return DEFAULT_EXPLORER_VIEW;
}

export function setExplorerView(next: ExplorerView): void {
  if (getExplorerView() === next) return;
  view = next;
  write(VIEW_KEY, next);
  listeners.forEach((listener) => listener());
}

export function getFilesLayout(): FilesLayout {
  if (layout === null) layout = read(LAYOUT_KEY, FILES_LAYOUTS, DEFAULT_FILES_LAYOUT);
  return layout;
}

export function getFilesLayoutOnServer(): FilesLayout {
  return DEFAULT_FILES_LAYOUT;
}

export function setFilesLayout(next: FilesLayout): void {
  if (getFilesLayout() === next) return;
  layout = next;
  write(LAYOUT_KEY, next);
  listeners.forEach((listener) => listener());
}

/** Where in an account's repository an explorer URL points. */
export type ExplorerLocation = {
  /** The repo segment as the URL spells it: a handle or a DID. */
  repo: string;
  collection: string | null;
  rkey: string | null;
};

/** Sections of /explore that are not accounts. */
const NOT_A_REPO = new Set(['lexicons', 'pds', 'spaces']);

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Reads `/explore/{repo}`, `/explore/{repo}/{collection}` and
 * `/explore/{repo}/{collection}/{rkey}`: the three routes the layouts above
 * share. Null for anything else under /explore: the landings, a PDS, and a
 * permissioned space, whose deeper trail has pages of its own.
 */
export function parseExplorerPath(pathname: string | null | undefined): ExplorerLocation | null {
  if (!pathname) return null;
  const parts = pathname.split('/');
  if (parts[0] !== '' || parts[1] !== 'explore' || parts.length < 3 || parts.length > 5) return null;
  const [repo, collection, rkey] = parts.slice(2).map(decodeSegment);
  if (!repo || NOT_A_REPO.has(repo) || collection === SPACE_MARKER) return null;
  return { repo, collection: collection || null, rkey: rkey || null };
}

/**
 * A linking record opened beside the list of what links somewhere (`?peek=`
 * in the workbench and the Files view): `{did}/{collection}/{rkey}`, an AT
 * URI without its scheme. It names a record in any repository, which the
 * path, always this repository's, cannot.
 */
export type PeekTarget = { did: string; collection: string; rkey: string };

/** Null unless the value is exactly a DID, a collection and a record key. */
export function parsePeek(value: string | null | undefined): PeekTarget | null {
  if (!value) return null;
  const parts = value.split('/');
  if (parts.length !== 3) return null;
  const [did, collection, rkey] = parts;
  if (!did.startsWith('did:') || !collection.includes('.') || !rkey) return null;
  return { did, collection, rkey };
}

/** The `?peek=` value for a record, from its AT URI. Null for anything else. */
export function peekValue(uri: string): string | null {
  const value = uri.startsWith('at://') ? uri.slice('at://'.length) : uri;
  return parsePeek(value) ? value : null;
}

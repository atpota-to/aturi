/**
 * What the current page is about, read from its pathname alone.
 *
 * The command palette offers "Copy at:// URI", "Open in…", "Go up a level" and
 * friends only where they make sense, and the keydown engine must agree with
 * it about where that is. Both ask this module. It is pure (no React, no
 * network) so the route grammar it encodes stays unit-testable: a new route
 * shape is a new case in `__tests__/pageContext.test.ts`, not a guess.
 *
 * The repo segment is kept as the URL spells it, handle or DID. Resolving a
 * handle would cost a network round trip per navigation for a command the
 * visitor may never run, and a handle-form at:// URI is valid on its own.
 */

import { markdownVariantFor } from './markdownVariants';
import { encodeRepo } from '@/utils/atproto/urls';

/** The atproto thing a page addresses: a repo, a collection, or a record. */
export type PageSubject = {
  /** Handle or DID, decoded, without a leading `@`. */
  repo: string;
  collection?: string;
  rkey?: string;
};

export type PageSurface = 'explorer' | 'universal' | 'other';

export type PageContext = {
  /** Which part of the site the page belongs to. */
  surface: PageSurface;
  /** What the page addresses, when it addresses one atproto thing. */
  subject: PageSubject | null;
  /** The explorer page one level up, when there is one. */
  parentPath: string | null;
  /** This page's Markdown twin, when it has one. */
  markdownPath: string | null;
};

/**
 * First path segments that belong to the site rather than to a handle. The
 * universal-link route (`/[handle]`) catches every other single segment, so a
 * page under one of these is never read as a profile.
 */
const RESERVED_SEGMENTS = new Set([
  'about',
  'account',
  'api',
  'at',
  'contact',
  'docs',
  'explore',
  'extension',
  'feedback',
  'fork',
  'links',
  'mcp',
  'oauth',
  'profile',
  'terms',
]);

/** Explorer sections that are pages of their own, not repos. */
const EXPLORER_SECTIONS = new Set(['lexicons', 'spaces', 'pds']);

/** The marker segment of a permissioned-space explorer path. */
const SPACE_SEGMENT = 'space';

const EMPTY: Omit<PageContext, 'markdownPath'> = {
  surface: 'other',
  subject: null,
  parentPath: null,
};

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A handle (has a dot) or a DID — the two spellings of a repo. */
function looksLikeRepo(value: string): boolean {
  return value.startsWith('did:') || (value.includes('.') && !value.includes(' '));
}

function stripAt(value: string): string {
  return value.startsWith('@') ? value.slice(1) : value;
}

function joinPath(segments: string[]): string {
  return `/${segments.join('/')}`;
}

function explorerContext(raw: string[]): Omit<PageContext, 'markdownPath'> {
  // raw[0] is 'explore'.
  if (raw.length === 1) return { ...EMPTY, surface: 'explorer' };

  const second = raw[1];
  if (EXPLORER_SECTIONS.has(second)) {
    // /explore/lexicons/{nsid} and /explore/lexicons/group/{prefix} both
    // belong to the lexicons index; everything else steps up to /explore.
    const parentPath =
      second === 'lexicons' && raw.length > 2 ? '/explore/lexicons' : '/explore';
    return { surface: 'explorer', subject: null, parentPath };
  }

  const repo = decode(second);

  // /explore/{repo}/space[/{type}[/{skey}[/{author}/{collection}/{rkey}]]].
  // Only the record depth skips levels: there's no page between a space ref
  // and a record address, so up from a record is the ref. No subject: a space
  // address is private data with its own grammar, and treating it as the
  // authority's repo would hand "Copy at:// URI" and "Open in…" the wrong
  // thing.
  if (raw[2] === SPACE_SEGMENT) {
    const parentPath = raw.length === 8 ? joinPath(raw.slice(0, 5)) : joinPath(raw.slice(0, -1));
    return { surface: 'explorer', subject: null, parentPath };
  }

  if (raw.length === 2) {
    return { surface: 'explorer', subject: { repo }, parentPath: '/explore' };
  }
  const collection = decode(raw[2]);
  if (raw.length === 3) {
    return {
      surface: 'explorer',
      subject: { repo, collection },
      parentPath: joinPath(raw.slice(0, 2)),
    };
  }
  return {
    surface: 'explorer',
    subject: { repo, collection, rkey: decode(raw[3]) },
    parentPath: joinPath(raw.slice(0, 3)),
  };
}

function universalContext(raw: string[]): Omit<PageContext, 'markdownPath'> | null {
  // /profile/{id}, /profile/{id}/post/{rkey}, /profile/{id}/{nsid}/{rkey}
  if (raw[0] === 'profile') {
    const id = raw[1] ? stripAt(decode(raw[1])) : '';
    if (!id || !looksLikeRepo(id)) return null;
    if (raw.length === 2) return { surface: 'universal', subject: { repo: id }, parentPath: null };
    if (raw.length !== 4) return null;
    const seg = decode(raw[2]);
    const collection =
      seg === 'post' ? 'app.bsky.feed.post' : seg === 'lists' || seg === 'list' ? 'app.bsky.graph.list' : seg;
    return {
      surface: 'universal',
      subject: { repo: id, collection, rkey: decode(raw[3]) },
      parentPath: null,
    };
  }

  if (RESERVED_SEGMENTS.has(raw[0])) return null;
  const id = stripAt(decode(raw[0]));
  if (!looksLikeRepo(id)) return null;

  // /{id} and /{id}/{collection}/{rkey}: the two shapes the route tree serves.
  if (raw.length === 1) return { surface: 'universal', subject: { repo: id }, parentPath: null };
  if (raw.length === 3) {
    return {
      surface: 'universal',
      subject: { repo: id, collection: decode(raw[1]), rkey: decode(raw[2]) },
      parentPath: null,
    };
  }
  return null;
}

/** Derive the {@link PageContext} for a pathname. */
export function pageContextFromPath(pathname: string | null | undefined): PageContext {
  const path = pathname || '/';
  const markdownPath = markdownVariantFor(path);
  const raw = path.split('/').filter(Boolean);
  if (raw.length === 0) return { ...EMPTY, markdownPath };

  if (raw[0] === 'explore') return { ...explorerContext(raw), markdownPath };
  return { ...(universalContext(raw) ?? EMPTY), markdownPath };
}

/** The at:// URI for a subject, as specific as the subject is. */
export function atUriFor(subject: PageSubject): string {
  if (subject.collection && subject.rkey) {
    return `at://${subject.repo}/${subject.collection}/${subject.rkey}`;
  }
  if (subject.collection) return `at://${subject.repo}/${subject.collection}`;
  return `at://${subject.repo}`;
}

/**
 * The shapes a universal link and the waypoints can open: a profile, or a
 * record. A bare collection is neither, so it has no universal link.
 */
export function isLinkable(subject: PageSubject | null): subject is PageSubject {
  if (!subject) return false;
  return !subject.collection || Boolean(subject.rkey);
}

/** The universal-link path (the waypoint picker) for a profile or record. */
export function universalPathFor(subject: PageSubject): string | null {
  if (!isLinkable(subject)) return null;
  const repo = encodeRepo(subject.repo);
  if (subject.collection && subject.rkey) {
    return `/${repo}/${subject.collection}/${encodeURIComponent(subject.rkey)}`;
  }
  return `/${repo}`;
}

/** The explorer path for a subject. */
export function explorePathFor(subject: PageSubject): string {
  const repo = encodeRepo(subject.repo);
  if (subject.collection && subject.rkey) {
    return `/explore/${repo}/${subject.collection}/${encodeURIComponent(subject.rkey)}`;
  }
  if (subject.collection) return `/explore/${repo}/${subject.collection}`;
  return `/explore/${repo}`;
}

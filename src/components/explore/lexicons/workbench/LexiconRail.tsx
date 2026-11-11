'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { BarChart3, Braces, ChevronRight, FolderTree, List, Pin, Search, Sparkles, Sprout, type LucideIcon } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesProvider';
import {
  homeScopeFor,
  LEXICON_LIST_LABELS,
  LEXICON_LISTS,
  type LexiconList,
  type LexiconLocation,
  type LexiconScope,
} from '@/lib/lexiconExplorer';
import { isPinGroup, pinGroupPrefix, PIN_GROUP_SUFFIX, togglePinnedLexicon } from '@/utils/preferences';
import { searchLexicons } from '@/utils/ufos/client';
import type { NsidCount } from '@/utils/ufos/config';
import { formatCount } from '@/utils/ufos/format';
import { namespaceKey } from '@/utils/ufos/nsid';
import { SkeletonBar } from '../../skeletons/primitives';
import LexiconFavicon from '../../tabs/LexiconFavicon';
import { FileGlyph, FolderGlyph, fileKindOf } from '../../workbench/FileIcons';
import { namespaceListing, useActiveNamespaces, type NamespaceEntry } from './useLexiconData';

export const LIST_ICONS: Record<LexiconList, LucideIcon> = {
  trending: Sparkles,
  top: BarChart3,
  new: Sprout,
  all: List,
};

/** Builds the address of somewhere else, keeping the window and the metric. */
export type AddressFor = (to: { scope: LexiconScope; nsid?: string | null }) => string;

/** The visitor's pinned lexicons and namespaces, shared with the account explorer's trees. */
export function useLexiconPins() {
  const { prefs, update } = usePreferences();
  const pins = prefs.pinnedLexicons;
  const set = useMemo(() => new Set(pins), [pins]);
  const toggle = useCallback(
    (entry: string) => update((p) => togglePinnedLexicon(p, entry, 'mine')),
    [update],
  );
  return { pins, isPinned: (entry: string) => set.has(entry), toggle };
}

/**
 * The lexicons workbench's rail: a find field, the four ways to list the
 * whole network, what the visitor has pinned, and the busiest namespaces as
 * a tree that opens a level at a time.
 *
 * Every place is a link the shell turns into a move (LexiconShell), so a
 * middle-click still opens it in a tab of its own.
 */
export default function LexiconRail({
  loc,
  addressFor,
  navigate,
  files,
  onDone,
}: {
  loc: LexiconLocation;
  addressFor: AddressFor;
  navigate: (to: string) => void;
  /** The Files view draws namespaces as folders and lexicons as files. */
  files: boolean;
  onDone: () => void;
}) {
  const { pins, isPinned, toggle } = useLexiconPins();
  const listOpen = loc.scope.kind === 'list' ? loc.scope.list : null;

  return (
    <>
      <div className="fx-lx-railhead">
        <span className="fx-lx-railmark" aria-hidden>
          <Braces size={16} />
        </span>
        <div className="fx-wb-acct-names">
          <Link href={addressFor({ scope: { kind: 'list', list: 'trending' } })} prefetch={false} className="fx-wb-acct-name">
            Lexicons
          </Link>
          <span className="fx-lx-railsub">Record types, network-wide</span>
        </div>
        <button type="button" className="fx-btn fx-btn-sm fx-wb-done" onClick={onDone}>
          Done
        </button>
      </div>

      <LexiconFind addressFor={addressFor} navigate={navigate} />

      <nav aria-label="Lists" className="fx-wb-views">
        {LEXICON_LISTS.map((list) => {
          const Icon = LIST_ICONS[list];
          return (
            <Link
              key={list}
              href={addressFor({ scope: { kind: 'list', list } })}
              prefetch={false}
              className="fx-wb-view"
              aria-current={listOpen === list ? 'page' : undefined}
            >
              <Icon size={14} aria-hidden />
              {LEXICON_LIST_LABELS[list]}
            </Link>
          );
        })}
      </nav>

      <div className="fx-wb-tree fx-lx-tree">
        {pins.length > 0 && (
          <>
            <h2 className="fx-wb-label">
              <Pin size={11} aria-hidden /> Pinned
            </h2>
            <ul className="fx-tree fx-lx-pins">
              {pins.map((entry) => {
                const group = isPinGroup(entry);
                const name = pinGroupPrefix(entry);
                const scope: LexiconScope = group ? { kind: 'namespace', prefix: name } : homeScopeFor(name);
                const href = group ? addressFor({ scope }) : addressFor({ scope, nsid: name });
                const current = group
                  ? !loc.nsid && loc.scope.kind === 'namespace' && loc.scope.prefix === name
                  : loc.nsid === name;
                return (
                  <li key={entry}>
                    <div className="fx-row" data-current={current || undefined}>
                      <Link
                        href={href}
                        prefetch={false}
                        className="fx-row-main"
                        aria-current={current ? 'page' : undefined}
                        title={group ? `${name}.*` : name}
                      >
                        <Glyph files={files} kind={group ? 'namespace' : 'lexicon'} name={name} />
                        <span className="fx-row-text">
                          {name}
                          {group && <span className="fx-row-dim">.*</span>}
                        </span>
                      </Link>
                      <PinButton pinned onToggle={() => toggle(entry)} name={group ? `${name}.*` : name} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <NamespaceTree loc={loc} addressFor={addressFor} files={files} isPinned={isPinned} toggle={toggle} />
      </div>
    </>
  );
}

function Glyph({ files, kind, name }: { files: boolean; kind: 'namespace' | 'lexicon'; name: string }) {
  if (files) return kind === 'namespace' ? <FolderGlyph prefix={namespaceKey(name)} /> : <FileGlyph kind={fileKindOf(name)} />;
  return kind === 'namespace' ? (
    <FolderTree size={13} aria-hidden className="fx-lx-glyph" data-kind="namespace" />
  ) : (
    <Braces size={13} aria-hidden className="fx-lx-glyph" />
  );
}

function PinButton({ pinned, onToggle, name }: { pinned: boolean; onToggle: () => void; name: string }) {
  return (
    <button
      type="button"
      className="fx-row-pin"
      data-pinned={pinned || undefined}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
      title={pinned ? 'Unpin' : 'Pin, here and in every account’s collections'}
      onClick={onToggle}
    >
      <Pin size={13} aria-hidden />
    </button>
  );
}

// ─── Find ────────────────────────────────────────────────────────────────────

const FIND_DEBOUNCE_MS = 180;
const FIND_LIMIT = 8;

function alnumLength(s: string): number {
  return (s.match(/[a-z0-9-]/gi) || []).length;
}

/**
 * Find a lexicon as you type, from UFOs' search. Picking one opens it beside
 * the search's results; Enter on a dotted name opens that namespace, and on
 * anything else lists the results.
 */
function LexiconFind({ addressFor, navigate }: { addressFor: AddressFor; navigate: (to: string) => void }) {
  const [value, setValue] = useState('');
  const [results, setResults] = useState<NsidCount[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const term = value.trim();

  useEffect(() => {
    if (alnumLength(term) < 2) {
      setResults([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const found = await searchLexicons(term, controller.signal);
      setResults([...found].sort((a, b) => b.dids_estimate - a.dids_estimate).slice(0, FIND_LIMIT));
      setActive(-1);
    }, FIND_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [term]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function finish(to: string) {
    setOpen(false);
    setValue('');
    navigate(to);
  }

  function submit() {
    if (active >= 0 && results[active]) {
      finish(addressFor({ scope: { kind: 'search', term }, nsid: results[active].nsid }));
      return;
    }
    if (alnumLength(term) < 2) return;
    if (results.some((r) => r.nsid === term)) {
      finish(addressFor({ scope: { kind: 'search', term }, nsid: term }));
    } else if (term.includes('.') && !/\s/.test(term)) {
      finish(addressFor({ scope: { kind: 'namespace', prefix: term.replace(/\.\*?$/, '') } }));
    } else {
      finish(addressFor({ scope: { kind: 'search', term } }));
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      if (open && results.length) {
        e.preventDefault();
        setOpen(false);
      } else if (value) {
        e.preventDefault();
        setValue('');
      }
    } else if (open && results.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const n = results.length;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
    }
  }

  const showList = open && results.length > 0;
  return (
    <div ref={wrapRef} className="fx-lx-find">
      <label className="fx-field">
        <Search size={14} aria-hidden />
        <span className="fx-sr">Find a lexicon</span>
        <input
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="Find a lexicon or namespace"
          value={value}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </label>
      {showList && (
        <ul id={listId} role="listbox" className="fx-lx-find-list" aria-label="Lexicons found">
          {results.map((r, i) => (
            <li
              key={r.nsid}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="fx-lx-find-item"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => finish(addressFor({ scope: { kind: 'search', term }, nsid: r.nsid }))}
            >
              <LexiconFavicon prefix={namespaceKey(r.nsid)} />
              <span className="fx-lx-find-nsid">{r.nsid}</span>
              <span className="fx-lx-find-count" title={`${r.dids_estimate.toLocaleString()} accounts`}>
                {formatCount(r.dids_estimate)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── The tree ────────────────────────────────────────────────────────────────

/** Every namespace from two segments down to `prefix`: `a.b.c.d` -> `a.b`, `a.b.c`, `a.b.c.d`. */
function ancestors(prefix: string): string[] {
  const parts = prefix.split('.');
  const out: string[] = [];
  for (let i = 2; i <= parts.length; i++) out.push(parts.slice(0, i).join('.'));
  return out;
}

/** The namespace a location is in, for opening the tree to it. */
function openPrefixOf(loc: LexiconLocation): string | null {
  if (loc.nsid) return loc.nsid.split('.').slice(0, -1).join('.') || null;
  return loc.scope.kind === 'namespace' ? loc.scope.prefix : null;
}

function NamespaceTree({
  loc,
  addressFor,
  files,
  isPinned,
  toggle,
}: {
  loc: LexiconLocation;
  addressFor: AddressFor;
  files: boolean;
  isPinned: (entry: string) => boolean;
  toggle: (entry: string) => void;
}) {
  const active = useActiveNamespaces(loc.window);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Where you are opens up in the tree, as the collections tree opens to the
  // collection being shown.
  const here = openPrefixOf(loc);
  useEffect(() => {
    if (!here) return;
    setExpanded((prev) => {
      const wanted = ancestors(here).filter((p) => !prev.has(p));
      if (wanted.length === 0) return prev;
      const next = new Set(prev);
      wanted.forEach((p) => next.add(p));
      return next;
    });
  }, [here]);

  const roots = useMemo(() => {
    const list = active.data?.map((n) => n.prefix) ?? [];
    // A namespace too quiet to be in the pool is still where you are.
    const top = here ? ancestors(here)[0] : null;
    const withHere = top && top.includes('.') && !list.includes(top) ? [top, ...list] : list;
    const f = filter.trim().toLowerCase();
    return f ? withHere.filter((p) => p.toLowerCase().includes(f)) : withHere;
  }, [active.data, here, filter]);

  const flip = (prefix: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });

  return (
    <>
      <h2 className="fx-wb-label">Active namespaces</h2>
      <div className="fx-tree-pane">
        <div className="fx-tree-tools">
          <label className="fx-field">
            <Search size={14} aria-hidden />
            <span className="fx-sr">Filter namespaces</span>
            <input
              type="text"
              placeholder="Filter namespaces"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && filter) {
                  e.preventDefault();
                  setFilter('');
                }
              }}
            />
          </label>
        </div>
        <div className="fx-tree-scroll">
          {active.data === null && !active.error ? (
            <TreeSkeleton />
          ) : active.error && !active.data ? (
            <p className="fx-wb-note">Couldn’t reach UFOs for the namespaces.</p>
          ) : roots.length === 0 ? (
            <p className="fx-wb-note">No namespace matches “{filter.trim()}”.</p>
          ) : (
            <ul className="fx-tree" aria-label="Namespaces">
              {roots.map((prefix) => (
                <TreeNode
                  key={prefix}
                  prefix={prefix}
                  depth={0}
                  loc={loc}
                  addressFor={addressFor}
                  files={files}
                  expanded={expanded}
                  flip={flip}
                  isPinned={isPinned}
                  toggle={toggle}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function TreeNode({
  prefix,
  depth,
  loc,
  addressFor,
  files,
  expanded,
  flip,
  isPinned,
  toggle,
}: {
  prefix: string;
  depth: number;
  loc: LexiconLocation;
  addressFor: AddressFor;
  files: boolean;
  expanded: Set<string>;
  flip: (prefix: string) => void;
  isPinned: (entry: string) => boolean;
  toggle: (entry: string) => void;
}) {
  const open = expanded.has(prefix);
  const [children, setChildren] = useState<NamespaceEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setFailed(false);
    namespaceListing(prefix, loc.window).then(
      (listing) => {
        if (!cancelled) setChildren([...listing.entries].sort(byKindThenName));
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, prefix, loc.window]);

  const current = !loc.nsid && loc.scope.kind === 'namespace' && loc.scope.prefix === prefix;
  const label = depth === 0 ? prefix : prefix.slice(prefix.lastIndexOf('.') + 1);
  const groupEntry = `${prefix}${PIN_GROUP_SUFFIX}`;

  return (
    <li>
      <div className="fx-row" data-current={current || undefined} style={{ ['--depth' as string]: depth }}>
        <button
          type="button"
          className="fx-lx-chev"
          aria-label={open ? `Collapse ${prefix}` : `Expand ${prefix}`}
          aria-expanded={open}
          onClick={() => flip(prefix)}
        >
          <ChevronRight size={13} aria-hidden className="fx-row-chev" />
        </button>
        <Link
          href={addressFor({ scope: { kind: 'namespace', prefix } })}
          prefetch={false}
          className="fx-row-main"
          aria-current={current ? 'page' : undefined}
          title={prefix}
        >
          {depth === 0 && !files ? <LexiconFavicon prefix={prefix} /> : <Glyph files={files} kind="namespace" name={prefix} />}
          <span className="fx-row-text">{label}</span>
        </Link>
        <PinButton pinned={isPinned(groupEntry)} onToggle={() => toggle(groupEntry)} name={`${prefix}.*`} />
      </div>
      {open && (
        <ul>
          {children === null && !failed ? (
            <li className="fx-lx-tree-wait" style={{ ['--depth' as string]: depth + 1 }}>
              <SkeletonBar width="60%" height="0.6rem" />
            </li>
          ) : failed ? (
            <li className="fx-wb-note">Couldn’t list {prefix}.</li>
          ) : children && children.length === 0 ? (
            <li className="fx-lx-tree-empty" style={{ ['--depth' as string]: depth + 1 }}>
              Nothing in this window
            </li>
          ) : (
            children?.map((child) =>
              child.kind === 'namespace' ? (
                <TreeNode
                  key={`ns|${child.name}`}
                  prefix={child.name}
                  depth={depth + 1}
                  loc={loc}
                  addressFor={addressFor}
                  files={files}
                  expanded={expanded}
                  flip={flip}
                  isPinned={isPinned}
                  toggle={toggle}
                />
              ) : (
                <TreeLeaf
                  key={`lx|${child.name}`}
                  nsid={child.name}
                  depth={depth + 1}
                  loc={loc}
                  addressFor={addressFor}
                  files={files}
                  accounts={child.counts.dids_estimate}
                  pinned={isPinned(child.name)}
                  toggle={toggle}
                />
              ),
            )
          )}
        </ul>
      )}
    </li>
  );
}

function TreeLeaf({
  nsid,
  depth,
  loc,
  addressFor,
  files,
  accounts,
  pinned,
  toggle,
}: {
  nsid: string;
  depth: number;
  loc: LexiconLocation;
  addressFor: AddressFor;
  files: boolean;
  accounts: number;
  pinned: boolean;
  toggle: (entry: string) => void;
}) {
  const current = loc.nsid === nsid;
  return (
    <li>
      <div className="fx-row" data-kind="leaf" data-current={current || undefined} style={{ ['--depth' as string]: depth }}>
        <span className="fx-lx-chev" aria-hidden />
        <Link
          href={addressFor({ scope: homeScopeFor(nsid), nsid })}
          prefetch={false}
          className="fx-row-main"
          aria-current={current ? 'page' : undefined}
          title={nsid}
        >
          <Glyph files={files} kind="lexicon" name={nsid} />
          <span className="fx-row-text">{nsid.slice(nsid.lastIndexOf('.') + 1)}</span>
          <span className="fx-row-count" title={`${accounts.toLocaleString()} accounts`}>
            {formatCount(accounts)}
          </span>
        </Link>
        <PinButton pinned={pinned} onToggle={() => toggle(nsid)} name={nsid} />
      </div>
    </li>
  );
}

/** Namespaces first, then lexicons, each A to Z: a tree reads as a directory. */
function byKindThenName(a: NamespaceEntry, b: NamespaceEntry): number {
  if (a.kind !== b.kind) return a.kind === 'namespace' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function TreeSkeleton() {
  const widths = ['7rem', '5.5rem', '8rem', '6rem', '4.75rem', '7.5rem', '6.5rem', '5rem', '7rem', '6rem'];
  return (
    <ul className="fx-tree" aria-hidden>
      {widths.map((w, i) => (
        <li key={i}>
          <div className="fx-row fx-lx-skel-row">
            <span className="fx-lx-chev" />
            <span className="fx-row-main">
              <SkeletonBar width="14px" height="14px" shape="control" style={{ flex: 'none' }} />
              <SkeletonBar width={w} height="0.6rem" />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

'use client';

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { COMMAND_GROUPS, type Platform } from '@/lib/keybindings';
import { resolveSearchPath, resolveSearchPathAsync } from '@/utils/atproto/searchRouting';
import Kbd from './Kbd';
import type { ResolvedCommand } from './KeyboardShortcutsProvider';

type Item =
  | { kind: 'command'; cmd: ResolvedCommand }
  | { kind: 'goto'; query: string; path: string };

function scoreCommand(cmd: ResolvedCommand, q: string): number {
  const label = cmd.meta.label.toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;
  if (cmd.meta.keywords?.some((k) => k.includes(q))) return 40;
  const groupLabel =
    COMMAND_GROUPS.find((g) => g.id === cmd.meta.group)?.label.toLowerCase() ?? '';
  if (groupLabel.includes(q)) return 20;
  return -1;
}

/**
 * The ⌘K command sheet. A native <dialog> (focus trap + Escape for free, like
 * JsonModal) with a filter input over every available command, plus a
 * "go to <query>" row that routes free text into the explorer. Arrow keys move
 * the selection, Enter runs it. Styling lives in globals.css under `.cmdk-*`.
 */
export default function CommandPalette({
  open,
  onClose,
  commands,
  platform,
  onNavigate,
  onOpenHelp,
}: {
  open: boolean;
  onClose: () => void;
  commands: ResolvedCommand[];
  platform: Platform;
  onNavigate: (path: string) => void;
  onOpenHelp: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  // Drive the native modal from the `open` prop.
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  // Reset + focus whenever the palette opens. The state resets live inside the
  // timer callback (not synchronously in the effect body) to stay clear of the
  // set-state-in-effect lint rule — the dialog has just been shown, so a
  // one-tick-later reset is imperceptible.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      setQuery('');
      setHighlight(0);
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Mirror native `close` (Escape / dlg.close()) back to the parent.
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const handleClose = () => onClose();
    dlg.addEventListener('close', handleClose);
    return () => dlg.removeEventListener('close', handleClose);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const available = useMemo(() => commands.filter((c) => c.available), [commands]);

  const items = useMemo<Item[]>(() => {
    if (!q) return available.map((cmd) => ({ kind: 'command', cmd }));
    const scored = available
      .map((cmd) => ({ cmd, s: scoreCommand(cmd, q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s);
    const list: Item[] = scored.map((x) => ({ kind: 'command', cmd: x.cmd }));
    // Offer a "go to <query>" row only when the text reads like an identifier
    // (has a dot/colon/slash, or an at://-or-did prefix) or when nothing else
    // matched — so filtering commands like "toggle theme" doesn't sprout a
    // spurious navigation row.
    const trimmed = query.trim();
    const looksLikeTarget =
      /[.:/]/.test(trimmed) || trimmed.startsWith('at://') || trimmed.startsWith('did:');
    if (trimmed.length >= 2 && (looksLikeTarget || list.length === 0)) {
      const path = resolveSearchPath(query);
      if (path) list.push({ kind: 'goto', query: trimmed, path });
    }
    return list;
  }, [available, q, query]);

  // Keep the highlight in range as the filtered list shrinks/grows.
  const activeIndex = items.length === 0 ? -1 : Math.min(highlight, items.length - 1);

  // Scroll the active row into view on selection changes.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  function runItem(item: Item | undefined) {
    if (!item) return;
    onClose();
    if (item.kind === 'command') {
      item.cmd.run();
      return;
    }
    // The row above was built with the synchronous guess (re-resolving on every
    // keystroke would mean a network call per character). Resolve properly now
    // that the user has committed, so an unrecognized URL gets a chance to be
    // identified by its AT Tags. Falls back to the same path on any failure.
    void resolveSearchPathAsync(item.query).then((path) => {
      onNavigate(path || item.path);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length === 0) return;
      setHighlight((i) => (Math.min(i, items.length - 1) + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      setHighlight((i) => {
        const cur = Math.min(i, items.length - 1);
        return cur <= 0 ? items.length - 1 : cur - 1;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runItem(items[activeIndex]);
    } else if (e.key === 'Escape' && query) {
      // First Escape clears the query; a second closes the palette.
      e.preventDefault();
      setQuery('');
      setHighlight(0);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-label="Command palette"
      className="cmdk-dialog"
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="cmdk-panel">
        <div className="cmdk-search">
          <Search size={16} aria-hidden className="cmdk-search-icon" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="cmdk-list"
            aria-activedescendant={activeIndex >= 0 ? `cmdk-item-${activeIndex}` : undefined}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Search commands, or jump to a handle / at:// URI…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            className="cmdk-input"
          />
          <kbd className="kbd cmdk-esc">Esc</kbd>
        </div>

        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {items.length === 0 && (
            <div className="cmdk-empty">No matching commands.</div>
          )}
          {items.map((item, i) => {
            const isActive = i === activeIndex;
            if (item.kind === 'goto') {
              return (
                <button
                  key="__goto"
                  type="button"
                  role="option"
                  id={`cmdk-item-${i}`}
                  data-idx={i}
                  aria-selected={isActive}
                  className={`cmdk-item ${isActive ? 'is-active' : ''}`}
                  onMouseMove={() => setHighlight(i)}
                  onClick={() => runItem(item)}
                >
                  <span className="cmdk-item-icon">
                    <Search size={16} aria-hidden />
                  </span>
                  <span className="cmdk-item-body">
                    <span className="cmdk-item-label">
                      Go to <span className="cmdk-item-query">{item.query}</span>
                    </span>
                    <span className="cmdk-item-desc">Open in the explorer</span>
                  </span>
                  <CornerDownLeft size={14} aria-hidden className="cmdk-item-enter" />
                </button>
              );
            }
            const { cmd } = item;
            const Icon = cmd.icon;
            const showHeader =
              !q && (i === 0 || (items[i - 1]?.kind === 'command' &&
                (items[i - 1] as { cmd: ResolvedCommand }).cmd.meta.group !== cmd.meta.group));
            const groupLabel = COMMAND_GROUPS.find((g) => g.id === cmd.meta.group)?.label;
            return (
              <Fragment key={cmd.meta.id}>
                {showHeader && <div className="cmdk-group-label">{groupLabel}</div>}
                <button
                  type="button"
                  role="option"
                  id={`cmdk-item-${i}`}
                  data-idx={i}
                  aria-selected={isActive}
                  className={`cmdk-item ${isActive ? 'is-active' : ''}`}
                  onMouseMove={() => setHighlight(i)}
                  onClick={() => runItem(item)}
                >
                  <span className="cmdk-item-icon">
                    <Icon size={16} aria-hidden />
                  </span>
                  <span className="cmdk-item-body">
                    <span className="cmdk-item-label">{cmd.meta.label}</span>
                    <span className="cmdk-item-desc">{cmd.meta.description}</span>
                  </span>
                  {cmd.bindings[0] && (
                    <span className="cmdk-item-kbd">
                      <Kbd binding={cmd.bindings[0]} platform={platform} />
                    </span>
                  )}
                </button>
              </Fragment>
            );
          })}
        </div>

        <div className="cmdk-footer">
          <span className="cmdk-hint">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd>
            <span>navigate</span>
          </span>
          <span className="cmdk-hint">
            <kbd className="kbd">↵</kbd>
            <span>run</span>
          </span>
          <button
            type="button"
            className="cmdk-hint cmdk-hint-button"
            onClick={() => {
              onClose();
              onOpenHelp();
            }}
          >
            <kbd className="kbd">?</kbd>
            <span>all shortcuts</span>
          </button>
        </div>
      </div>
    </dialog>
  );
}

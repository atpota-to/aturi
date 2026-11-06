'use client';

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Braces,
  Check,
  ChevronRight,
  Clock,
  CornerDownLeft,
  FolderTree,
  Search,
  Server,
  User,
} from 'lucide-react';
import {
  COMMAND_GROUPS,
  eventToStep,
  parseBinding,
  type PaletteList,
  type Platform,
} from '@/lib/keybindings';
import {
  PALETTE_PREFIXES,
  matchScore,
  looksLikeTarget,
  nsidLikelihood,
  parsePaletteQuery,
  wantsLexiconSearch,
  wantsPeopleSearch,
} from '@/lib/paletteSearch';
import { universalPathFor, type PageContext } from '@/lib/pageContext';
import { applyColorScheme, COLOR_SCHEMES, type ColorScheme } from '@/lib/colorScheme';
import { resolveSearchPathAsync, resolveSearchTarget } from '@/utils/atproto/searchRouting';
import { encodeRepo } from '@/utils/atproto/urls';
import { searchActorsTypeahead, type ActorTypeaheadResult } from '@/utils/atproto/appview';
import { searchLexicons } from '@/utils/ufos/client';
import { groupPathFor, lexiconPathFor } from '@/utils/ufos/nsid';
import { formatCount } from '@/utils/ufos/format';
import type { NsidCount } from '@/utils/ufos/config';
import {
  getRecents,
  readSearchHistory,
  recordActorVisit,
  recordQueryVisit,
  type SearchHistoryEntry,
} from '@/utils/searchHistory';
import type { Waypoint } from '@/utils/waypoints';
import { openInApps, waypointNoun } from '@/lib/openInApps';
import { usePreferences } from './PreferencesProvider';
import Kbd from './Kbd';
import type { ResolvedCommand } from './KeyboardShortcutsProvider';

const SEARCH_DEBOUNCE_MS = 180;
const PEOPLE_LIMIT = 6;
const LEXICON_LIMIT = 10;
/** Recent jumps shown on the empty palette, and matched while typing. */
const RECENTS_EMPTY = 5;
const RECENTS_MATCHED = 3;
/** "Open in X" rows shown among the root results while typing. */
const WAYPOINTS_MATCHED = 5;

type Navigate = (href: string, opts?: { newTab?: boolean; document?: boolean }) => void;

/** One selectable line in the palette, whatever source it came from. */
type Row = {
  key: string;
  /** Header shown above the first row of each run of the same section. */
  section: string;
  icon: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  /** Right-hand affordance: a key binding, an "opens a list" chevron… */
  trailing?: ReactNode;
  /** Set when the row goes somewhere, so ⌘/Ctrl+Enter can open a new tab. */
  href?: string;
  /** A color scheme to preview while this row is highlighted. */
  scheme?: ColorScheme;
  run: (opts: { newTab: boolean }) => void;
};

/** What an asynchronous search returned, and for which text. */
type Results<T> = { text: string; items: T[] };

function Avatar({ src }: { src?: string }) {
  if (!src) return <User size={16} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={30} height={30} className="cmdk-avatar" />;
}

/**
 * The ⌘K command palette. A native <dialog> (focus trap + Escape for free,
 * like JsonModal) over one input that searches several sources at once:
 *
 *   - every command in the catalog that can run on this page,
 *   - "Go to" for anything that names a place (handle, DID, at:// URI, any
 *     app's link, a PDS host) and "Open lexicon" for an NSID,
 *   - recent jumps from the explorer's search history,
 *   - people, through the appview's handle typeahead,
 *   - "Open in <app>" for the profile or record on screen.
 *
 * A leading `>`, `@` or `#` narrows it to commands, people or lexicons. Some
 * commands drill into a list instead of running ("Open in…", "Change color
 * scheme…"); Backspace on an empty query, or Escape, steps back out. Enter
 * runs the highlighted row and ⌘/Ctrl+Enter opens it in a new tab. Styling
 * lives in globals.css and fieldnotes/account.css under `.cmdk-*`.
 */
export default function CommandPalette({
  open,
  initialList,
  onClose,
  commands,
  platform,
  pageContext,
  onNavigate,
  onOpenHelp,
}: {
  open: boolean;
  /** Open straight onto a list (a bound "Open in…" key), or the root. */
  initialList: PaletteList | null;
  onClose: () => void;
  commands: ResolvedCommand[];
  platform: Platform;
  pageContext: PageContext;
  onNavigate: Navigate;
  onOpenHelp: () => void;
}) {
  const { prefs, update } = usePreferences();
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [list, setList] = useState<PaletteList | null>(null);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [people, setPeople] = useState<Results<ActorTypeaheadResult>>({ text: '', items: [] });
  const [lexicons, setLexicons] = useState<Results<NsidCount>>({ text: '', items: [] });
  const [searching, setSearching] = useState(false);
  // Live color-scheme preview bookkeeping; see the effect further down.
  const previewingRef = useRef(false);
  const savedSchemeRef = useRef(prefs.colorScheme);

  // Drive the native modal from the `open` prop.
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  // Reset + focus whenever the palette opens (or is re-aimed at a list while
  // open). The state resets live inside the timer callback (not synchronously
  // in the effect body) to stay clear of the set-state-in-effect lint rule —
  // the dialog has just been shown, so a one-tick-later reset is imperceptible.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      setQuery('');
      setHighlight(0);
      setList(initialList);
      setHistory(readSearchHistory());
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, initialList]);

  // Mirror native `close` (Escape / dlg.close()) back to the parent.
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const handleClose = () => onClose();
    dlg.addEventListener('close', handleClose);
    return () => dlg.removeEventListener('close', handleClose);
  }, [onClose]);

  const { mode, text } = parsePaletteQuery(query);
  const atRoot = list === null;
  const peopleText = atRoot && wantsPeopleSearch(mode, text) ? text.replace(/^@/, '') : '';
  const lexiconText = atRoot && wantsLexiconSearch(mode, text) ? text : '';

  // Debounced people typeahead. Results are stored with the text they answer,
  // so a slow response never paints under a query it wasn't for.
  useEffect(() => {
    if (!open || !peopleText) return;
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      setSearching(true);
      const items = await searchActorsTypeahead(peopleText, {
        limit: PEOPLE_LIMIT,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPeople({ text: peopleText, items });
      setSearching(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [open, peopleText]);

  // Debounced lexicon search (the `#` mode), ranked like the lexicons page:
  // most-created first, so well-known lexicons beat obscure same-prefix ones.
  useEffect(() => {
    if (!open || !lexiconText) return;
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      setSearching(true);
      const results = await searchLexicons(lexiconText, controller.signal);
      if (controller.signal.aborted) return;
      const items = [...results].sort((a, b) => b.creates - a.creates).slice(0, LEXICON_LIMIT);
      setLexicons({ text: lexiconText, items });
      setSearching(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [open, lexiconText]);

  const available = useMemo(() => commands.filter((c) => c.available), [commands]);
  const groupLabel = (id: string) => COMMAND_GROUPS.find((g) => g.id === id)?.label ?? '';

  // --- the profile or record on screen, as the waypoints see it ------------
  const subject = pageContext.subject;

  /**
   * Every app that can open what's on screen: the reader's own waypoint
   * groups first, in their order (custom waypoints included), then the rest
   * of the catalog, so the palette never hides an app the picker would show
   * and still reaches one the reader tucked away.
   */
  const { customWaypoints, waypointGroups } = prefs;
  const waypoints = useMemo(
    () => openInApps(subject, { customWaypoints, waypointGroups }),
    [subject, customWaypoints, waypointGroups],
  );

  const subjectNoun = waypointNoun(waypoints.type);

  // --- row builders ---------------------------------------------------------
  function commandRow(cmd: ResolvedCommand, section: string): Row {
    const Icon = cmd.icon;
    return {
      key: `cmd:${cmd.meta.id}`,
      section,
      icon: <Icon size={16} aria-hidden />,
      label: cmd.meta.label,
      description: cmd.meta.description,
      trailing: cmd.meta.opensList ? (
        <ChevronRight size={14} aria-hidden />
      ) : cmd.bindings[0] ? (
        <Kbd binding={cmd.bindings[0]} platform={platform} />
      ) : cmd.external ? (
        <ArrowUpRight size={14} aria-hidden />
      ) : undefined,
      href: cmd.meta.opensList ? undefined : cmd.href,
      run: ({ newTab }) => {
        if (cmd.meta.opensList) {
          enterList(cmd.meta.opensList);
          return;
        }
        onClose();
        if (newTab && cmd.href) onNavigate(cmd.href, { newTab: true });
        else cmd.run();
      },
    };
  }

  function waypointRow(hit: { waypoint: Waypoint; url: string }, section: string): Row {
    const { waypoint, url } = hit;
    let host = '';
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      /* a custom template can produce a non-URL; show no host */
    }
    return {
      key: `wp:${waypoint.id}`,
      section,
      icon: <span className="cmdk-waypoint-icon">{waypoint.icon}</span>,
      label: `Open in ${waypoint.name}`,
      description: host,
      trailing: <ArrowUpRight size={14} aria-hidden />,
      href: url,
      run: () => {
        onClose();
        onNavigate(url, { newTab: true });
      },
    };
  }

  function recentRow(entry: SearchHistoryEntry, section: string): Row {
    return {
      key: `recent:${entry.path}`,
      section,
      icon: entry.avatar ? <Avatar src={entry.avatar} /> : <Clock size={16} aria-hidden />,
      label: entry.label,
      description: entry.sublabel ?? entry.path,
      href: entry.path,
      run: ({ newTab }) => {
        onClose();
        // Re-picking bumps the count; merge logic keeps the stored avatar.
        recordQueryVisit(entry.label, entry.path);
        onNavigate(entry.path, { newTab });
      },
    };
  }

  function personRow(actor: ActorTypeaheadResult): Row {
    const path = `/explore/${encodeRepo(actor.handle)}`;
    return {
      key: `actor:${actor.did}`,
      section: 'People',
      icon: <Avatar src={actor.avatar} />,
      label: actor.displayName?.trim() || `@${actor.handle}`,
      description: actor.displayName?.trim() ? `@${actor.handle}` : actor.did,
      href: path,
      run: ({ newTab }) => {
        onClose();
        recordActorVisit(actor);
        onNavigate(path, { newTab });
      },
    };
  }

  /** "Go to <text>" for anything that names a place. */
  function gotoRow(raw: string): Row | null {
    const target = resolveSearchTarget(raw);
    if (!target) return null;
    const isPds = target.path.startsWith('/explore/pds/');
    return {
      key: `goto:${target.path}`,
      section: 'Jump to',
      icon: isPds ? <Server size={16} aria-hidden /> : <Search size={16} aria-hidden />,
      label: (
        <>
          {isPds ? 'Open PDS' : 'Go to'} <span className="cmdk-item-query">{raw}</span>
        </>
      ),
      description: isPds ? 'Accounts hosted on this server' : 'Open in the explorer',
      href: target.path,
      run: ({ newTab }) => {
        onClose();
        if (newTab) {
          // Pop-up blockers drop a window.open that waits on the network, so
          // a new tab takes the synchronous guess.
          recordQueryVisit(raw, target.path);
          onNavigate(target.path, { newTab: true });
          return;
        }
        // The row was built with the synchronous guess (re-resolving on every
        // keystroke would mean a network call per character). Resolve
        // properly now that the user has committed, so an unrecognized URL
        // gets a chance to be identified by its AT Tags.
        void resolveSearchPathAsync(raw).then((path) => {
          const dest = path || target.path;
          recordQueryVisit(raw, dest);
          onNavigate(dest);
        });
      },
    };
  }

  function lexiconRow(nsid: string, count?: number): Row {
    const path = lexiconPathFor(nsid);
    return {
      key: `lex:${nsid}`,
      section: 'Lexicons',
      icon: <Braces size={16} aria-hidden />,
      label: count === undefined ? (
        <>
          Open lexicon <span className="cmdk-item-query">{nsid}</span>
        </>
      ) : (
        <span className="cmdk-item-mono">{nsid}</span>
      ),
      description:
        count === undefined ? 'Schema, activity and recent records' : `${formatCount(count)} records created`,
      href: path,
      run: ({ newTab }) => {
        onClose();
        onNavigate(path, { newTab });
      },
    };
  }

  function namespaceRow(term: string): Row {
    const path = groupPathFor(term);
    return {
      key: `ns:${term}`,
      section: 'Lexicons',
      icon: <FolderTree size={16} aria-hidden />,
      label: (
        <>
          Browse <span className="cmdk-item-query">{term}</span>
        </>
      ),
      description: 'Every lexicon under this namespace',
      href: path,
      run: ({ newTab }) => {
        onClose();
        onNavigate(path, { newTab });
      },
    };
  }

  function schemeRow(value: ColorScheme, label: string, hint: string): Row {
    const current = prefs.colorScheme === value;
    return {
      key: `scheme:${value}`,
      section: 'Color schemes',
      icon: (
        <span className="scheme-swatch cmdk-swatch" data-scheme={value} aria-hidden>
          <span />
          <span />
        </span>
      ),
      label: `Color scheme: ${label}`,
      description: hint,
      trailing: current ? <Check size={14} aria-hidden /> : undefined,
      scheme: value,
      run: () => {
        // The preference update and the close land in one render, so the
        // preview effect's revert below reads the scheme just chosen.
        applyColorScheme(value);
        update((p) => (p.colorScheme === value ? p : { ...p, colorScheme: value }));
        onClose();
      },
    };
  }

  // --- assemble -------------------------------------------------------------
  // Rebuilt every render, deliberately: the palette re-renders per keystroke
  // and per highlight move anyway, the catalog is a few dozen rows, and the
  // one costly input (every waypoint's getUrl) is memoized above.
  function buildRows(): Row[] {
    const out: Row[] = [];

    if (list === 'open-in') {
      const all = [
        ...waypoints.mine.map((h) => waypointRow(h, 'Your waypoints')),
        ...waypoints.more.map((h) => waypointRow(h, 'More apps')),
      ];
      const matched = text
        ? all
            .map((r) => ({ r, s: matchScore(text, String(r.label).replace(/^Open in /, ''), [], String(r.description ?? '')) }))
            .filter((x) => x.s >= 0)
            .sort((a, b) => b.s - a.s)
            .map((x) => ({ ...x.r, section: 'Apps' }))
        : all;
      out.push(...matched);
      const picker = subject ? universalPathFor(subject) : null;
      if (picker && pageContext.surface === 'explorer' && !text) {
        out.push({
          key: 'picker',
          section: 'More apps',
          icon: <ChevronRight size={16} aria-hidden />,
          label: 'Show the waypoint picker',
          description: 'Every app, grouped, with previews',
          href: picker,
          run: ({ newTab }) => {
            onClose();
            onNavigate(picker, { newTab });
          },
        });
      }
      return out;
    }

    if (list === 'color-scheme') {
      for (const s of COLOR_SCHEMES) {
        if (text && matchScore(text, s.label, [s.value], s.hint) < 0) continue;
        out.push({ ...schemeRow(s.value, s.label, s.hint), label: s.label, section: 'Color schemes' });
      }
      return out;
    }

    // Root.
    if (mode === 'people') {
      if (people.text === peopleText) out.push(...people.items.map(personRow));
      if (looksLikeTarget(text)) {
        const row = gotoRow(text.replace(/^@/, ''));
        if (row) out.push(row);
      }
      return out;
    }

    if (mode === 'lexicons') {
      // The lexicons page's own rule: an exact match opens that lexicon,
      // anything else browses the namespace, so whichever applies leads.
      const results = lexicons.text === lexiconText ? lexicons.items : [];
      const exact = results.find((l) => l.nsid === text);
      if (exact) out.push(lexiconRow(exact.nsid, exact.creates));
      if (lexiconText) out.push(namespaceRow(text));
      out.push(...results.filter((l) => l !== exact).map((l) => lexiconRow(l.nsid, l.creates)));
      return out;
    }

    if (!text) {
      // Empty root: what you can do here, where you've been, then the rest
      // of the catalog in group order.
      const page = available.filter((c) => c.meta.group === 'page');
      out.push(...page.map((c) => commandRow(c, groupLabel('page'))));
      if (mode === 'all') {
        out.push(...getRecents(history, RECENTS_EMPTY).map((e) => recentRow(e, 'Recent')));
      }
      for (const group of COMMAND_GROUPS) {
        if (group.id === 'page') continue;
        for (const c of available) {
          if (c.meta.group === group.id) out.push(commandRow(c, group.label));
        }
      }
      return out;
    }

    // Typed root query.
    if (mode === 'all') {
      const lex = nsidLikelihood(text);
      const goto = looksLikeTarget(text) ? gotoRow(text) : null;
      if (lex === 'likely') out.push({ ...lexiconRow(text), section: 'Jump to' });
      if (goto) out.push(goto);
      if (lex === 'possible') out.push({ ...lexiconRow(text), section: 'Jump to' });
    }

    const scored = available
      .map((c) => ({
        c,
        s: matchScore(text, c.meta.label, c.meta.keywords, groupLabel(c.meta.group)),
      }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s);
    out.push(...scored.map((x) => commandRow(x.c, 'Commands')));

    if (mode !== 'all') return out;

    // Direct "Open in X" rows, so "bluesky" on a post opens it in Bluesky
    // without drilling into the list first.
    const wpMatched = [...waypoints.mine, ...waypoints.more]
      .map((h) => ({ h, s: matchScore(text, h.waypoint.name, ['open', 'in']) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, WAYPOINTS_MATCHED);
    out.push(...wpMatched.map((x) => waypointRow(x.h, `Open this ${subjectNoun} in`)));

    for (const s of COLOR_SCHEMES) {
      if (matchScore(text, s.label, [s.value]) >= 0) out.push(schemeRow(s.value, s.label, s.hint));
    }

    const recents = history
      .map((e) => ({ e, s: matchScore(text, e.label, [e.handle ?? '', e.sublabel ?? '']) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || b.e.lastVisited - a.e.lastVisited)
      .slice(0, RECENTS_MATCHED);
    out.push(...recents.map((x) => recentRow(x.e, 'Recent')));

    if (people.text === peopleText) {
      const shown = new Set(recents.map((x) => x.e.did).filter(Boolean));
      out.push(...people.items.filter((a) => !shown.has(a.did)).map(personRow));
    }

    // Nothing else? Offer the jump anyway, as the palette always has, so a
    // bare word still has somewhere to go.
    if (out.length === 0 && text.length >= 2 && !/\s/.test(text)) {
      const row = gotoRow(text);
      if (row) out.push(row);
    }
    return out;
  }
  const rows = buildRows();

  // Keep the highlight in range as the filtered list shrinks/grows.
  const activeIndex = rows.length === 0 ? -1 : Math.min(highlight, rows.length - 1);
  const activeRow = activeIndex >= 0 ? rows[activeIndex] : undefined;

  // Scroll the active row into view on selection changes.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  // Live preview while browsing color schemes: the highlighted scheme paints
  // the page, and leaving without choosing puts the saved one back. The ref
  // keeps the revert from firing when no preview ever happened, which would
  // otherwise paint the default over a scheme still loading from the PDS.
  useEffect(() => {
    savedSchemeRef.current = prefs.colorScheme;
  }, [prefs.colorScheme]);
  const previewScheme = open && list === 'color-scheme' ? activeRow?.scheme ?? null : null;
  useEffect(() => {
    if (previewScheme) {
      applyColorScheme(previewScheme);
      previewingRef.current = true;
      return;
    }
    if (previewingRef.current) {
      previewingRef.current = false;
      applyColorScheme(savedSchemeRef.current);
    }
  }, [previewScheme]);

  function enterList(next: PaletteList) {
    setList(next);
    setQuery('');
    setHighlight(0);
  }

  function leaveList() {
    setList(null);
    setQuery('');
    setHighlight(0);
  }

  function runRow(row: Row | undefined, newTab = false) {
    row?.run({ newTab: newTab && Boolean(row.href) });
  }

  // The palette's own binding(s) with a modifier close it again, so ⌘K
  // toggles. Bare-key bindings (`/`) are text in here, not a toggle.
  const toggleSteps = useMemo(
    () =>
      commands
        .find((c) => c.meta.id === 'command-palette')
        ?.bindings.map(parseBinding)
        .filter((steps) => steps.length === 1 && steps[0].includes('+'))
        .map((steps) => steps[0]) ?? [],
    [commands],
  );

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const step = eventToStep(e.nativeEvent, platform);
    const mod = platform === 'mac' ? e.metaKey : e.ctrlKey;
    const down = e.key === 'ArrowDown' || (e.ctrlKey && !e.metaKey && e.key === 'n');
    const up = e.key === 'ArrowUp' || (e.ctrlKey && !e.metaKey && e.key === 'p');

    if (step && toggleSteps.includes(step)) {
      e.preventDefault();
      onClose();
    } else if (down) {
      e.preventDefault();
      if (rows.length === 0) return;
      setHighlight((i) => (Math.min(i, rows.length - 1) + 1) % rows.length);
    } else if (up) {
      e.preventDefault();
      if (rows.length === 0) return;
      setHighlight((i) => {
        const cur = Math.min(i, rows.length - 1);
        return cur <= 0 ? rows.length - 1 : cur - 1;
      });
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      if (rows.length === 0) return;
      const jump = e.key === 'PageDown' ? 8 : -8;
      setHighlight((i) => Math.max(0, Math.min(rows.length - 1, Math.min(i, rows.length - 1) + jump)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runRow(activeRow, mod);
    } else if (e.key === 'Escape' && (query || list)) {
      // First Escape clears the query, the next steps out of a list, and
      // only then does one close the palette.
      e.preventDefault();
      if (query) {
        setQuery('');
        setHighlight(0);
      } else {
        leaveList();
      }
    } else if (e.key === 'Backspace' && !query && list) {
      e.preventDefault();
      leaveList();
    }
  }

  const placeholder =
    list === 'open-in'
      ? `Open this ${subjectNoun} in…`
      : list === 'color-scheme'
        ? 'Pick a color scheme…'
        : mode === 'people'
          ? 'Search people by name or handle…'
          : mode === 'lexicons'
            ? 'Search lexicons by NSID or namespace…'
            : 'Search commands, people and lexicons, or paste a link…';

  const emptyMessage = (() => {
    if (searching && (peopleText || lexiconText)) return 'Searching…';
    if (list === 'open-in') return text ? 'No app matches.' : 'No app can open this.';
    if (mode === 'people') return 'Type a name or handle.';
    if (mode === 'lexicons') return 'Type an NSID or a namespace, like app.bsky or community.lexicon.';
    if (mode === 'commands') return 'No matching commands.';
    return 'No matches.';
  })();

  const listLabel = list === 'open-in' ? 'Open in' : list === 'color-scheme' ? 'Color scheme' : null;
  const modKey = platform === 'mac' ? '⌘' : 'Ctrl';

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
          {listLabel ? (
            <button
              type="button"
              className="cmdk-scope"
              onClick={() => {
                leaveList();
                inputRef.current?.focus();
              }}
              aria-label={`Back to all commands (leave ${listLabel})`}
              title="Back (Backspace)"
            >
              <ArrowLeft size={13} aria-hidden />
              <span>{listLabel}</span>
            </button>
          ) : (
            <Search size={16} aria-hidden className="cmdk-search-icon" />
          )}
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
            placeholder={placeholder}
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
          {rows.length === 0 && <div className="cmdk-empty">{emptyMessage}</div>}
          {rows.map((row, i) => {
            const isActive = i === activeIndex;
            const showHeader = i === 0 || rows[i - 1].section !== row.section;
            return (
              <Fragment key={row.key}>
                {showHeader && (
                  <div className="cmdk-group-label" role="presentation">
                    {row.section}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  id={`cmdk-item-${i}`}
                  data-idx={i}
                  aria-selected={isActive}
                  className={`cmdk-item ${isActive ? 'is-active' : ''}`}
                  onMouseMove={() => {
                    if (highlight !== i) setHighlight(i);
                  }}
                  onClick={(e) => runRow(row, platform === 'mac' ? e.metaKey : e.ctrlKey)}
                  onAuxClick={(e) => {
                    // Middle click: a new tab, as on any link.
                    if (e.button === 1 && row.href) {
                      e.preventDefault();
                      runRow(row, true);
                    }
                  }}
                >
                  <span className="cmdk-item-icon">{row.icon}</span>
                  <span className="cmdk-item-body">
                    <span className="cmdk-item-label">{row.label}</span>
                    {row.description && (
                      <span className="cmdk-item-desc">{row.description}</span>
                    )}
                  </span>
                  {row.trailing ? (
                    <span className="cmdk-item-kbd">{row.trailing}</span>
                  ) : isActive ? (
                    <CornerDownLeft size={14} aria-hidden className="cmdk-item-enter" />
                  ) : null}
                </button>
              </Fragment>
            );
          })}
          {rows.length > 0 && searching && (peopleText || lexiconText) && (
            <div className="cmdk-status" role="status">
              Searching…
            </div>
          )}
        </div>

        <div className="cmdk-footer">
          {atRoot ? (
            <span className="cmdk-modes" aria-label="Search modes">
              {PALETTE_PREFIXES.map(({ prefix, mode: m, label }) => (
                <button
                  key={prefix}
                  type="button"
                  className={`cmdk-mode ${mode === m ? 'is-active' : ''}`}
                  aria-pressed={mode === m}
                  onClick={() => {
                    setQuery(mode === m ? text : `${prefix}${text}`);
                    setHighlight(0);
                    inputRef.current?.focus();
                  }}
                  title={`Type ${prefix} to search ${label} only`}
                >
                  <kbd className="kbd">{prefix}</kbd>
                  <span>{label}</span>
                </button>
              ))}
            </span>
          ) : (
            <span className="cmdk-hint">
              <kbd className="kbd">⌫</kbd>
              <span>back</span>
            </span>
          )}
          <span className="cmdk-hint">
            <kbd className="kbd">↵</kbd>
            <span>run</span>
          </span>
          {activeRow?.href && (
            <span className="cmdk-hint">
              <kbd className="kbd">{modKey}</kbd>
              <kbd className="kbd">↵</kbd>
              <span>new tab</span>
            </span>
          )}
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

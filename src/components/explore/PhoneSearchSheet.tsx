'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  Braces,
  ChevronRight,
  ClipboardPaste,
  Clock,
  FileText,
  LayoutGrid,
  LoaderCircle,
  Search,
  Server,
  User,
} from 'lucide-react';
import {
  closePhoneSearch,
  getPhoneSearchActions,
  getPhoneSearchOwner,
  getPhoneSearchServerOwner,
  getPhoneSearchServerState,
  getPhoneSearchState,
  isCurrentPath,
  setPhoneSearchPrimary,
  subscribePhoneSearch,
} from '@/lib/phoneSearch';
import { motionAllowed } from '@/lib/motion';
import { looksLikeTarget, matchScore, nsidLikelihood, wantsPeopleSearch } from '@/lib/paletteSearch';
import { atUriFor, pageContextFromPath, universalPathFor, type PageSubject } from '@/lib/pageContext';
import { openInApps, waypointNoun } from '@/lib/openInApps';
import { resolveSearchTarget } from '@/utils/atproto/searchRouting';
import { encodeRepo } from '@/utils/atproto/urls';
import { searchActorsTypeahead, type ActorTypeaheadResult } from '@/utils/atproto/appview';
import { lexiconPathFor } from '@/utils/ufos/nsid';
import {
  getRecents,
  readSearchHistory,
  recordActorVisit,
  recordQueryVisit,
  type SearchHistoryEntry,
} from '@/utils/searchHistory';
import { usePreferences } from '../PreferencesProvider';
import { useKeyboardShortcuts } from '../KeyboardShortcutsProvider';

/**
 * The phone's search sheet: what fills the screen above the bottom toolbar
 * while its jump field is in use.
 *
 * It exists for the strip between the toolbar and the keyboard. On iOS 26
 * and later, with the keyboard up, Safari stands the toolbar on its address
 * pill and draws that strip itself, behind the pill and the keyboard's
 * up / down / done bar, from the page's own scrolling content. Nothing fixed
 * on top of the page reaches it, the toolbar included, so the page showed
 * through under the bar. While the sheet is open the page is hidden
 * (chrome.css, Phone search sheet) and the strip shows the root's plain
 * background instead. Something has to take the page's place above the bar,
 * and search results are the useful thing to put there, as Safari does with
 * its own address bar.
 *
 * The field stays in the toolbar and keeps focus, so the keyboard comes up
 * from the tap that opened this. The menu button turns into Close
 * (SiteMenuButton), Back and Home fold away, and the sheet stays open when
 * the keyboard is put away, until Close, Escape or a navigation.
 *
 * Results come from the same places as the command palette's (recent jumps,
 * the people typeahead, "Go to" routing, the waypoint catalog) but not its
 * commands: this is a way to go somewhere. Lists are bottom-anchored, so a
 * short one sits next to the field, and the row the keyboard's Search key
 * runs is drawn filled.
 *
 * Motion (chrome.css): the sheet dissolves in over the page and its blocks
 * rise into place from the field upwards; the page is hidden once the sheet
 * covers it. A picked result keeps the sheet up, with a spinner on its row,
 * until the next page lands, and the sheet then fades out over that page
 * rather than over the old one. That is why the sheet is drawn by
 * <PhoneSearchHost> in the root layout and not by the field: the field
 * belongs to a page's toolbar, which goes when the page does.
 */

const SEARCH_DEBOUNCE_MS = 180;
const PEOPLE_LIMIT = 5;
/** Recent jumps shown before anything is typed, and matched while typing. */
const RECENTS_EMPTY = 5;
const RECENTS_MATCHED = 3;
/** Apps listed for a recognised link before "All apps" takes over. */
const APPS_SHOWN = 4;

/**
 * How long the sheet stays mounted once closed: its blocks sink (160ms),
 * then it fades (200ms, starting 60ms in). chrome.css, Phone search sheet.
 */
const SHEET_EXIT_MS = 280;

/** Quick links under the recents, with the short names a chip has room for. */
const QUICK_LINKS: { id: string; label: string }[] = [
  { id: 'go-explore', label: 'Explorer' },
  { id: 'go-lexicons', label: 'Lexicons' },
  { id: 'go-my-repo', label: 'My repo' },
  { id: 'go-spaces', label: 'Spaces' },
];

/** The sheet's id, for the field's aria-controls. There is only ever one. */
export const PHONE_SEARCH_SHEET_ID = 'fn-search-sheet';

/** Which field owns the sheet, if any (src/lib/phoneSearch.ts). */
export function usePhoneSearchOwner(): string | null {
  return useSyncExternalStore(subscribePhoneSearch, getPhoneSearchOwner, getPhoneSearchServerOwner);
}

/**
 * Draws the sheet for whichever field opens it. Mounted once, in the root
 * layout, so the sheet outlives the page it was opened on.
 */
export default function PhoneSearchHost() {
  const { owner, query } = useSyncExternalStore(
    subscribePhoneSearch,
    getPhoneSearchState,
    getPhoneSearchServerState,
  );
  const pathname = usePathname();

  // Landing on another page is the end of the search; the sheet fades out
  // over the page it led to.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    closePhoneSearch();
  }, [pathname]);

  // Kept mounted through its way out. Worked out during render, as React
  // adjusts state to a changed input, so the render that sees it close
  // already keeps the sheet rather than dropping it for a frame.
  const [prevOwner, setPrevOwner] = useState(owner);
  const [leaving, setLeaving] = useState(false);
  if (owner !== prevOwner) {
    setPrevOwner(owner);
    setLeaving(owner === null && prevOwner !== null && motionAllowed());
  }
  useEffect(() => {
    if (!leaving) return undefined;
    const t = window.setTimeout(() => setLeaving(false), SHEET_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);

  if (owner === null && !leaving) return null;
  return <PhoneSearchSheet query={query} leaving={owner === null} />;
}

type SheetRow = {
  key: string;
  /** Contents of the leading tile. */
  icon: ReactNode;
  /** A round tile, for a person. */
  round?: boolean;
  label: ReactNode;
  detail?: string;
  /** The detail is an identifier (a handle, an at:// URI): set in mono. */
  mono?: boolean;
  end?: ReactNode;
  /** A page on this site, with what to record when it's picked. */
  href?: string;
  record?: () => void;
  /** An app's own page, opened in a new tab as the palette does. */
  external?: string;
  /** What a row that is neither runs. */
  action?: () => void;
  /** What the keyboard's Search key runs. */
  primary?: boolean;
};

type Section = { key: string; title: string; rows: SheetRow[] };

function Avatar({ src, fallback }: { src?: string; fallback: ReactNode }) {
  if (!src) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={32} height={32} className="fn-search-avatar" />;
}

/** The icon a recent jump gets when it has no avatar, by where it went. */
function recentIcon(path: string): ReactNode {
  if (path.startsWith('/explore/pds/')) return <Server size={16} aria-hidden />;
  if (path.startsWith('/explore/lexicons')) return <Braces size={16} aria-hidden />;
  const subject = pageContextFromPath(path).subject;
  if (subject?.rkey) return <FileText size={16} aria-hidden />;
  if (subject && !subject.collection) return <User size={16} aria-hidden />;
  return <Clock size={16} aria-hidden />;
}

/** "Post by alice.example.com", or the handle alone for a repo. */
function subjectLabel(subject: PageSubject): string {
  if (subject.rkey) {
    if (subject.collection === 'app.bsky.feed.post') return `Post by ${subject.repo}`;
    if (subject.collection === 'app.bsky.graph.list') return `List by ${subject.repo}`;
    return `Record by ${subject.repo}`;
  }
  if (subject.collection) return `${subject.collection} in ${subject.repo}`;
  return subject.repo;
}

/** A block's place in the entrance, counted up from the field. */
function stagger(i: number): CSSProperties {
  return { '--i': i } as CSSProperties;
}

function PhoneSearchSheet({ query, leaving }: { query: string; leaving: boolean }) {
  const router = useRouter();
  const { prefs } = usePreferences();
  const { commands } = useKeyboardShortcuts();
  // Read once per opening; the host mounts the sheet each time it opens.
  const [history] = useState<SearchHistoryEntry[]>(() => readSearchHistory());
  const [people, setPeople] = useState<{ text: string; items: ActorTypeaheadResult[] }>({
    text: '',
    items: [],
  });
  // The row picked and on its way, shown with a spinner until the page lands.
  const [pending, setPending] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const actions = getPhoneSearchActions();

  const text = query.trim();
  const peopleText = wantsPeopleSearch('all', text) ? text.replace(/^@/, '') : '';

  // Typing on after a pick that never landed starts over.
  useEffect(() => {
    setPending(null);
  }, [text]);

  // Debounced people typeahead, keyed by the text it answers, as the
  // palette's is, so a slow response never lands under a newer query.
  useEffect(() => {
    if (!peopleText) return undefined;
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      const items = await searchActorsTypeahead(peopleText, {
        limit: PEOPLE_LIMIT,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setPeople({ text: peopleText, items });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [peopleText]);

  // Where the text goes, when it names a place, and what it is there.
  const target = useMemo(() => (looksLikeTarget(text) ? resolveSearchTarget(text) : null), [text]);
  const subject = useMemo(
    () =>
      target && !target.path.startsWith('/explore/pds/')
        ? pageContextFromPath(target.path).subject
        : null,
    [target],
  );
  const { customWaypoints, waypointGroups } = prefs;
  const apps = useMemo(
    () => openInApps(subject, { customWaypoints, waypointGroups }),
    [subject, customWaypoints, waypointGroups],
  );

  const quickLinks = QUICK_LINKS.flatMap(({ id: cmdId, label }) => {
    const cmd = commands.find((c) => c.meta.id === cmdId);
    if (!cmd?.available || !cmd.href) return [];
    return [{ key: cmdId, label, href: cmd.href, Icon: cmd.icon }];
  });

  /** A pick of a page on this site: record it, then wait for it to land. */
  const follow = (key: string, href: string, record?: () => void) => {
    record?.();
    if (isCurrentPath(href)) closePhoneSearch();
    else setPending(key);
  };

  const jump = () => {
    if (!actions) return;
    setPending('jump');
    void actions.jump(query).then((went) => {
      if (!went) setPending(null);
    });
  };

  const recentRow = (entry: SearchHistoryEntry): SheetRow => ({
    key: `recent:${entry.path}`,
    icon: <Avatar src={entry.avatar} fallback={recentIcon(entry.path)} />,
    round: !!entry.avatar,
    label: entry.label,
    // Usually `@handle`, else where it went: an identifier either way.
    detail: entry.sublabel ?? entry.path,
    mono: true,
    end: <ChevronRight size={16} aria-hidden />,
    href: entry.path,
    // Re-picking bumps the count; the merge keeps the stored avatar.
    record: () => recordQueryVisit(entry.label, entry.path),
  });

  const personRow = (actor: ActorTypeaheadResult): SheetRow => {
    const name = actor.displayName?.trim();
    return {
      key: `actor:${actor.did}`,
      icon: <Avatar src={actor.avatar} fallback={<User size={16} aria-hidden />} />,
      round: true,
      label: name || `@${actor.handle}`,
      detail: name ? `@${actor.handle}` : actor.did,
      mono: true,
      end: <ChevronRight size={16} aria-hidden />,
      href: `/explore/${encodeRepo(actor.handle)}`,
      record: () => recordActorVisit(actor),
    };
  };

  // Keyed by kind rather than destination, so the row stays put (and
  // doesn't replay its entrance) as each keystroke changes where it goes.
  const jumpRow = (): SheetRow | null => {
    // A bare word (no dot, no scheme) only guesses at a handle, so it keeps
    // the plain "Go to" wording rather than being named as a repo.
    const dest = target ?? resolveSearchTarget(text);
    if (!dest) return null;
    const isPds = dest.path.startsWith('/explore/pds/');
    let label: ReactNode = (
      <>
        Go to <span className="fn-search-query">{text}</span>
      </>
    );
    let detail = 'Open in the explorer';
    let mono = false;
    if (isPds) {
      label = (
        <>
          Open PDS <span className="fn-search-query">{text}</span>
        </>
      );
      detail = 'Accounts hosted on this server';
    } else if (subject) {
      label = subjectLabel(subject);
      detail = atUriFor(subject);
      mono = true;
    }
    return {
      key: 'jump',
      icon: isPds ? <Server size={18} aria-hidden /> : <Search size={18} aria-hidden />,
      label,
      detail,
      mono,
      end: <ChevronRight size={18} aria-hidden />,
      action: jump,
      primary: true,
    };
  };

  const lexiconRow = (): SheetRow => ({
    key: 'lex',
    icon: <Braces size={16} aria-hidden />,
    label: (
      <>
        Open lexicon <span className="fn-search-query">{text}</span>
      </>
    ),
    detail: 'Schema, activity and recent records',
    end: <ChevronRight size={16} aria-hidden />,
    href: lexiconPathFor(text),
  });

  // --- assemble, top to bottom; the end of the list sits by the field ------
  const sections: Section[] = [];
  if (!text) {
    const recents = getRecents(history, RECENTS_EMPTY);
    if (recents.length) sections.push({ key: 'recent', title: 'Recent', rows: recents.map(recentRow) });
  } else {
    const recents = history
      .map((e) => ({ e, s: matchScore(text, e.label, [e.handle ?? '', e.sublabel ?? '']) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || b.e.lastVisited - a.e.lastVisited)
      .slice(0, RECENTS_MATCHED)
      .map((x) => x.e);
    if (recents.length) sections.push({ key: 'recent', title: 'Recent', rows: recents.map(recentRow) });

    const shown = new Set(recents.map((e) => e.did).filter(Boolean));
    const found =
      people.text === peopleText && peopleText ? people.items.filter((a) => !shown.has(a.did)) : [];
    if (found.length) sections.push({ key: 'people', title: 'People', rows: found.map(personRow) });

    const allApps = [...apps.mine, ...apps.more];
    if (subject && allApps.length) {
      const rows: SheetRow[] = allApps.slice(0, APPS_SHOWN).map(({ waypoint, url }) => {
        let host = '';
        try {
          host = new URL(url).hostname.replace(/^www\./, '');
        } catch {
          /* a custom template can produce a non-URL; show no host */
        }
        return {
          key: `app:${waypoint.id}`,
          icon: <span className="fn-search-app-icon">{waypoint.icon}</span>,
          label: waypoint.name,
          detail: host,
          end: <ArrowUpRight size={16} aria-hidden />,
          external: url,
        };
      });
      const picker = universalPathFor(subject);
      if (picker && allApps.length > APPS_SHOWN) {
        rows.push({
          key: 'app:all',
          icon: <LayoutGrid size={16} aria-hidden />,
          label: `All ${allApps.length} apps`,
          detail: 'The waypoint picker, grouped, with previews',
          end: <ChevronRight size={16} aria-hidden />,
          href: picker,
        });
      }
      sections.push({ key: 'apps', title: `Open this ${waypointNoun(apps.type)} in`, rows });
    }

    // Jump to: the target itself, nearest the field. A bare word that
    // matched nothing else still gets the jump, as the palette's does, so
    // there is always somewhere to go.
    const jumps: SheetRow[] = [];
    const lex = nsidLikelihood(text);
    if (lex === 'likely') jumps.push(lexiconRow());
    const jumpable = target || (sections.length === 0 && text.length >= 2 && !/\s/.test(text));
    const jumpTo = jumpable ? jumpRow() : null;
    if (jumpTo) jumps.push(jumpTo);
    if (lex === 'possible') jumps.push(lexiconRow());
    if (jumps.length) sections.push({ key: 'jump', title: 'Jump to', rows: jumps });
  }

  // The Search key runs the jump when there is one, else the first person:
  // "sam" then Search should open Sam, not guess at a repo called "sam".
  let primary = sections.flatMap((s) => s.rows).find((r) => r.primary) ?? null;
  if (!primary) {
    const firstPerson = sections.find((s) => s.key === 'people')?.rows[0];
    if (firstPerson) {
      firstPerson.primary = true;
      primary = firstPerson;
    }
  }

  // Typed text that matched nothing gets a hint, once the people search for
  // it, if any, has answered.
  const waiting = !!peopleText && people.text !== peopleText;
  const showHint = !!text && sections.length === 0 && !waiting;

  useEffect(() => {
    if (leaving || !primary) {
      setPhoneSearchPrimary(null);
      return;
    }
    const row = primary;
    setPhoneSearchPrimary(() => {
      if (row.href) {
        follow(row.key, row.href, row.record);
        router.push(row.href);
      } else {
        row.action?.();
      }
    });
  });
  useEffect(() => () => setPhoneSearchPrimary(null), []);

  // Keep the end of the list, the part beside the field, in view: as the
  // keyboard comes up and shrinks the sheet, and as results arrive, unless
  // the reader has scrolled up to look at something.
  useEffect(() => {
    const el = scrollRef.current;
    const body = el?.firstElementChild;
    if (!el || !body) return undefined;
    const onScroll = () => {
      pinnedRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    };
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    observer.observe(body);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  // A new query starts at the end again.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
  }, [text]);

  const renderRow = (row: SheetRow) => {
    const busy = pending === row.key;
    const className = `fn-search-row${row.primary ? ' is-primary' : ''}${busy ? ' is-pending' : ''}`;
    const body = (
      <>
        <span className={`fn-search-tile${row.round ? ' is-round' : ''}`}>{row.icon}</span>
        <span className="fn-search-text">
          <span className="fn-search-label">{row.label}</span>
          {row.detail && (
            <span className={`fn-search-detail${row.mono ? ' is-mono' : ''}`}>{row.detail}</span>
          )}
        </span>
        {(row.end || busy) && (
          <span className="fn-search-end">
            {busy ? <LoaderCircle size={16} aria-hidden className="explore-spin" /> : row.end}
          </span>
        )}
      </>
    );
    if (row.href) {
      const href = row.href;
      return (
        <Link
          href={href}
          prefetch={false}
          className={className}
          aria-busy={busy || undefined}
          onClick={() => follow(row.key, href, row.record)}
        >
          {body}
        </Link>
      );
    }
    if (row.external) {
      return (
        <a href={row.external} target="_blank" rel="noopener noreferrer" className={className}>
          {body}
        </a>
      );
    }
    return (
      <button type="button" className={className} aria-busy={busy || undefined} onClick={row.action}>
        {body}
      </button>
    );
  };

  // The blocks, top to bottom, each with its place counted up from the
  // field, which is the order they rise in.
  const blocks: { key: string; node: (i: number) => ReactNode }[] = [];
  if (showHint) {
    blocks.push({
      key: 'hint',
      node: (i) => (
        <p key="hint" className="fn-search-hint fn-search-block" style={stagger(i)}>
          Nothing matches. Try a handle, a DID, an at:// URI or a link from any app.
        </p>
      ),
    });
  }
  for (const section of sections) {
    const headingId = `fn-search-${section.key}`;
    blocks.push({
      key: section.key,
      node: (i) => (
        <section
          key={section.key}
          className="fn-search-section fn-search-block"
          aria-labelledby={headingId}
          style={stagger(i)}
        >
          <h2 id={headingId} className="fn-search-heading">
            {section.title}
          </h2>
          <ul className="fn-search-list">
            {section.rows.map((row) => (
              <li key={row.key}>{renderRow(row)}</li>
            ))}
          </ul>
        </section>
      ),
    });
  }
  if (!text && quickLinks.length > 0) {
    blocks.push({
      key: 'goto',
      node: (i) => (
        <nav
          key="goto"
          className="fn-search-section fn-search-block"
          aria-labelledby="fn-search-goto"
          style={stagger(i)}
        >
          <h2 id="fn-search-goto" className="fn-search-heading">
            Go to
          </h2>
          <div className="fn-search-chips">
            {quickLinks.map(({ key, label, href, Icon }) => (
              <Link
                key={key}
                href={href}
                prefetch={false}
                className={`fn-search-chip${pending === key ? ' is-pending' : ''}`}
                aria-busy={pending === key || undefined}
                onClick={() => follow(key, href)}
              >
                {pending === key ? (
                  <LoaderCircle size={15} aria-hidden className="explore-spin" />
                ) : (
                  <Icon size={15} aria-hidden />
                )}
                {label}
              </Link>
            ))}
          </div>
        </nav>
      ),
    });
  }
  if (!text && actions?.paste) {
    const paste = actions.paste;
    blocks.push({
      key: 'paste',
      node: (i) => (
        <button
          key="paste"
          type="button"
          className="fn-search-row fn-search-paste fn-search-block is-primary"
          style={stagger(i)}
          onClick={paste}
        >
          <span className="fn-search-tile">
            <ClipboardPaste size={18} aria-hidden />
          </span>
          <span className="fn-search-text">
            <span className="fn-search-label">Paste and go</span>
            <span className="fn-search-detail">A handle, DID, at:// URI or any app&rsquo;s link</span>
          </span>
        </button>
      ),
    });
  }

  return createPortal(
    <div
      id={PHONE_SEARCH_SHEET_ID}
      className="fn-search-sheet"
      role="region"
      aria-label="Search"
      ref={scrollRef}
      data-leaving={leaving || undefined}
      inert={leaving}
    >
      <div className="fn-search-body">
        {blocks.map((block, index) => block.node(blocks.length - 1 - index))}
      </div>
    </div>,
    document.body,
  );
}

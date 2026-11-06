'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  Braces,
  ChevronRight,
  ClipboardPaste,
  Clock,
  FileText,
  LayoutGrid,
  Search,
  Server,
  User,
} from 'lucide-react';
import {
  getPhoneSearchOwner,
  getPhoneSearchServerOwner,
  subscribePhoneSearch,
} from '@/lib/phoneSearch';
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
 */

const SEARCH_DEBOUNCE_MS = 180;
const PEOPLE_LIMIT = 5;
/** Recent jumps shown before anything is typed, and matched while typing. */
const RECENTS_EMPTY = 5;
const RECENTS_MATCHED = 3;
/** Apps listed for a recognised link before "Every app" takes over. */
const APPS_SHOWN = 4;

/** Quick links under the recents, with the short names a chip has room for. */
const QUICK_LINKS: { id: string; label: string }[] = [
  { id: 'go-explore', label: 'Explorer' },
  { id: 'go-lexicons', label: 'Lexicons' },
  { id: 'go-my-repo', label: 'My repo' },
  { id: 'go-spaces', label: 'Spaces' },
];

/** Which field owns the sheet, if any (src/lib/phoneSearch.ts). */
export function usePhoneSearchOwner(): string | null {
  return useSyncExternalStore(
    subscribePhoneSearch,
    getPhoneSearchOwner,
    getPhoneSearchServerOwner,
  );
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
  /** A page on this site. */
  href?: string;
  /** An app's own page, opened in a new tab as the palette does. */
  external?: string;
  /** Runs on the pick: bookkeeping before a link navigates, or the action itself for a button. */
  onPick?: () => void;
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

export default function PhoneSearchSheet({
  id,
  query,
  onJump,
  onPaste,
  onDone,
  primaryRef,
}: {
  id: string;
  query: string;
  /** The field's own submit: resolve what was typed and go there. */
  onJump: () => void;
  /** Paste and go, where the browser can read the clipboard. */
  onPaste: (() => void) | null;
  /** Close the sheet: a row was picked. */
  onDone: () => void;
  /** Set to the primary row's action, for the field's submit to run. */
  primaryRef: MutableRefObject<(() => void) | null>;
}) {
  const router = useRouter();
  const { prefs } = usePreferences();
  const { commands } = useKeyboardShortcuts();
  // Read once per opening; the sheet mounts each time the field opens it.
  const [history] = useState<SearchHistoryEntry[]>(() => readSearchHistory());
  const [people, setPeople] = useState<{ text: string; items: ActorTypeaheadResult[] }>({
    text: '',
    items: [],
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  const text = query.trim();
  const peopleText = wantsPeopleSearch('all', text) ? text.replace(/^@/, '') : '';

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
    () => (target && !target.path.startsWith('/explore/pds/') ? pageContextFromPath(target.path).subject : null),
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
    onPick: () => recordQueryVisit(entry.label, entry.path),
  });

  const personRow = (actor: ActorTypeaheadResult): SheetRow => {
    const path = `/explore/${encodeRepo(actor.handle)}`;
    const name = actor.displayName?.trim();
    return {
      key: `actor:${actor.did}`,
      icon: <Avatar src={actor.avatar} fallback={<User size={16} aria-hidden />} />,
      round: true,
      label: name || `@${actor.handle}`,
      detail: name ? `@${actor.handle}` : actor.did,
      mono: true,
      end: <ChevronRight size={16} aria-hidden />,
      href: path,
      onPick: () => recordActorVisit(actor),
    };
  };

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
      key: `jump:${dest.path}`,
      icon: isPds ? <Server size={18} aria-hidden /> : <Search size={18} aria-hidden />,
      label,
      detail,
      mono,
      end: <ChevronRight size={18} aria-hidden />,
      onPick: onJump,
      primary: true,
    };
  };

  const lexiconRow = (): SheetRow => ({
    key: `lex:${text}`,
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
    const found = people.text === peopleText && peopleText ? people.items.filter((a) => !shown.has(a.did)) : [];
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
    const jump =
      target || (sections.length === 0 && text.length >= 2 && !/\s/.test(text)) ? jumpRow() : null;
    if (jump) jumps.push(jump);
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
    if (!primary) {
      primaryRef.current = null;
      return;
    }
    primaryRef.current = () => {
      primary.onPick?.();
      if (primary.href) {
        onDone();
        router.push(primary.href);
      }
    };
  });

  // Keep the end of the list, the part beside the field, in view as the
  // results change underneath a reader typing.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, people.text]);

  const renderRow = (row: SheetRow) => {
    const className = `fn-search-row${row.primary ? ' is-primary' : ''}`;
    const body = (
      <>
        <span className={`fn-search-tile${row.round ? ' is-round' : ''}`}>{row.icon}</span>
        <span className="fn-search-text">
          <span className="fn-search-label">{row.label}</span>
          {row.detail && (
            <span className={`fn-search-detail${row.mono ? ' is-mono' : ''}`}>{row.detail}</span>
          )}
        </span>
        {row.end && <span className="fn-search-end">{row.end}</span>}
      </>
    );
    if (row.href) {
      return (
        <Link
          href={row.href}
          prefetch={false}
          className={className}
          onClick={() => {
            row.onPick?.();
            onDone();
          }}
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
      <button type="button" className={className} onClick={row.onPick}>
        {body}
      </button>
    );
  };

  return createPortal(
    <div id={id} className="fn-search-sheet" role="region" aria-label="Search" ref={scrollRef}>
      <div className="fn-search-body">
        {showHint && (
          <p className="fn-search-hint">
            Nothing matches. Try a handle, a DID, an at:// URI or a link from any app.
          </p>
        )}
        {sections.map((section) => (
          <section key={section.key} className="fn-search-section" aria-labelledby={`${id}-${section.key}`}>
            <h2 id={`${id}-${section.key}`} className="fn-search-heading">
              {section.title}
            </h2>
            <ul className="fn-search-list">
              {section.rows.map((row) => (
                <li key={row.key}>{renderRow(row)}</li>
              ))}
            </ul>
          </section>
        ))}

        {!text && quickLinks.length > 0 && (
          <nav className="fn-search-section" aria-labelledby={`${id}-goto`}>
            <h2 id={`${id}-goto`} className="fn-search-heading">
              Go to
            </h2>
            <div className="fn-search-chips">
              {quickLinks.map(({ key, label, href, Icon }) => (
                <Link key={key} href={href} prefetch={false} className="fn-search-chip" onClick={onDone}>
                  <Icon size={15} aria-hidden />
                  {label}
                </Link>
              ))}
            </div>
          </nav>
        )}

        {!text && onPaste && (
          <button type="button" className="fn-search-row fn-search-paste is-primary" onClick={onPaste}>
            <span className="fn-search-tile">
              <ClipboardPaste size={18} aria-hidden />
            </span>
            <span className="fn-search-text">
              <span className="fn-search-label">Paste and go</span>
              <span className="fn-search-detail">A handle, DID, at:// URI or any app&rsquo;s link</span>
            </span>
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

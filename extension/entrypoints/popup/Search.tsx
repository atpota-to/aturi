import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import { ArrowUpRight, History, Search as SearchGlyph, X } from 'lucide-react';
import { resolveSearchPath } from '@aturi/atproto/searchRouting';
import { encodeRepo } from '@aturi/atproto/urls';
import { ATURI_BASE } from '../../lib/aturiUrl';
import { filterSeen, seenLabel, type SeenRepo } from '../../lib/seenLately';
import { initialOf } from '../../lib/pageRecords';
import { closePopupSoon, openAturi } from './actions';

export const GO_TO_LABEL = 'Go to a handle, DID or at:// URI';

/**
 * The drawer lists five repos at most, so it never grows past the popup's
 * first 600px; the sheet on the no-data page has the room for more.
 */
const DRAWER_SEEN_CAP = 5;
const SHEET_SEEN_CAP = 8;

/** Where the site's go-to field would take the typed text. */
export function goToUrl(text: string): string | null {
  const path = resolveSearchPath(text);
  return path ? `${ATURI_BASE}${path}` : null;
}

function seenHref(entry: SeenRepo): string {
  return `${ATURI_BASE}/explore/${encodeRepo(entry.handle || entry.did || entry.repo)}`;
}

function pagesLabel(count: number): string {
  return `${count} ${count === 1 ? 'page' : 'pages'}`;
}

/**
 * The header search, dropped under the bar over a scrim: the site's go-to
 * field, and beneath it the repos seen lately as suggestions, with a "Go to …
 * on aturi.to" row on top once something is typed. Field and rows are one
 * combobox: the arrows move through the rows, Enter opens the highlighted one
 * or, with none highlighted, goes to the typed text; Esc clears a highlight,
 * then closes. A click on the scrim closes it too.
 */
export function SearchDrawer({
  seen,
  inputRef,
  onClose,
}: {
  seen: SeenRepo[];
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(-1);

  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  const typed = text.trim();
  const go = typed ? goToUrl(typed) : null;
  const rows = filterSeen(seen, typed).slice(0, DRAWER_SEEN_CAP);
  const options = [
    ...(go ? [{ id: 'popup-sugg-go', href: go }] : []),
    ...rows.map((entry, i) => ({ id: `popup-sugg-${i}`, href: seenHref(entry) })),
  ];
  const activeId = active >= 0 ? options[active]?.id : undefined;

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(-1, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = active >= 0 ? options[active]?.href : go;
      if (target) void openAturi(target);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (active >= 0) setActive(-1);
      else onClose();
    }
  }

  const goIndex = go ? 0 : -1;
  const rowOffset = go ? 1 : 0;

  return (
    <>
      <div id="popup-search" className="popup-search" role="search">
        <div className="popup-field">
          <SearchGlyph size={16} aria-hidden />
          <input
            ref={inputRef}
            className="popup-field-input"
            type="text"
            value={text}
            onChange={e => {
              setText(e.currentTarget.value);
              setActive(-1);
            }}
            onKeyDown={onKeyDown}
            placeholder={GO_TO_LABEL}
            aria-label={GO_TO_LABEL}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={options.length > 0}
            aria-controls="popup-sugg"
            aria-activedescendant={activeId}
            aria-describedby="popup-search-hint"
          />
          <button
            type="button"
            className="popup-field-close"
            aria-label="Close search"
            title="Close (Esc)"
            onClick={onClose}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        <span id="popup-search-hint" hidden>
          Enter opens it on aturi.to; Escape closes the search
        </span>
        <div
          id="popup-sugg"
          className="popup-sugg"
          role="listbox"
          aria-label="Suggestions"
          hidden={options.length === 0}
        >
          {go && (
            <a
              id="popup-sugg-go"
              className="popup-sugg-row is-go"
              role="option"
              aria-selected={active === goIndex}
              tabIndex={-1}
              href={go}
              target="_blank"
              rel="noreferrer"
              onClick={closePopupSoon}
            >
              <ArrowUpRight size={15} aria-hidden />
              <span className="popup-sugg-go">
                Go to <span className="popup-sugg-typed">{typed}</span> on aturi.to
              </span>
              <kbd className="popup-kbd" aria-hidden="true">
                Enter
              </kbd>
            </a>
          )}
          {rows.length > 0 && (
            <div role="group" aria-labelledby="popup-sugg-seen" className="popup-sugg-group">
              <div id="popup-sugg-seen" className="popup-sugg-head">
                <History size={13} aria-hidden />
                <span>Seen lately</span>
              </div>
              {rows.map((entry, i) => (
                <a
                  key={entry.repo}
                  id={`popup-sugg-${i}`}
                  className="popup-sugg-row"
                  role="option"
                  aria-selected={active === i + rowOffset}
                  tabIndex={-1}
                  href={seenHref(entry)}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${seenLabel(entry)} on aturi.to`}
                  onClick={closePopupSoon}
                >
                  <span className="popup-icon-letter" aria-hidden="true">
                    {initialOf(seenLabel(entry))}
                  </span>
                  <span className="popup-sugg-handle">{seenLabel(entry)}</span>
                  <span className="popup-sugg-host">{entry.pdsHost ?? ''}</span>
                  <span className="popup-sugg-count">{pagesLabel(entry.count)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="popup-scrim" aria-hidden="true" onClick={onClose} />
    </>
  );
}

/**
 * The go-to field in the no-data card: the one thing to do on a page with
 * nothing to look up, so it takes focus when the popup opens. A faint `/`
 * keycap says how to get back to it; once typed, a row spells out what
 * Enter does.
 */
export function LookupField({
  inputRef,
  autoFocus,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  autoFocus: boolean;
}) {
  const [text, setText] = useState('');
  const typed = text.trim();
  const go = typed ? goToUrl(typed) : null;

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus, inputRef]);

  return (
    <form
      className="popup-lookup"
      role="search"
      onSubmit={e => {
        e.preventDefault();
        if (go) void openAturi(go);
      }}
    >
      <div className="popup-field">
        <SearchGlyph size={16} aria-hidden />
        <input
          ref={inputRef}
          className="popup-field-input"
          type="text"
          name="q"
          value={text}
          onChange={e => setText(e.currentTarget.value)}
          placeholder={GO_TO_LABEL}
          aria-label={GO_TO_LABEL}
          aria-describedby="popup-lookup-hint"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="popup-kbd" aria-hidden="true">
          /
        </kbd>
      </div>
      <span id="popup-lookup-hint" hidden>
        Enter opens it on aturi.to
      </span>
      {go && (
        <a
          className="popup-sugg-row is-go"
          href={go}
          target="_blank"
          rel="noreferrer"
          onClick={closePopupSoon}
        >
          <ArrowUpRight size={15} aria-hidden />
          <span className="popup-sugg-go">
            Go to <span className="popup-sugg-typed">{typed}</span> on aturi.to
          </span>
          <kbd className="popup-kbd" aria-hidden="true">
            Enter
          </kbd>
        </a>
      )}
    </form>
  );
}

/**
 * Seen lately as a sheet of its own: the shipped rows, each opening the repo
 * on aturi.to, with its PDS host and how many pages it turned up on. The
 * count sits inside the link, so the whole row opens the repo.
 */
export function SeenLatelySheet({ seen }: { seen: SeenRepo[] }) {
  if (seen.length === 0) return null;
  return (
    <section className="popup-section is-sheet popup-seen">
      <h2 className="popup-section-label">Seen lately</h2>
      <div className="popup-waypoints">
        {seen.slice(0, SHEET_SEEN_CAP).map(entry => (
          <div className="popup-waypoint" key={entry.repo}>
            <a
              className="popup-waypoint-main"
              href={seenHref(entry)}
              target="_blank"
              rel="noreferrer"
              title={`Open ${seenLabel(entry)} on aturi.to`}
              onClick={closePopupSoon}
            >
              <span className="popup-icon-letter" aria-hidden="true">
                {initialOf(seenLabel(entry))}
              </span>
              <span className="popup-waypoint-name">{seenLabel(entry)}</span>
              <span className="popup-waypoint-desc">{entry.pdsHost ?? ''}</span>
              <span className="popup-repo-count">{pagesLabel(entry.count)}</span>
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}

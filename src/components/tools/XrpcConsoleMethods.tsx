'use client';

import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { Nsid, Segmented } from '@/components/explore/lexicons/primitives';
import {
  familiesOf,
  groupMethods,
  looksLikeMethodNsid,
  nameOf,
  searchMethods,
  type XrpcMethod,
} from '@/lib/tools/xrpc';
import { ToolCard, ToolEmpty, ToolSection, ToolSkeleton, type ToolExample } from './ToolFrame';

/**
 * Choosing a method: the field in the console's head card, and the list of
 * every query underneath it while none is chosen.
 *
 * The field does two jobs, depending on whether a method is open. With none
 * open it filters the list on the page, so the whole index is the result set
 * and nothing covers it. With one open the list is gone, so the same typing
 * drops a short list of matches from the field instead, as the explorer's
 * search does. Either way Enter takes the first match.
 */

/** Matches offered under the field while a method is open. */
const POPOVER_LIMIT = 8;
/** Matches listed on the page while none is. */
const SEARCH_LIMIT = 60;

/**
 * A method typed by its full NSID that the index does not list: a third
 * party's lexicon, or one newer than the index. It can still be opened, and
 * its parameters are read from the lexicon its author published.
 */
function unlistedMethod(methods: XrpcMethod[], query: string): XrpcMethod | null {
  const nsid = query.trim();
  if (!looksLikeMethodNsid(nsid) || methods.some((method) => method.nsid === nsid)) return null;
  return { nsid, type: 'query', description: 'Not in the index. Its lexicon is looked up when you open it.', params: [], raw: '' };
}

export function XrpcMethodPicker({
  methods,
  selected,
  query,
  onQuery,
  onPick,
  examples,
  onExample,
}: {
  /** Undefined while the index is loading. */
  methods: XrpcMethod[] | undefined;
  /** The open method's NSID, or empty. */
  selected: string;
  query: string;
  onQuery: (query: string) => void;
  onPick: (nsid: string) => void;
  examples: ToolExample[];
  onExample: (value: string) => void;
}) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const matches = useMemo(() => {
    if (!methods || !query.trim()) return [];
    const found = searchMethods(methods, query, POPOVER_LIMIT);
    const unlisted = unlistedMethod(methods, query);
    return unlisted ? [unlisted, ...found] : found;
  }, [methods, query]);

  // The drop-down is only for changing an open method. With none open the
  // page's own list is filtered instead.
  const open = Boolean(selected) && focused && query.trim() !== selected && matches.length > 0;
  const active = Math.min(highlight, Math.max(matches.length - 1, 0));

  function pick(nsid: string) {
    setHighlight(0);
    onPick(nsid);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const choice = open ? matches[active] : matches[0];
      if (choice) pick(choice.nsid);
    } else if (event.key === 'Escape' && selected && query !== selected) {
      event.preventDefault();
      onQuery(selected);
    } else if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((active + step + matches.length) % matches.length);
    }
  }

  return (
    <div className="fn-tool-form fn-tool-xrpc-picker">
      <div className="fn-searchbox fn-tool-searchbox">
        <div className="fn-searchbox-field">
          <span aria-hidden className="fn-searchbox-icon fn-tool-searchbox-icon">
            <Search size={17} />
          </span>
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open ? `${listId}-${active}` : undefined}
            aria-label="Find a method by name or by what it does"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="fn-searchbox-input"
            data-mono
            placeholder="getProfile, listRecords…"
            value={query}
            onChange={(event) => {
              setHighlight(0);
              onQuery(event.target.value);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
          />
          {open && (
            <ul id={listId} role="listbox" aria-label="Matching methods" className="fn-searchbox-pop fn-tool-xrpc-pop">
              {matches.map((method, index) => (
                <li
                  key={method.nsid}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  // mousedown beats the input's blur, so the click lands
                  // before the list is taken away.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(method.nsid);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  <span className="fn-tool-xrpc-pop-nsid">
                    <Nsid value={method.nsid} />
                  </span>
                  {method.description && <span className="fn-tool-xrpc-pop-desc">{method.description}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="fn-x-tries fn-tool-tries">
        <span>Try</span>
        {examples.map((example) => (
          <button key={example.value} type="button" className="fn-chip" onClick={() => onExample(example.value)}>
            {example.label ?? example.value}
          </button>
        ))}
      </div>
    </div>
  );
}

function MethodRow({
  method,
  full,
  onPick,
}: {
  method: XrpcMethod;
  /** Show the whole NSID rather than the name, where rows are not under a namespace heading. */
  full?: boolean;
  onPick: (nsid: string) => void;
}) {
  return (
    <li>
      <button type="button" className="fn-tool-xrpc-row" onClick={() => onPick(method.nsid)}>
        <span className="fn-tool-xrpc-row-name">{full ? <Nsid value={method.nsid} /> : nameOf(method.nsid)}</span>
        {method.description && <span className="fn-tool-xrpc-row-desc">{method.description}</span>}
      </button>
    </li>
  );
}

/** Every query in the index: by namespace, or the matches for what was typed. */
export function XrpcMethodCatalog({
  methods,
  query,
  onPick,
}: {
  methods: XrpcMethod[] | undefined;
  query: string;
  onPick: (nsid: string) => void;
}) {
  const [family, setFamily] = useState('all');
  const families = useMemo(() => (methods ? familiesOf(methods) : []), [methods]);
  const options = useMemo(
    () => [{ value: 'all', label: 'All' }, ...families.map((name) => ({ value: name, label: name }))],
    [families],
  );

  if (!methods) {
    return (
      <ToolSection title="Queries">
        <ToolSkeleton rows={6} />
      </ToolSection>
    );
  }

  const text = query.trim();
  if (text) {
    const found = searchMethods(methods, text, SEARCH_LIMIT);
    const unlisted = unlistedMethod(methods, text);
    const rows = unlisted ? [unlisted, ...found] : found;
    return (
      <ToolSection
        title="Matching queries"
        meta={rows.length === 0 ? null : `${found.length}${found.length === SEARCH_LIMIT ? '+' : ''} of ${methods.length}`}
      >
        {rows.length === 0 ? (
          <ToolEmpty>
            No query matches <code>{text}</code>. A method outside this index can still be opened by typing its full
            NSID.
          </ToolEmpty>
        ) : (
          <ToolCard flush>
            <ul className="fn-tool-xrpc-rows">
              {rows.map((method) => (
                <MethodRow key={method.nsid} method={method} full onPick={onPick} />
              ))}
            </ul>
          </ToolCard>
        )}
      </ToolSection>
    );
  }

  const shown = family === 'all' ? methods : methods.filter((method) => method.nsid.startsWith(`${family}.`));
  const groups = groupMethods(shown);
  return (
    <ToolSection title="Queries" meta={`${shown.length} methods`}>
      <div className="fn-tool-bar fn-tool-xrpc-families">
        <Segmented ariaLabel="Namespace" options={options} value={family} onChange={setFamily} />
      </div>
      <div className="fn-tool-xrpc-groups">
        {groups.map((group) => (
          <ToolCard key={group.namespace} flush className="fn-tool-xrpc-group">
            <h3 className="fn-tool-xrpc-group-head">
              <span>
                <Nsid value={group.namespace} />
              </span>
              <span>{group.methods.length}</span>
            </h3>
            <ul className="fn-tool-xrpc-rows">
              {group.methods.map((method) => (
                <MethodRow key={method.nsid} method={method} onPick={onPick} />
              ))}
            </ul>
          </ToolCard>
        ))}
      </div>
    </ToolSection>
  );
}

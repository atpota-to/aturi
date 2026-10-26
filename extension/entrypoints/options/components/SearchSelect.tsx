import { useEffect, useMemo, useRef, useState } from 'react';

export type SearchSelectOption = {
  value: string;
  label: string;
  /** Searchable but not displayed — e.g. aliases, domains. */
  keywords?: string;
  /** Whether this option is a static/special entry (e.g. "none", "don't redirect"). */
  fixed?: boolean;
};

type Props = {
  options: SearchSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  /** Id of the element that names this select (the row's title). */
  labelledBy?: string;
};

/**
 * A searchable select. The trigger is a named button; open, it is a
 * combobox over a listbox: typing filters, the arrow keys move a highlight
 * through the fixed entries and the matches, Enter picks and Escape
 * closes, and focus returns to the trigger whenever the list goes away.
 */
export default function SearchSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  id = 'search-select',
  labelledBy,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const selected = options.find(o => o.value === value);
  const listId = `${id}-list`;

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const q = query.trim().toLowerCase();

  const { fixed, filterable } = useMemo(() => {
    const f: SearchSelectOption[] = [];
    const r: SearchSelectOption[] = [];
    for (const o of options) {
      if (o.fixed) f.push(o);
      else r.push(o);
    }
    return { fixed: f, filterable: r };
  }, [options]);

  const filtered = useMemo(
    () =>
      q
        ? filterable.filter(
            o =>
              o.label.toLowerCase().includes(q) ||
              o.value.toLowerCase().includes(q) ||
              o.keywords?.toLowerCase().includes(q)
          )
        : filterable,
    [filterable, q]
  );

  // One list for the keyboard: the fixed entries, then the matches.
  const visible = useMemo(() => [...fixed, ...filtered], [fixed, filtered]);
  const activeIndex = visible.length ? Math.min(active, visible.length - 1) : -1;
  const activeId = activeIndex >= 0 ? `${id}-opt-${activeIndex}` : undefined;

  useEffect(() => {
    if (!open || !activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeId]);

  function pick(val: string) {
    onChange(val);
    close();
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!visible.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + visible.length) % visible.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) pick(visible[activeIndex].value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function renderOption(o: SearchSelectOption, index: number) {
    const isSelected = o.value === value;
    const isActive = index === activeIndex;
    return (
      <button
        key={o.value}
        id={`${id}-opt-${index}`}
        type="button"
        role="option"
        aria-selected={isSelected}
        tabIndex={-1}
        className={`search-select-item ${o.fixed ? 'is-fixed' : ''} ${isSelected ? 'is-selected' : ''} ${isActive ? 'is-active' : ''}`}
        onMouseEnter={() => setActive(index)}
        onClick={() => pick(o.value)}
      >
        {o.label}
      </button>
    );
  }

  return (
    <div ref={containerRef} className="search-select">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`search-select-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-labelledby={labelledBy ? `${labelledBy} ${id}` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
      >
        <span className="search-select-value">
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown />
      </button>

      {open && (
        <div className="search-select-dropdown">
          <div className="search-select-search">
            <input
              ref={inputRef}
              className="search-select-input"
              placeholder="Search…"
              value={query}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeId}
              onChange={e => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKeyDown}
            />
          </div>

          <div className="search-select-list" role="listbox" id={listId}>
            {fixed.map((o, i) => renderOption(o, i))}

            {fixed.length > 0 && filtered.length > 0 && (
              <div className="search-select-divider" />
            )}

            {filtered.length === 0 ? (
              <div className="search-select-empty">No matches.</div>
            ) : (
              filtered.map((o, i) => renderOption(o, fixed.length + i))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChevronDown() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

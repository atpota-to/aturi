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
};

export default function SearchSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
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

  function pick(val: string) {
    onChange(val);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="search-select" id={id}>
      <button
        type="button"
        className={`search-select-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="search-select-value">
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown />
      </button>

      {open && (
        <div className="search-select-dropdown" role="listbox">
          <div className="search-select-search">
            <input
              ref={inputRef}
              className="search-select-input"
              placeholder="Search…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>

          <div className="search-select-list">
            {fixed.map(o => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`search-select-item is-fixed ${o.value === value ? 'is-selected' : ''}`}
                onClick={() => pick(o.value)}
              >
                {o.label}
              </button>
            ))}

            {fixed.length > 0 && filtered.length > 0 && (
              <div className="search-select-divider" />
            )}

            {filtered.length === 0 ? (
              <div className="search-select-empty">No matches.</div>
            ) : (
              filtered.map(o => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={`search-select-item ${o.value === value ? 'is-selected' : ''}`}
                  onClick={() => pick(o.value)}
                >
                  {o.label}
                </button>
              ))
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

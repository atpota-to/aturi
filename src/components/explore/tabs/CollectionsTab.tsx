'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { describeRepo } from '@/utils/atproto/pdsClient';
import { encodeRepo } from '@/utils/atproto/urls';
import type { IdentityBundle } from '@/utils/atproto/identity';

type Group = { key: string; items: string[] };

function groupByNamespace(list: string[], filterStr: string): Group[] {
  const f = filterStr.trim().toLowerCase();
  const filtered = f ? list.filter((nsid) => nsid.toLowerCase().includes(f)) : list;
  const map = new Map<string, string[]>();
  for (const nsid of filtered) {
    const lastDot = nsid.lastIndexOf('.');
    const key = lastDot > 0 ? nsid.slice(0, lastDot) : nsid;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(nsid);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({ key, items: items.sort() }));
}

export default function CollectionsTab({ identity }: { identity: IdentityBundle }) {
  const [collections, setCollections] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setCollections(null);
    setError(null);
    describeRepo(identity.pds, identity.did)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res.collections) ? [...res.collections].sort() : [];
        setCollections(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [identity.pds, identity.did]);

  const groups = useMemo(() => groupByNamespace(collections || [], filter), [collections, filter]);
  const repoSeg = encodeRepo(identity.handle || identity.did);

  if (error) return <p className="explore-error">{error}</p>;
  if (!collections) return <p className="explore-placeholder">Loading collections…</p>;
  if (collections.length === 0) {
    return <p className="explore-placeholder">No collections on this repo.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <input
        type="text"
        placeholder="Filter collections…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{
          maxWidth: '24rem',
          padding: '0.5rem 0.75rem',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-medium)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          outline: 'none',
        }}
      />

      {groups.length === 0 ? (
        <p className="explore-placeholder">
          No collections match <code>{filter}</code>.
        </p>
      ) : (
        groups.map((g) => {
          const open = collapsed[g.key] !== true;
          return (
            <section
              key={g.key}
              style={{
                border: '1px solid var(--border-medium)',
                background: 'var(--bg-secondary)',
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setCollapsed((prev) => ({ ...prev, [g.key]: !prev[g.key] ? true : false }))
                }
                aria-expanded={open}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  width: '100%',
                  padding: '0.625rem 1rem',
                  background: 'transparent',
                  border: 0,
                  textAlign: 'left',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.875rem',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                {open ? (
                  <ChevronDown size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
                ) : (
                  <ChevronRight size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
                )}
                <code
                  style={{
                    flex: 1,
                    background: 'transparent',
                    padding: 0,
                    color: 'var(--text-accent)',
                  }}
                >
                  {g.key}
                </code>
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-tertiary)',
                    padding: '0.125rem 0.5rem',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {g.items.length}
                </span>
              </button>
              {open && (
                <ul
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  {g.items.map((nsid) => (
                    <li
                      key={nsid}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                    >
                      <Link
                        href={`/explore/${repoSeg}/${nsid}`}
                        style={{
                          display: 'block',
                          padding: '0.5rem 1rem 0.5rem 2.5rem',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.85rem',
                          color: 'var(--text-primary)',
                          textDecoration: 'none',
                          transition: 'background 0.2s ease, color 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--bg-tertiary)';
                          e.currentTarget.style.color = 'var(--text-accent)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = 'var(--text-primary)';
                        }}
                      >
                        {nsid}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

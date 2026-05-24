'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { encodeRepo } from '@/utils/atproto/urls';

export default function SearchBox({ initial }: { initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial || '');

  useEffect(() => {
    setValue(initial || '');
  }, [initial]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;

    // Paste-an-at-uri shortcut: route straight to the record.
    if (v.startsWith('at://')) {
      const m = v.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/);
      if (m) {
        router.push(`/explore/${encodeRepo(m[1])}/${m[2]}/${encodeURIComponent(m[3])}`);
        return;
      }
      const m2 = v.match(/^at:\/\/([^/]+)\/([^/?#]+)/);
      if (m2) {
        router.push(`/explore/${encodeRepo(m2[1])}/${m2[2]}`);
        return;
      }
      const m3 = v.match(/^at:\/\/([^/?#]+)/);
      if (m3) {
        router.push(`/explore/${encodeRepo(m3[1])}`);
        return;
      }
    }
    router.push(`/explore/${encodeRepo(v)}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: '0.5rem',
        marginBottom: '2rem',
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Search
          size={16}
          style={{
            position: 'absolute',
            left: '0.875rem',
            color: 'var(--text-tertiary)',
            pointerEvents: 'none',
          }}
        />
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="handle, DID, or at:// URI"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            width: '100%',
            padding: '0.75rem 0.875rem 0.75rem 2.5rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.9rem',
            outline: 'none',
            transition: 'border-color 0.2s ease',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--text-accent)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-medium)';
          }}
        />
      </div>
      <button
        type="submit"
        style={{
          padding: '0.75rem 1.25rem',
          background: 'var(--accent-moss)',
          color: 'var(--text-on-accent)',
          border: '1px solid var(--accent-moss)',
          fontFamily: 'var(--font-serif)',
          fontSize: '0.95rem',
          cursor: 'pointer',
          transition: 'background 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--accent-forest)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--accent-moss)';
        }}
      >
        Look up
      </button>
    </form>
  );
}

'use client';

import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CodeBlockProps {
  /** The literal code/command to render and copy. */
  code: string;
  /**
   * Optional small uppercase label shown above the block. Pass one only when
   * the language isn't obvious from the first token: an `http` block opening
   * on `GET`, or a bare `json` body. A "bash" label over `npm install` is
   * texture, not information.
   */
  label?: string;
}

/**
 * A copy-to-clipboard code block for the docs page. Leans on the site's global
 * `pre`/`code` styling (mono font, --bg-tertiary surface) and adds a small copy
 * button in the corner — the same interaction the waypoints packages expose.
 * No syntax-highlighting dependency; the site has none and we keep it that way.
 */
export default function CodeBlock({ code, label }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context / denied) — fail quietly.
    }
  }, [code]);

  return (
    <div style={{ position: 'relative', margin: '1rem 0' }}>
      {label ? (
        <div
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'var(--type-micro)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            marginBottom: '0.4rem',
          }}
        >
          {label}
        </div>
      ) : null}
      <pre style={{ margin: 0, paddingRight: '3rem' }}>
        <code
          style={{
            display: 'block',
            background: 'transparent',
            padding: 0,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}
        >
          {code}
        </code>
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        style={{
          position: 'absolute',
          top: label ? '1.9rem' : '0.5rem',
          right: '0.5rem',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.375rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          color: copied ? 'var(--text-accent)' : 'var(--text-tertiary)',
          cursor: 'pointer',
          transition: 'color 0.2s ease, border-color 0.2s ease',
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Check, Link2 } from 'lucide-react';

type Props = {
  /** Path or full URL — `/`-prefixed paths get the production origin prepended. */
  url: string;
  /** Override the button text. Defaults to "Copy link". */
  label?: string;
  /** Visual hint string for the tooltip / aria-label. Defaults to the resolved URL. */
  title?: string;
};

const PRODUCTION_ORIGIN = 'https://aturi.to';

async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall through */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

/**
 * Compact "copy this page's link" button used throughout the explorer.
 * Accepts a path (gets prefixed with aturi.to) or a full URL.
 */
export default function ShareLinkChip({ url, label = 'Copy link', title }: Props) {
  const [copied, setCopied] = useState(false);

  const resolvedUrl = url.startsWith('http')
    ? url
    : `${PRODUCTION_ORIGIN}${url.startsWith('/') ? url : `/${url}`}`;

  async function onClick() {
    await writeToClipboard(resolvedUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title || (copied ? 'Copied!' : resolvedUrl)}
      aria-label={copied ? `${label} copied` : label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.3rem 0.625rem',
        background: copied ? 'var(--bg-tertiary)' : 'transparent',
        border: '1px solid var(--border-subtle)',
        color: copied ? 'var(--text-accent)' : 'var(--text-tertiary)',
        fontFamily: 'var(--font-serif)',
        fontSize: '0.75rem',
        lineHeight: 1,
        cursor: 'pointer',
        transition: 'color 0.2s ease, border-color 0.2s ease, background 0.2s ease',
      }}
      onMouseEnter={(e) => {
        if (copied) return;
        e.currentTarget.style.color = 'var(--text-primary)';
        e.currentTarget.style.borderColor = 'var(--border-medium)';
      }}
      onMouseLeave={(e) => {
        if (copied) return;
        e.currentTarget.style.color = 'var(--text-tertiary)';
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
      }}
    >
      {copied ? <Check size={11} /> : <Link2 size={11} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}

'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

type Props = {
  /** The full Markdown document to copy. */
  markdown: string;
};

async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall back to the legacy execCommand path for restricted contexts.
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
 * "Copy as Markdown" button for the docs header. Copies the entire page as a
 * single Markdown document — handy for pasting into an LLM or coding agent.
 */
export default function CopyMarkdownButton({ markdown }: Props) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    await writeToClipboard(markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? 'Copied!' : 'Copy these docs as Markdown'}
      aria-label={copied ? 'Docs copied as Markdown' : 'Copy docs as Markdown'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.45rem',
        padding: '0.45rem 0.85rem',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
        color: copied ? 'var(--text-accent)' : 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--type-small)',
        cursor: 'pointer',
        transition: 'color 0.2s ease, border-color 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text-primary)';
        e.currentTarget.style.borderColor = 'var(--border-medium)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = copied
          ? 'var(--text-accent)'
          : 'var(--text-secondary)';
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? 'Copied' : 'Copy as Markdown'}</span>
    </button>
  );
}

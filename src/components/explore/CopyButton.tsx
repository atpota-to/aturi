'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

type Props = {
  value: string;
  label: string;
  compact?: boolean;
  variant?: 'default' | 'subtle';
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

export default function CopyButton({ value, label, compact = false, variant = 'default' }: Props) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    await writeToClipboard(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  const isSubtle = variant === 'subtle';
  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? 'Copied!' : label}
      aria-label={copied ? `${label} copied` : label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: compact ? '0.25rem 0.5rem' : '0.4rem 0.75rem',
        background: isSubtle ? 'transparent' : 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
        color: copied ? 'var(--text-accent)' : 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)',
        fontSize: compact ? '0.75rem' : '0.8125rem',
        cursor: 'pointer',
        transition: 'color 0.2s ease, border-color 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text-primary)';
        e.currentTarget.style.borderColor = 'var(--border-medium)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = copied ? 'var(--text-accent)' : 'var(--text-secondary)';
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
      }}
    >
      {copied ? <Check size={compact ? 12 : 14} /> : <Copy size={compact ? 12 : 14} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}

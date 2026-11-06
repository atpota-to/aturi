'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

type Props = {
  value: string;
  label: string;
  compact?: boolean;
  variant?: 'default' | 'subtle';
  /** Glyph only; the label stays as the accessible name and tooltip. */
  iconOnly?: boolean;
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

export default function CopyButton({
  value,
  label,
  compact = false,
  variant = 'default',
  iconOnly = false,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    await writeToClipboard(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? 'Copied!' : label}
      aria-label={copied ? `${label} copied` : label}
      className="fx-copy"
      data-size={compact ? undefined : 'lg'}
      data-variant={variant}
      data-icon-only={iconOnly || undefined}
      data-copied={copied || undefined}
    >
      {copied ? <Check size={compact ? 12 : 14} aria-hidden /> : <Copy size={compact ? 12 : 14} aria-hidden />}
      {!iconOnly && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
}

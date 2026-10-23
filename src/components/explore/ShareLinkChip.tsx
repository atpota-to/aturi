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
  /** A 36px square icon button (the account card's copy-link) instead of a chip. */
  iconOnly?: boolean;
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
export default function ShareLinkChip({ url, label = 'Copy link', title, iconOnly }: Props) {
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
      className={iconOnly ? 'fx-btn fx-btn-icon' : 'fx-copy'}
      data-copied={copied || undefined}
      data-active={iconOnly && copied ? true : undefined}
    >
      {copied ? <Check size={iconOnly ? 15 : 12} aria-hidden /> : <Link2 size={iconOnly ? 15 : 12} aria-hidden />}
      {!iconOnly && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
}

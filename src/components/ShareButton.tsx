'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

type ShareButtonProps = {
  url: string;
  label?: string;
};

export default function ShareButton({ url, label = 'Copy link' }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="share-button"
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1.25rem',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-medium)',
        color: 'var(--text-primary)',
        fontSize: '0.875rem',
        transition: 'all 0.3s ease',
        cursor: 'pointer',
      }}
    >
      {copied ? (
        <>
          <Check size={16} />
          Copied!
        </>
      ) : (
        <>
          <Copy size={16} />
          {label}
        </>
      )}
    </button>
  );
}



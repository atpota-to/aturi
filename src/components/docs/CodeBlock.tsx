'use client';

import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CodeBlockProps {
  /** The literal code/command to render and copy. */
  code: string;
  /** Optional language label shown in the block's header strip (e.g. "bash", "tsx"). */
  label?: string;
}

/**
 * A copy-to-clipboard code block for the docs page: a mono block on the subtle
 * surface with a header strip holding the language label and a copy button
 * (styled by .fn-code in src/styles/fieldnotes/content.css) — the same
 * interaction the waypoints packages expose.
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

  const copyButton = (
    <button
      type="button"
      className="fn-code-copy"
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy code'}
      data-done={copied ? '' : undefined}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {label ? <span aria-hidden>{copied ? 'Copied' : 'Copy'}</span> : null}
    </button>
  );

  return (
    <div className="fn-code" data-bare={label ? undefined : ''}>
      {label ? (
        <div className="fn-code-bar">
          <span className="fn-code-lang">{label}</span>
          {copyButton}
        </div>
      ) : null}
      <pre>
        <code>{code}</code>
      </pre>
      {label ? null : copyButton}
    </div>
  );
}

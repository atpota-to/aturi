'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Bot, Check, ChevronRight, Code2, Copy } from 'lucide-react';
import { config } from '@/lib/config';

// Built from the configured domain rather than getSiteUrl(): the latter
// reads server-only Vercel env vars, so a preview deploy would render one
// URL on the server and another after hydration.
const MCP_ENDPOINT = `https://${config.domain}/api/mcp`;
const WAYPOINTS_INSTALL = 'npm i @aturi.to/waypoints';

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

function CopyRow({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fn-home-copyrow">
      <code>{value}</code>
      <button
        type="button"
        className="fn-home-iconbtn"
        title={copied ? 'Copied!' : label}
        aria-label={copied ? `${label} copied` : label}
        data-copied={copied ? '' : undefined}
        onClick={async () => {
          await writeToClipboard(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </div>
  );
}

function DevCard({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="fn-card fn-home-devcard" aria-labelledby={id}>
      <div className="fn-home-devcard-head">
        <span className="fn-home-icon-tile" aria-hidden>
          {icon}
        </span>
        <h3 id={id}>{title}</h3>
      </div>
      {children}
    </section>
  );
}

/**
 * "For developers and agents": the MCP endpoint and the Waypoints package,
 * each with its one copyable line and a link to the full setup page.
 */
export default function DeveloperCards() {
  return (
    <section className="fn-home-section" aria-labelledby="fn-home-dev">
      <h2 id="fn-home-dev" className="fn-home-section-title">
        For developers and agents
      </h2>
      <div className="fn-home-devgrid">
        <DevCard id="fn-home-mcp" icon={<Bot size={18} />} title="MCP server">
          <p>
            One URL makes the Atmosphere more traversable for agents. Every tool
            is read-only: no key, no account, nothing to install.
          </p>
          <CopyRow value={MCP_ENDPOINT} label="Copy MCP URL" />
          <Link href="/mcp" className="fn-home-textlink">
            Set it up <ChevronRight size={14} aria-hidden />
          </Link>
        </DevCard>
        <DevCard id="fn-home-wp" icon={<Code2 size={18} />} title="Waypoints library">
          <p>
            The app catalog and link parsing behind aturi, as a zero-dependency,
            MIT-licensed package for your own app.
          </p>
          <CopyRow value={WAYPOINTS_INSTALL} label="Copy install command" />
          <Link href="/docs" className="fn-home-textlink">
            Integrate aturi <ChevronRight size={14} aria-hidden />
          </Link>
        </DevCard>
      </div>
    </section>
  );
}

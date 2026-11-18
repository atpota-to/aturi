'use client';

import Link from 'next/link';
import { ChevronRight, Download, Leaf, Link2, Plug, Telescope } from 'lucide-react';

type ProductKey = 'universal-links' | 'extension' | 'explore' | 'mcp';

type Card = {
  key: ProductKey;
  href: string;
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
};

const CARDS: Card[] = [
  {
    key: 'universal-links',
    href: '/links',
    icon: <Link2 size={18} />,
    title: 'Universal links',
    body: (
      <>
        Share{' '}
        <code>
          aturi.to/<wbr />handle/<wbr />collection/<wbr />rkey
        </code>
        . Visitors choose which Atmosphere app opens it.
      </>
    ),
  },
  {
    key: 'extension',
    href: '/extension',
    icon: <Download size={18} />,
    title: 'Browser extension',
    body: 'Inspect AT URIs on any page and jump between Atmosphere apps.',
  },
  {
    key: 'mcp',
    href: '/mcp',
    icon: <Plug size={18} />,
    title: 'Atmosphere MCP',
    body: 'Point an AI agent at one URL and let it read the network, keyless and read-only. In beta.',
  },
  {
    key: 'explore',
    href: '/explore',
    icon: <Telescope size={18} />,
    title: 'Atmosphere Explorer',
    body: "Browse any account's PDS records, identity history, and backlinks.",
  },
];

/**
 * Bottom-of-page "explore the rest of aturi" cards. Pass `current` to
 * hide the card for the page you're already on so we don't link a page
 * to itself.
 */
export default function CrossLinkCards({ current }: { current?: ProductKey }) {
  const cards = CARDS.filter((c) => c.key !== current);
  return (
    <section className="fl-cross" aria-label="Other Aturi tools">
      <div className="fl-cross-head">
        <span className="fl-kicker">
          <Leaf size={14} aria-hidden /> More from Aturi
        </span>
        <h2 className="fl-cross-title">See the rest of the toolkit</h2>
      </div>
      <div className="fl-cross-grid">
        {cards.map((c) => (
          <CrossLinkCard key={c.key} icon={c.icon} title={c.title} body={c.body} href={c.href} />
        ))}
      </div>
    </section>
  );
}

function CrossLinkCard({
  icon,
  title,
  body,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  href: string;
}) {
  return (
    <Link href={href} className="fl-card fl-cross-card">
      <span className="fl-cross-card-head">
        <span className="fl-icon-tile" aria-hidden>
          {icon}
        </span>
        <h3>{title}</h3>
        <ChevronRight size={16} aria-hidden className="fl-cross-card-chev" />
      </span>
      <p>{body}</p>
    </Link>
  );
}

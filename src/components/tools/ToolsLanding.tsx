import Link from 'next/link';
import { Activity, ChevronRight } from 'lucide-react';

/**
 * Every tool, in the order the hub lists them. A new tool is a route under
 * /tools plus an entry here. All of them are static pages, so the links keep
 * Next's default prefetch.
 */
const TOOLS = [
  {
    href: '/tools/stream',
    title: 'Stream monitor',
    desc: 'Watch Jetstream and the PLC directory live, filtered by event type, account, collection or text.',
    Icon: Activity,
  },
];

export default function ToolsLanding() {
  return (
    <div className="fn-tools">
      <header className="fn-t-intro">
        <span className="fn-kicker">Tools</span>
        <h1>Tools</h1>
        <p>Small single-purpose utilities for atproto. New ones are added here as they&rsquo;re built.</p>
      </header>

      <nav aria-label="Tools" className="fn-x-tiles fn-t-tiles">
        {TOOLS.map(({ href, title, desc, Icon }) => (
          <Link key={href} href={href} className="fn-x-tile fn-t-tile">
            <span aria-hidden className="fn-x-tile-icon">
              <Icon size={18} />
            </span>
            <span className="fn-x-tile-text">
              <span className="fn-x-tile-title">{title}</span>
              <span className="fn-x-tile-desc">{desc}</span>
            </span>
            <ChevronRight size={16} aria-hidden className="fn-x-tile-chev" />
          </Link>
        ))}
      </nav>
    </div>
  );
}

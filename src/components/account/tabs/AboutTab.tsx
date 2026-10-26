'use client';

import { ArrowRight, ExternalLink, Github } from 'lucide-react';

const LINKS: { label: string; href: string; icon?: React.ReactNode }[] = [
  {
    label: 'Project on GitHub',
    href: 'https://github.com/atpota-to/aturi',
    icon: <Github size={13} />,
  },
  {
    label: 'AT Protocol',
    href: 'https://atproto.com',
    icon: <ExternalLink size={13} />,
  },
  {
    label: 'Browser extension',
    href: '/extension',
  },
  {
    label: 'Universal links',
    href: '/links',
  },
  {
    label: 'Terms & privacy',
    href: '/terms',
  },
];

export default function AboutTab() {
  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="settings-card-title">About Aturi</h2>
        <p className="settings-card-sub">
          A toolkit for exploring the atproto atmosphere: deep-link any record,
          browse repos, jump across apps with waypoints.
        </p>
      </div>
      <ul className="settings-link-list">
        {LINKS.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              target={l.href.startsWith('http') ? '_blank' : undefined}
              rel={l.href.startsWith('http') ? 'noreferrer noopener' : undefined}
              className="settings-link-row"
            >
              <span className="settings-link-icon" aria-hidden>
                {l.icon ?? <ArrowRight size={13} />}
              </span>
              <span className="settings-link-label">{l.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

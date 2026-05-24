'use client';

import { ExternalLink, Github } from 'lucide-react';

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
    href: '/universal-links',
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
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {LINKS.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              target={l.href.startsWith('http') ? '_blank' : undefined}
              rel={l.href.startsWith('http') ? 'noreferrer noopener' : undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.75rem',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-serif)',
                fontSize: '0.875rem',
                textDecoration: 'none',
                transition: 'border-color 0.2s ease, color 0.2s ease',
              }}
            >
              {l.icon}
              <span>{l.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

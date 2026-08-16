'use client';

import Link from 'next/link';
import Header from '@/components/Header';
import HomeHero from '@/components/HomeHero';
import { FadeIn } from '@/components/FadeIn';
import ExtensionStrip from '@/components/home/ExtensionStrip';
import ExplorerStrip from '@/components/home/ExplorerStrip';
import UniversalLinksStrip from '@/components/home/UniversalLinksStrip';

export default function HomePage() {
  return (
    <div style={{ position: 'relative', overflowX: 'clip' }}>
      {/* Compact nav card — same shape used by /explore, /profile/*, and
          /account so the homepage doesn't fork its own header treatment.
          Rendered as a direct child of the page wrapper so position:
          sticky has the full page height as its containing block. */}
      <Header compact />

      <HomeHero />

      {/* The homepage is a doorway: each product gets a name, a sentence and
          a link, and the argument for it lives on its own page. Only the
          extension section carries a visual, which is what makes it read as
          the one loud thing rather than the first of three equal claims. */}
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '1rem var(--page-edge) 4rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '4.5rem',
        }}
      >
        <ExtensionStrip />
        <ExplorerStrip />
        <UniversalLinksStrip />

        <FadeIn delay={0.1}>
          <section
            style={{
              padding: '2rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              marginBottom: '1.5rem',
            }}
          >
            <h2
              style={{
                fontSize: 'var(--type-heading)',
                fontWeight: 300,
                lineHeight: 1.2,
                letterSpacing: '-0.01em',
                color: 'var(--text-primary)',
                margin: '0 0 0.875rem',
              }}
            >
              Run your own, or add your app
            </h2>
            <p
              style={{
                fontSize: 'var(--type-body)',
                lineHeight: 1.65,
                color: 'var(--text-secondary)',
                margin: 0,
                maxWidth: '46rem',
              }}
            >
              aturi.to is GPL-3.0, so you can{' '}
              <Link href="/fork">run your own instance</Link> on your own
              domain. To get an Atmosphere client into the waypoint catalog,{' '}
              <a href="mailto:aturi@atpota.to">email aturi@atpota.to</a> or{' '}
              <a
                href="https://bsky.app/profile/aturi.to"
                target="_blank"
                rel="noopener noreferrer"
              >
                send a DM on Bluesky
              </a>
              .
            </p>
          </section>

          {/* Name line: a footnote about the domain, so it runs unboxed at
              footer weight rather than as a section with a heading. */}
          <p
            style={{
              fontSize: 'var(--type-small)',
              lineHeight: 1.65,
              color: 'var(--text-tertiary)',
              margin: 0,
            }}
          >
            aturi.to takes its name from the AT URI; say it <em>uh-tour-ee</em>.
          </p>
        </FadeIn>
      </div>
    </div>
  );
}

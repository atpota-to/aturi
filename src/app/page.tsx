'use client';

import Header from '@/components/Header';
import HomeHero from '@/components/HomeHero';
import { FadeIn } from '@/components/FadeIn';
import UniversalLinksStrip from '@/components/home/UniversalLinksStrip';
import ExtensionStrip from '@/components/home/ExtensionStrip';
import ExplorerStrip from '@/components/home/ExplorerStrip';
import { Code2, GitFork, Scale } from 'lucide-react';

export default function HomePage() {
  return (
    <div style={{ position: 'relative', overflowX: 'clip' }}>
      {/* Compact nav card — same shape used by /explore, /profile/*, and
          /account so the homepage doesn't fork its own header treatment.
          Rendered as a direct child of the page wrapper so position:
          sticky has the full page height as its containing block. */}
      <Header compact />

      {/* Hero: tagline + description + two CTAs (Explore + Download) */}
      <HomeHero />

      {/* Three product strips. Each is one of Aturi's offerings with a
          real interactive demo on one side and the pitch on the other.
          Order leads with the extension (the primary download CTA in
          the hero), then the explorer (the secondary CTA), and closes
          on universal links — the most ambient/everyone-encounters-it
          surface, which doubles as the natural connector to the
          waypoints catalog. */}
      <ExtensionStrip />
      <ExplorerStrip />
      <UniversalLinksStrip />

      {/* Why Aturi? — brand story; kept as-is. */}
      <div
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '0 var(--page-edge) 4rem',
        }}
      >
        <FadeIn delay={0.1}>
          <section
            className="card"
            style={{
              padding: '3rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              position: 'relative',
              transform: 'rotate(-0.4deg)',
              transition: 'all 0.4s ease',
              marginBottom: '4rem',
              maxWidth: '900px',
              margin: '0 auto 4rem',
            }}
          >
            <h2
              style={{
                fontSize: '2rem',
                marginBottom: '1.5rem',
                color: 'var(--text-accent)',
                fontWeight: 400,
                lineHeight: 1.2,
              }}
            >
              Why &ldquo;aturi&rdquo;?
            </h2>
            <div
              style={{
                color: 'var(--text-secondary)',
                fontSize: '1.05rem',
                lineHeight: 1.8,
                marginBottom: '1.5rem',
              }}
            >
              <p style={{ marginBottom: '1rem' }}>
                The name is a playful blend of{' '}
                <strong style={{ color: 'var(--text-primary)' }}>AT URI</strong>
                , the universal identifier the AT Protocol uses to point at
                any record, profile, or resource. Pronounced like
                &ldquo;Atari&rdquo; but with &ldquo;turi&rdquo; at the
                end: <em>uh-tour-ee</em>.
              </p>
              <p>
                Every piece of content in the Atmosphere has an AT URI that
                works regardless of which app or server you&apos;re using. We
                thought it deserved a friendly name that&apos;s easy to
                remember and share.
              </p>
            </div>
            <div
              style={{
                padding: '1.25rem',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-medium)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.9rem',
                color: 'var(--text-tertiary)',
                lineHeight: 1.6,
              }}
            >
              <div style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                Example AT URI:
              </div>
              <div
                style={{
                  color: 'var(--text-accent)',
                  wordBreak: 'break-all',
                  overflowWrap: 'break-word',
                }}
              >
                at://did:plc:lcieujcfkv4jx7gehsvok3pr/app.bsky.feed.post/3mi2mcc5lxj2y
              </div>
            </div>
          </section>
        </FadeIn>

        {/* Submit your app card */}
        <FadeIn delay={0.2}>
          <section
            className="card"
            style={{
              padding: '2.5rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              position: 'relative',
              transform: 'rotate(0.3deg)',
              transition: 'all 0.4s ease',
              marginTop: '3rem',
              textAlign: 'center',
            }}
          >
            <div style={{ maxWidth: '700px', margin: '0 auto' }}>
              <h3
                style={{
                  marginBottom: '1rem',
                  color: 'var(--text-primary)',
                  fontSize: '1.5rem',
                  fontWeight: 400,
                }}
              >
                Submit your app as a waypoint
              </h3>
              <p
                style={{
                  color: 'var(--text-secondary)',
                  marginBottom: '1.5rem',
                  fontSize: '1rem',
                  lineHeight: 1.7,
                }}
              >
                Building an Atmosphere client or tool? We&apos;d love to consider
                adding it to our curated list of waypoints.
              </p>
              <div
                style={{
                  display: 'flex',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                }}
              >
                <a
                  href="mailto:aturi@atpota.to"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.875rem 1.5rem',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-medium)',
                    fontSize: '0.95rem',
                    textDecoration: 'none',
                    transition: 'all 0.3s ease',
                    fontWeight: 400,
                  }}
                >
                  Email aturi@atpota.to
                </a>
                <a
                  href="https://bsky.app/profile/aturi.to"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.875rem 1.5rem',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-medium)',
                    fontSize: '0.95rem',
                    textDecoration: 'none',
                    transition: 'all 0.3s ease',
                    fontWeight: 400,
                  }}
                >
                  DM on Bluesky
                </a>
              </div>
            </div>
          </section>
        </FadeIn>

        {/* Open source card. Sits at the bottom of the home page so it
            reads as "by the way, this thing is yours to fork" rather than
            leading with it. Three pill links cover the three things people
            usually want next: the code, the license, and the fork docs. */}
        <FadeIn delay={0.3}>
          <section
            className="card"
            style={{
              padding: '2.5rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              position: 'relative',
              transform: 'rotate(-0.2deg)',
              transition: 'all 0.4s ease',
              marginTop: '3rem',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: 'var(--text-accent)',
                fontSize: '0.75rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-serif)',
                marginBottom: '1rem',
              }}
            >
              <Code2 size={14} aria-hidden /> Open source
            </div>
            <h3
              style={{
                marginBottom: '0.875rem',
                color: 'var(--text-primary)',
                fontSize: '1.625rem',
                fontWeight: 400,
                maxWidth: '34rem',
              }}
            >
              GPL v3, built in the open, ready to fork.
            </h3>
            <p
              style={{
                color: 'var(--text-secondary)',
                marginBottom: '1.5rem',
                fontSize: '1rem',
                lineHeight: 1.7,
                maxWidth: '46rem',
              }}
            >
              Every line of aturi.to lives on{' '}
              <a
                href="https://github.com/atpota-to/aturi"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--text-accent)' }}
              >
                GitHub
              </a>
              , mirrored to{' '}
              <a
                href="https://tangled.org/atpota.to/aturi"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--text-accent)' }}
              >
                tangled.org
              </a>
              . Run your own instance on a custom domain, audit the source
              code, or contribute a waypoint.
            </p>
            <div
              style={{
                display: 'flex',
                gap: '0.625rem',
                flexWrap: 'wrap',
              }}
            >
              <a
                href="https://github.com/atpota-to/aturi"
                target="_blank"
                rel="noopener noreferrer"
                style={openSourcePillStyle}
              >
                <Code2 size={14} aria-hidden /> Source code
              </a>
              <a
                href="https://github.com/atpota-to/aturi/blob/main/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
                style={openSourcePillStyle}
              >
                <Scale size={14} aria-hidden /> GPL v3 license
              </a>
              <a
                href="https://tangled.org/atpota.to/aturi"
                target="_blank"
                rel="noopener noreferrer"
                style={openSourcePillStyle}
              >
                <GitFork size={14} aria-hidden /> Tangled mirror
              </a>
            </div>
          </section>
        </FadeIn>
      </div>
    </div>
  );
}

const openSourcePillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.55rem 1rem',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-medium)',
  fontSize: '0.875rem',
  textDecoration: 'none',
  fontFamily: 'var(--font-serif)',
};

'use client';

import Header from '@/components/Header';
import HomeHero from '@/components/HomeHero';
import { FadeIn } from '@/components/FadeIn';
import UniversalLinksStrip from '@/components/home/UniversalLinksStrip';
import ExtensionStrip from '@/components/home/ExtensionStrip';
import ExplorerStrip from '@/components/home/ExplorerStrip';

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
          padding: '0 2rem 4rem',
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
                , the universal identifier that points to any record, profile,
                or resource across the Atmosphere. Pronounced like &ldquo;Atari&rdquo;
                but with &ldquo;turi&rdquo; at the end&mdash;<em>uh-tour-ee</em>.
              </p>
              <p>
                Every piece of content in the Atmosphere has an AT URI that
                works regardless of which app or server you&apos;re using. We
                thought it deserved a friendly name that&apos;s easy to remember
                and share.
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
                at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3m6mwoadjbp2d
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
      </div>
    </div>
  );
}

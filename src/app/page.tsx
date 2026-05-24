'use client';

import Link from 'next/link';
import { ArrowRight, Link2, Sparkles, MousePointerClick, Repeat, Telescope } from 'lucide-react';
import Header from '@/components/Header';
import HomeHero from '@/components/HomeHero';
import { StaggeredChildren, StaggerItem } from '@/components/StaggeredChildren';
import { FadeIn } from '@/components/FadeIn';
import { getWaypointCount } from '@/utils/waypoints';

export default function HomePage() {
  const waypointCount = getWaypointCount();

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Compact nav card — same shape used by /explore, /profile/*, and
          /account so the homepage doesn't fork its own header treatment. */}
      <div className="container-narrow" style={{ padding: '2rem 2rem 0' }}>
        <Header compact />
      </div>

      {/* Hero: tagline + description + two CTAs (Explore + Download) */}
      <HomeHero />

      {/* Main Content - Asymmetric Layout */}
      <div style={{ 
        maxWidth: '1400px', 
        margin: '0 auto',
        padding: '0 2rem 4rem',
        position: 'relative'
      }}>
        
        {/* Feature Cards - Organic Staggered Layout */}
        <StaggeredChildren
          className="feature-cards-grid"
          style={{ 
            display: 'grid',
            gridTemplateColumns: 'repeat(12, 1fr)',
            gap: '1.5rem',
            marginBottom: '8rem',
            position: 'relative'
          }}
          staggerDelay={0.12}
        >
          {/* Large Primary Card - Quick Navigation (Extension) */}
          <StaggerItem 
            className="card feature-card-primary"
            style={{
              gridColumn: 'span 7',
              padding: '3rem',
              position: 'relative',
              transform: 'rotate(-0.5deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <div style={{ 
              display: 'flex', 
              alignItems: 'flex-start',
              gap: '1.5rem',
              marginBottom: '1.5rem'
            }}>
              <MousePointerClick size={40} style={{ 
                color: 'var(--text-accent)', 
                flexShrink: 0,
                marginTop: '0.25rem'
              }} />
              <div>
                <h3 style={{ 
                  marginBottom: '1rem',
                  fontSize: '1.75rem',
                  fontWeight: 400,
                }}>
                  Quick Navigation
                </h3>
              <p style={{ 
                color: 'var(--text-secondary)', 
                fontSize: '1rem',
                lineHeight: 1.7,
                marginBottom: '1.5rem'
              }}>
                Land on a Bluesky post and want to view it in Anisota? Click the Aturi extension icon
                and jump there in one click. Works on Bluesky, Anisota, Blacksky, Leaflet, Tangled,
                Margin, PDSls, Semble, and dozens more.
              </p>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  color: 'var(--text-accent)',
                  fontSize: '0.9rem',
                  fontFamily: 'var(--font-mono)'
                }}>
                  <Sparkles size={14} />
                  <span>{waypointCount} curated Atmosphere apps</span>
                </div>
              </div>
            </div>
          </StaggerItem>

          {/* Smaller Cards - Stacked */}
          <StaggerItem 
            className="feature-cards-secondary-stack"
            style={{
              gridColumn: 'span 5',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
            }}
          >
            <div 
              className="card feature-card-secondary"
              style={{
                padding: '2rem',
                transform: 'rotate(0.5deg)',
                transition: 'all 0.4s ease',
              }}
            >
              <Repeat size={28} style={{ 
                color: 'var(--text-accent)', 
                marginBottom: '1rem' 
              }} />
              <h3 style={{ marginBottom: '0.75rem', fontSize: '1.25rem' }}>
                Auto-Redirect
              </h3>
              <p style={{ 
                color: 'var(--text-secondary)', 
                fontSize: '0.95rem',
                lineHeight: 1.6
              }}>
                Set your preferred client once. Every Atmosphere link you click automatically
                opens in the app you actually use.
              </p>
            </div>

            <div
              className="card feature-card-secondary"
              style={{
                padding: '2rem',
                transform: 'rotate(-0.3deg)',
                transition: 'all 0.4s ease',
              }}
            >
              <Link2 size={28} style={{
                color: 'var(--text-accent)',
                marginBottom: '1rem'
              }} />
              <h3 style={{ marginBottom: '0.75rem', fontSize: '1.25rem' }}>
                Universal Links
              </h3>
              <p style={{
                color: 'var(--text-secondary)',
                fontSize: '0.95rem',
                lineHeight: 1.6
              }}>
                Share an aturi.to link with anyone. They pick the Atmosphere client they
                want to view it in — no app lock-in.
              </p>
            </div>

            <Link
              href="/explore"
              className="card feature-card-secondary"
              style={{
                padding: '2rem',
                transform: 'rotate(0.4deg)',
                transition: 'all 0.4s ease',
                textDecoration: 'none',
                color: 'inherit',
                display: 'block',
              }}
            >
              <Telescope size={28} style={{
                color: 'var(--text-accent)',
                marginBottom: '1rem',
              }} />
              <h3 style={{ marginBottom: '0.75rem', fontSize: '1.25rem' }}>
                Atmosphere Explorer
              </h3>
              <p style={{
                color: 'var(--text-secondary)',
                fontSize: '0.95rem',
                lineHeight: 1.6,
                marginBottom: '0.75rem',
              }}>
                Browse through any account&apos;s PDS records, identity history, and backlinks.
                Sign in to edit your own data, watch the network live, and more.
              </p>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                color: 'var(--text-accent)',
                fontSize: '0.875rem',
              }}>
                Start exploring <ArrowRight size={14} />
              </span>
            </Link>
          </StaggerItem>
        </StaggeredChildren>

        {/* Why Aturi Section */}
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
              marginBottom: '8rem',
              maxWidth: '900px',
              margin: '0 auto 8rem'
            }}
          >
            <h2 style={{
              fontSize: '2rem',
              marginBottom: '1.5rem',
              color: 'var(--text-accent)',
              fontWeight: 400,
              lineHeight: 1.2
            }}>
              Why &ldquo;aturi&rdquo;?
            </h2>
            <div style={{
              color: 'var(--text-secondary)',
              fontSize: '1.05rem',
              lineHeight: 1.8,
              marginBottom: '1.5rem'
            }}>
              <p style={{ marginBottom: '1rem' }}>
                The name is a playful blend of <strong style={{ color: 'var(--text-primary)' }}>AT URI</strong>, the universal identifier
                that points to any record, profile, or resource across the Atmosphere. Pronounced like &ldquo;Atari&rdquo; but
                with &ldquo;turi&rdquo; at the end—<em>uh-tour-ee</em>.
              </p>
              <p>
                Every piece of content in the Atmosphere has an AT URI that works regardless of which app or
                server you&apos;re using. We thought it deserved a friendly name that&apos;s easy to remember
                and share.
              </p>
            </div>
            <div style={{
              padding: '1.25rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-medium)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.9rem',
              color: 'var(--text-tertiary)',
              lineHeight: 1.6
            }}>
              <div style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                Example AT URI:
              </div>
              <div style={{ 
                color: 'var(--text-accent)',
                wordBreak: 'break-all',
                overflowWrap: 'break-word'
              }}>
                at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3m6mwoadjbp2d
              </div>
            </div>
          </section>
        </FadeIn>

        {/* Example Section - Diagonal Layout */}
        <section style={{ 
          position: 'relative',
          marginBottom: '8rem',
        }}>
          <StaggeredChildren
            className="examples-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(12, 1fr)',
              gap: '2rem',
              alignItems: 'center'
            }}
            staggerDelay={0.1}
          >
            {/* Heading - Offset */}
            <StaggerItem 
              className="examples-heading"
              style={{ 
                gridColumn: '1 / span 5',
                position: 'sticky',
                top: '2rem'
              }}
            >
              <h2 style={{
                fontSize: '2.5rem',
                marginBottom: '1rem',
                color: 'var(--text-accent)',
                fontWeight: 300,
                lineHeight: 1.2
              }}>
                Try it yourself
              </h2>
              <p style={{
                color: 'var(--text-secondary)',
                fontSize: '1rem',
                lineHeight: 1.7
              }}>
                Click to see how universal links work in action
              </p>
            </StaggerItem>

            {/* Example Links - Offset */}
            <StaggerItem 
              className="examples-links"
              style={{
                gridColumn: '7 / span 6',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <Link
                href="/anisota.net/app.bsky.feed.post/3m6mwoadjbp2d"
                className="waypoint-button example-link"
                style={{ 
                  textDecoration: 'none',
                  transform: 'rotate(0.5deg)'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div className="waypoint-name">Example Post</div>
                  <div className="waypoint-description">
                    anisota.net/app.bsky.feed.post/3m6mwoadjbp2d
                  </div>
                </div>
                <ArrowRight size={20} style={{ color: 'var(--text-tertiary)' }} />
              </Link>

              <Link
                href="/anisota.net"
                className="waypoint-button example-link"
                style={{ 
                  textDecoration: 'none',
                  transform: 'rotate(-0.3deg)'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div className="waypoint-name">Example Profile</div>
                  <div className="waypoint-description">anisota.net</div>
                </div>
                <ArrowRight size={20} style={{ color: 'var(--text-tertiary)' }} />
              </Link>

              <Link
                href="/anisota.net/net.anisota.beta.game.collection/3m7aso4kae72d"
                className="waypoint-button example-link"
                style={{ 
                  textDecoration: 'none',
                  transform: 'rotate(0.2deg)'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div className="waypoint-name">Example Record</div>
                  <div className="waypoint-description">
                    anisota.net/net.anisota.beta.game.collection/3m7aso4kae72d
                  </div>
                </div>
                <ArrowRight size={20} style={{ color: 'var(--text-tertiary)' }} />
              </Link>
            </StaggerItem>
          </StaggeredChildren>
        </section>


        {/* Submit Your App Card */}
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
              textAlign: 'center'
            }}
          >
          <div style={{ maxWidth: '700px', margin: '0 auto' }}>
            <h3 style={{ 
              marginBottom: '1rem', 
              color: 'var(--text-primary)',
              fontSize: '1.5rem',
              fontWeight: 400
            }}>
              Submit your app as a waypoint
            </h3>
            <p
              style={{
                color: 'var(--text-secondary)',
                marginBottom: '1.5rem',
                fontSize: '1rem',
                lineHeight: 1.7
              }}
            >
              Building an Atmosphere client or tool? We&apos;d love to consider adding it to our curated list of waypoints.
            </p>
            <div style={{
              display: 'flex',
              gap: '1rem',
              flexWrap: 'wrap',
              justifyContent: 'center'
            }}>
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
                  fontWeight: 400
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
                  fontWeight: 400
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

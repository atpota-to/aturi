import Link from 'next/link';
import { ArrowRight, Link2, Code, Globe, Sparkles } from 'lucide-react';
import Header from '@/components/Header';

export default function HomePage() {
  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Hero Section */}
      <div style={{ padding: '4rem 2rem 2rem' }}>
        <Header />
      </div>

      {/* Main Content - Asymmetric Layout */}
      <div style={{ 
        maxWidth: '1400px', 
        margin: '0 auto',
        padding: '0 2rem 4rem',
        position: 'relative'
      }}>
        
        {/* Feature Cards - Organic Staggered Layout */}
        <div style={{ 
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: '1.5rem',
          marginBottom: '8rem',
          position: 'relative'
        }}>
          {/* Large Primary Card - Universal Sharing */}
          <div 
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
              <Link2 size={40} style={{ 
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
                  Universal Sharing
                </h3>
                <p style={{ 
                  color: 'var(--text-secondary)', 
                  fontSize: '1rem',
                  lineHeight: 1.7,
                  marginBottom: '1.5rem'
                }}>
                  One link works everywhere. Share posts, profiles, and lists across all
                  ATProto clients without worrying about compatibility.
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
                  <span>Works with any ATProto app</span>
                </div>
              </div>
            </div>
          </div>

          {/* Smaller Cards - Stacked */}
          <div style={{
            gridColumn: 'span 5',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
          }}>
            <div 
              className="card feature-card-secondary"
              style={{
                padding: '2rem',
                transform: 'rotate(0.5deg)',
                transition: 'all 0.4s ease',
              }}
            >
              <Globe size={28} style={{ 
                color: 'var(--text-accent)', 
                marginBottom: '1rem' 
              }} />
              <h3 style={{ marginBottom: '0.75rem', fontSize: '1.25rem' }}>
                Choose Your View
              </h3>
              <p style={{ 
                color: 'var(--text-secondary)', 
                fontSize: '0.95rem',
                lineHeight: 1.6
              }}>
                Recipients pick their preferred platform. Bluesky, Blacksky, pdsls,
                or any ATProto client.
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
              <Code size={28} style={{ 
                color: 'var(--text-accent)', 
                marginBottom: '1rem' 
              }} />
              <h3 style={{ marginBottom: '0.75rem', fontSize: '1.25rem' }}>
                Easy Integration
              </h3>
              <p style={{ 
                color: 'var(--text-secondary)', 
                fontSize: '0.95rem',
                lineHeight: 1.6
              }}>
                Simple URL structure. Add to your app in minutes with our integration
                guide.
              </p>
            </div>
          </div>
        </div>

        {/* Example Section - Diagonal Layout */}
        <section style={{ 
          position: 'relative',
          marginBottom: '8rem',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(12, 1fr)',
            gap: '2rem',
            alignItems: 'center'
          }}>
            {/* Heading - Offset */}
            <div style={{ 
              gridColumn: '1 / span 5',
              position: 'sticky',
              top: '2rem'
            }}>
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
            </div>

            {/* Example Links - Offset */}
            <div style={{
              gridColumn: '7 / span 6',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}>
              <Link
                href="/bsky.app/app.bsky.feed.post/3kvob7fuunk2s"
                className="waypoint-button example-link"
                style={{ 
                  textDecoration: 'none',
                  transform: 'rotate(0.5deg)'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div className="waypoint-name">Example Post</div>
                  <div className="waypoint-description">
                    bsky.app/app.bsky.feed.post/3kvob7fuunk2s
                  </div>
                </div>
                <ArrowRight size={20} style={{ color: 'var(--text-tertiary)' }} />
              </Link>

              <Link
                href="/bsky.app"
                className="waypoint-button example-link"
                style={{ 
                  textDecoration: 'none',
                  transform: 'rotate(-0.3deg)'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div className="waypoint-name">Example Profile</div>
                  <div className="waypoint-description">bsky.app</div>
                </div>
                <ArrowRight size={20} style={{ color: 'var(--text-tertiary)' }} />
              </Link>
            </div>
          </div>
        </section>

        {/* CTA Section - Full Width Breakout */}
        <section
          className="card cta-card"
          style={{
            padding: '4rem 3rem',
            textAlign: 'center',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            position: 'relative',
            transform: 'rotate(-0.2deg)',
            transition: 'all 0.4s ease',
            marginTop: '4rem'
          }}
        >
          <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <h2 style={{ 
              marginBottom: '1.5rem', 
              color: 'var(--text-accent)',
              fontSize: '2rem',
              fontWeight: 400
            }}>
              Integrate into your app
            </h2>
            <p
              style={{
                color: 'var(--text-secondary)',
                marginBottom: '2.5rem',
                fontSize: '1.05rem',
                lineHeight: 1.7
              }}
            >
              Add universal sharing to your ATProto application. Simple, clean, and
              helps grow the ecosystem.
            </p>
            <Link
              href="/integrate"
              className="cta-button"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '1.25rem 2.5rem',
                background: 'var(--accent-moss)',
                color: 'var(--text-primary)',
                border: '1px solid var(--accent-forest)',
                fontSize: '1.05rem',
                transition: 'all 0.3s ease',
                fontWeight: 400
              }}
            >
              View Integration Guide
              <ArrowRight size={20} />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

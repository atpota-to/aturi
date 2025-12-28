'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Link2, Code, Globe, Sparkles, Check } from 'lucide-react';
import Header from '@/components/Header';
import { convertToAturiLink } from '@/utils/linkGenerator';
import { getWaypointCount } from '@/utils/waypoints';

export default function HomePage() {
  const [quickInput, setQuickInput] = useState('');
  const [quickGenerated, setQuickGenerated] = useState<string | null>(null);
  const [quickCopied, setQuickCopied] = useState(false);
  const waypointCount = getWaypointCount();

  const handleQuickGenerate = () => {
    if (!quickInput.trim()) return;
    
    const link = convertToAturiLink(quickInput);
    if (link) {
      setQuickGenerated(link);
      // Auto copy to clipboard
      navigator.clipboard.writeText(link);
      setQuickCopied(true);
      setTimeout(() => {
        setQuickCopied(false);
        setQuickGenerated(null);
        setQuickInput('');
      }, 3000);
    }
  };

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Hero Section */}
      <div style={{ padding: '2rem 2rem 0' }}>
        <Header />
      </div>

      {/* Quick Link Creator */}
      <div style={{ 
        maxWidth: '700px', 
        margin: '0 auto 3rem',
        padding: '0 2rem'
      }}>
        <div 
          style={{
            padding: '1.5rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            transform: 'rotate(0.3deg)',
            transition: 'all 0.4s ease',
            position: 'relative'
          }}
          className="card"
        >
          <div style={{
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'stretch',
            flexWrap: 'wrap'
          }}>
            <input
              type="text"
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleQuickGenerate();
                }
              }}
              placeholder="Paste any ATProto URL..."
              style={{
                flex: 1,
                minWidth: '250px',
                padding: '0.875rem 1rem',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                fontFamily: 'var(--font-mono)',
                transition: 'all 0.3s ease',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'var(--text-accent)';
                e.target.style.outline = 'none';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'var(--border-medium)';
              }}
            />

            <button
              onClick={handleQuickGenerate}
              disabled={!quickInput.trim()}
              className="generate-button"
              style={{
                padding: '0.875rem 1.5rem',
                background: quickInput.trim() ? 'var(--accent-moss)' : 'var(--bg-tertiary)',
                color: quickInput.trim() ? 'var(--text-primary)' : 'var(--text-tertiary)',
                border: '1px solid',
                borderColor: quickInput.trim() ? 'var(--accent-forest)' : 'var(--border-medium)',
                fontSize: '0.9rem',
                fontWeight: 400,
                cursor: quickInput.trim() ? 'pointer' : 'not-allowed',
                transition: 'all 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                whiteSpace: 'nowrap'
              }}
            >
              {quickCopied ? <Check size={16} /> : <Link2 size={16} />}
              <span>{quickCopied ? 'Copied!' : 'Create'}</span>
            </button>
          </div>

          {quickGenerated && (
            <div style={{
              marginTop: '1rem',
              padding: '0.875rem 1rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-strong)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
              color: 'var(--text-accent)',
              wordBreak: 'break-all',
              animation: 'content-appear 0.3s ease-out'
            }}>
              {quickGenerated}
            </div>
          )}
        </div>
      </div>

      {/* Main Content - Asymmetric Layout */}
      <div style={{ 
        maxWidth: '1400px', 
        margin: '0 auto',
        padding: '0 2rem 4rem',
        position: 'relative'
      }}>
        
        {/* Feature Cards - Organic Staggered Layout */}
        <div 
          className="feature-cards-grid"
          style={{ 
            display: 'grid',
            gridTemplateColumns: 'repeat(12, 1fr)',
            gap: '1.5rem',
            marginBottom: '8rem',
            position: 'relative'
          }}
        >
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
                  One link works across your favorite clients. Share posts, profiles, and lists
                  on curated ATProto platforms without worrying about compatibility.
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
                  <span>{waypointCount} curated ATProto apps</span>
                </div>
              </div>
            </div>
          </div>

          {/* Smaller Cards - Stacked */}
          <div 
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
                Recipients pick their preferred platform. Bluesky, Blacksky, Anisota,
                Red Dwarf, Leaflet, pdsls, or atp.tools.
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
          <div 
            className="examples-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(12, 1fr)',
              gap: '2rem',
              alignItems: 'center'
            }}
          >
            {/* Heading - Offset */}
            <div 
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
            </div>

            {/* Example Links - Offset */}
            <div 
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

        {/* Submit Your App Card */}
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
              Building an ATProto client or tool? We&apos;d love to consider adding it to our curated list of waypoints.
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
      </div>
    </div>
  );
}

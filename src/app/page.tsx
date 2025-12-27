import Link from 'next/link';
import { ArrowRight, Link2, Code, Globe } from 'lucide-react';
import Header from '@/components/Header';

export default function HomePage() {
  return (
    <div className="container" style={{ padding: '4rem 2rem' }}>
      {/* Hero Section */}
      <Header />

      {/* Features Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '2rem',
          marginBottom: '6rem',
        }}
      >
        <div className="card">
          <Link2 size={32} style={{ color: 'var(--text-accent)', marginBottom: '1rem' }} />
          <h3 style={{ marginBottom: '0.75rem' }}>Universal Sharing</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            One link works everywhere. Share posts, profiles, and lists across all
            ATProto clients.
          </p>
        </div>

        <div className="card">
          <Globe size={32} style={{ color: 'var(--text-accent)', marginBottom: '1rem' }} />
          <h3 style={{ marginBottom: '0.75rem' }}>Choose Your View</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Recipients pick their preferred platform. Bluesky, Blacksky, pdsls,
            or any ATProto client.
          </p>
        </div>

        <div className="card">
          <Code size={32} style={{ color: 'var(--text-accent)', marginBottom: '1rem' }} />
          <h3 style={{ marginBottom: '0.75rem' }}>Easy Integration</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Simple URL structure. Add to your app in minutes with our integration
            guide.
          </p>
        </div>
      </div>

      {/* Example Links */}
      <section style={{ marginBottom: '6rem' }}>
        <h2
          style={{
            textAlign: 'center',
            marginBottom: '3rem',
            color: 'var(--text-accent)',
          }}
        >
          Try it yourself
        </h2>
        <div
          style={{
            maxWidth: '700px',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <Link
            href="/bsky.app/app.bsky.feed.post/3kvob7fuunk2s"
            className="waypoint-button"
            style={{ textDecoration: 'none' }}
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
            className="waypoint-button"
            style={{ textDecoration: 'none' }}
          >
            <div style={{ flex: 1 }}>
              <div className="waypoint-name">Example Profile</div>
              <div className="waypoint-description">bsky.app</div>
            </div>
            <ArrowRight size={20} style={{ color: 'var(--text-tertiary)' }} />
          </Link>
        </div>
      </section>

      {/* CTA Section */}
      <section
        className="card"
        style={{
          maxWidth: '800px',
          margin: '0 auto',
          textAlign: 'center',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-strong)',
        }}
      >
        <h2 style={{ marginBottom: '1rem', color: 'var(--text-accent)' }}>
          Integrate into your app
        </h2>
        <p
          style={{
            color: 'var(--text-secondary)',
            marginBottom: '2rem',
            fontSize: '1.05rem',
          }}
        >
          Add universal sharing to your ATProto application. Simple, clean, and
          helps grow the ecosystem.
        </p>
        <Link
          href="/integrate"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '1rem 2rem',
            background: 'var(--accent-moss)',
            color: 'var(--text-primary)',
            border: '1px solid var(--accent-forest)',
            fontSize: '1.05rem',
            transition: 'all 0.3s ease',
          }}
        >
          View Integration Guide
          <ArrowRight size={20} />
        </Link>
      </section>
    </div>
  );
}

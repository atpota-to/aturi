'use client';

import Link from 'next/link';
import { ArrowLeft, GitFork, Terminal, Settings, Zap } from 'lucide-react';

export default function ForkPage() {
  return (
    <div className="container-narrow" style={{ padding: '4rem 2rem' }}>
      {/* Back link */}
      <Link
        href="/"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '3rem',
          color: 'var(--text-accent)',
          fontSize: '0.95rem',
        }}
      >
        <ArrowLeft size={16} />
        Back to home
      </Link>

      {/* Header */}
      <header style={{ marginBottom: '3rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <GitFork size={32} style={{ color: 'var(--text-accent)' }} />
          <h1>Fork aturi.to</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem' }}>
          Run your own ATProto link sharing service with a custom domain
        </p>
      </header>

      {/* Why Fork */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-accent)' }}>
          Why Fork?
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card">
            <h3 style={{ marginBottom: '0.5rem' }}>Community-Specific</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              Create a version tailored to your community with custom branding and curated platforms.
            </p>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: '0.5rem' }}>Regional Optimization</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              Host closer to your users for faster load times and better performance.
            </p>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: '0.5rem' }}>Full Control</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              Self-host on your infrastructure with complete control over features and data.
            </p>
          </div>
        </div>
      </section>

      {/* Quick Start */}
      <section style={{ marginBottom: '3rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <Zap size={24} style={{ color: 'var(--text-accent)' }} />
          <h2 style={{ color: 'var(--text-accent)' }}>Quick Start</h2>
        </div>
        
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Interactive Setup (Recommended)</h3>
          <pre>{`# Clone the repository
git clone https://github.com/yourusername/aturi-to.git my-instance
cd my-instance

# Run interactive setup
npm run setup-fork

# Install and start
npm install
npm run dev`}</pre>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '1rem' }}>
            The setup script will ask for your domain, name, and preferences, then create a 
            <code style={{ margin: '0 0.25rem' }}>.env.local</code> file with your configuration.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <Link
            href="/fork#manual-setup"
            className="card"
            style={{
              flex: '1',
              minWidth: '200px',
              textDecoration: 'none',
              color: 'inherit',
              cursor: 'pointer',
              transition: 'border-color 0.2s ease',
            }}
          >
            <Terminal size={20} style={{ color: 'var(--text-accent)', marginBottom: '0.5rem' }} />
            <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Manual Setup</h3>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
              Step-by-step instructions
            </p>
          </Link>
          
          <a
            href="https://github.com/yourusername/aturi-to/blob/main/QUICKSTART.md"
            target="_blank"
            rel="noopener noreferrer"
            className="card"
            style={{
              flex: '1',
              minWidth: '200px',
              textDecoration: 'none',
              color: 'inherit',
              cursor: 'pointer',
              transition: 'border-color 0.2s ease',
            }}
          >
            <Settings size={20} style={{ color: 'var(--text-accent)', marginBottom: '0.5rem' }} />
            <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Full Guide</h3>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
              Detailed documentation
            </p>
          </a>
        </div>
      </section>

      {/* Configuration */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-accent)' }}>
          Configuration
        </h2>
        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
          Customize your instance through environment variables:
        </p>
        <div className="card">
          <pre>{`# .env.local
NEXT_PUBLIC_DOMAIN=yourdomain.com
NEXT_PUBLIC_SITE_NAME=Your Site Name
NEXT_PUBLIC_SITE_DESCRIPTION=Your description
NEXT_PUBLIC_AUTHOR_NAME=Your Name
NEXT_PUBLIC_REPO_URL=https://github.com/you/your-fork`}</pre>
        </div>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', marginTop: '1rem' }}>
          See <code>.env.example</code> for all available options.
        </p>
      </section>

      {/* Manual Setup */}
      <section id="manual-setup" style={{ marginBottom: '3rem' }}>
        <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-accent)' }}>
          Manual Setup
        </h2>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card">
            <h3 style={{ marginBottom: '0.75rem' }}>1. Clone & Configure</h3>
            <pre style={{ fontSize: '0.9rem' }}>{`git clone https://github.com/yourusername/aturi-to.git
cd aturi-to
cp .env.example .env.local
# Edit .env.local with your settings`}</pre>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '0.75rem' }}>2. Customize Waypoints</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '0.5rem' }}>
              Edit <code>src/utils/waypoints.tsx</code> to add/remove platforms:
            </p>
            <pre style={{ fontSize: '0.9rem' }}>{`export const waypoints: Waypoint[] = [
  {
    id: 'your-platform',
    name: 'Your Platform',
    urlPattern: (repo, collection, rkey) => {
      return \`https://platform.com/\${repo}/\${rkey}\`;
    },
  },
];`}</pre>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '0.75rem' }}>3. Update Branding</h3>
            <ul style={{ 
              color: 'var(--text-secondary)', 
              fontSize: '0.95rem',
              paddingLeft: '1.5rem',
              margin: '0.5rem 0 0 0'
            }}>
              <li>Replace logo in <code>public/</code></li>
              <li>Update colors in <code>src/app/globals.css</code></li>
              <li>Modify metadata in <code>src/app/layout.tsx</code></li>
            </ul>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '0.75rem' }}>4. Deploy</h3>
            <pre style={{ fontSize: '0.9rem' }}>{`npm install
npm run dev  # Test locally

# Deploy to Vercel
vercel
# Add env vars in Vercel dashboard
# Add custom domain in Vercel settings`}</pre>
          </div>
        </div>
      </section>

      {/* GPL Requirements */}
      <section className="card" style={{ 
        marginBottom: '3rem',
        background: 'var(--bg-elevated)',
        borderLeft: '3px solid var(--text-accent)'
      }}>
        <h3 style={{ marginBottom: '0.75rem', color: 'var(--text-accent)' }}>
          ⚖️ GPL v3 Requirements
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '0.75rem' }}>
          When forking aturi.to, you must:
        </p>
        <ul style={{ 
          color: 'var(--text-secondary)', 
          fontSize: '0.95rem',
          paddingLeft: '1.5rem',
          margin: 0
        }}>
          <li>Keep your source code publicly available</li>
          <li>Use GPL v3 or later for your fork</li>
          <li>Include the LICENSE file</li>
          <li>Mark any changes you make</li>
        </ul>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', marginTop: '0.75rem' }}>
          Attribution to the original project is appreciated and helps the ecosystem!
        </p>
      </section>

      {/* Resources */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-accent)' }}>
          Resources
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <a
            href="https://github.com/yourusername/aturi-to/blob/main/QUICKSTART.md"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--text-accent)',
              textDecoration: 'none',
              fontSize: '0.95rem',
            }}
          >
            → Quick Start Guide (10 minutes)
          </a>
          <a
            href="https://github.com/yourusername/aturi-to/blob/main/FORKING.md"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--text-accent)',
              textDecoration: 'none',
              fontSize: '0.95rem',
            }}
          >
            → Complete Forking Guide
          </a>
          <a
            href="https://github.com/yourusername/aturi-to/blob/main/CONTRIBUTING.md"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--text-accent)',
              textDecoration: 'none',
              fontSize: '0.95rem',
            }}
          >
            → Contributing Guidelines
          </a>
          <Link
            href="/integrate"
            style={{
              color: 'var(--text-accent)',
              textDecoration: 'none',
              fontSize: '0.95rem',
            }}
          >
            → Integration Guide
          </Link>
        </div>
      </section>

      {/* Support */}
      <section className="card" style={{ background: 'var(--bg-elevated)', textAlign: 'center' }}>
        <h2 style={{ marginBottom: '1rem', color: 'var(--text-accent)' }}>
          Need Help?
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Check the documentation or open an issue on GitHub.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/"
            style={{
              color: 'var(--text-accent)',
              textDecoration: 'underline',
              textUnderlineOffset: '3px',
            }}
          >
            Back to home
          </Link>
          <a
            href="https://github.com/yourusername/aturi-to/issues"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--text-accent)',
              textDecoration: 'underline',
              textUnderlineOffset: '3px',
            }}
          >
            Report an issue
          </a>
        </div>
      </section>
    </div>
  );
}



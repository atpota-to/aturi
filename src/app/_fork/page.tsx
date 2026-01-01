'use client';

import Link from 'next/link';
import { GitFork, Terminal, Settings, Zap } from 'lucide-react';
import Header from '@/components/Header';

export default function ForkPage() {
  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Site Header */}
      <div style={{ padding: '2rem 2rem 0' }}>
        <Header simple />
      </div>

      {/* Hero Section - Asymmetric */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 5rem',
        padding: '0 2rem'
      }}>
        <div 
          className="card fork-hero-card"
          style={{ 
            padding: '3.5rem',
            transform: 'rotate(-0.3deg)',
            transition: 'all 0.4s ease',
            marginBottom: '3rem'
          }}
        >
          <div className="fork-hero-content" style={{ display: 'flex', alignItems: 'flex-start', gap: '1.5rem' }}>
            <GitFork size={48} style={{ color: 'var(--text-accent)', flexShrink: 0 }} />
            <div>
              <h1 style={{ marginBottom: '1rem', fontSize: '2.75rem', fontWeight: 300 }}>
                Fork aturi.to
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem', lineHeight: 1.7 }}>
                Run your own ATProto link sharing service with a custom domain
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Why Fork - Asymmetric Grid */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 6rem',
        padding: '0 2rem'
      }}>
        <h2 style={{ 
          marginBottom: '3rem', 
          color: 'var(--text-accent)',
          fontSize: '2rem',
          fontWeight: 300,
          textAlign: 'center'
        }}>
          Why Fork?
        </h2>

        <div className="fork-why-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: '1.5rem'
        }}>
          <div 
            className="card" 
            style={{ 
              gridColumn: 'span 4',
              padding: '2.5rem',
              transform: 'rotate(0.4deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '1rem', fontSize: '1.4rem', fontWeight: 400 }}>
              Community-Specific
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6 }}>
              Create a version tailored to your community with custom branding and curated platforms.
            </p>
          </div>

          <div 
            className="card" 
            style={{ 
              gridColumn: 'span 4',
              padding: '2.5rem',
              transform: 'rotate(-0.3deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '1rem', fontSize: '1.4rem', fontWeight: 400 }}>
              Regional Optimization
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6 }}>
              Host closer to your users for faster load times and better performance.
            </p>
          </div>

          <div 
            className="card" 
            style={{ 
              gridColumn: 'span 4',
              padding: '2.5rem',
              transform: 'rotate(0.2deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '1rem', fontSize: '1.4rem', fontWeight: 400 }}>
              Full Control
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6 }}>
              Self-host on your infrastructure with complete control over features and data.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Start - Featured Section */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 6rem',
        padding: '0 2rem'
      }}>
        <div className="fork-quick-start-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: '2rem',
          alignItems: 'start'
        }}>
          <div style={{ gridColumn: '1 / span 4' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <Zap size={32} style={{ color: 'var(--text-accent)' }} />
              <h2 style={{ color: 'var(--text-accent)', fontSize: '2rem', fontWeight: 300 }}>
                Quick Start
              </h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Get your instance up and running in just a few minutes
            </p>
          </div>
          
          <div 
            className="card" 
            style={{ 
              gridColumn: '6 / span 7',
              padding: '2.5rem',
              transform: 'rotate(-0.4deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 400 }}>
              Interactive Setup (Recommended)
            </h3>
            <pre style={{
              background: 'var(--bg-primary)',
              padding: '1.5rem',
              border: '1px solid var(--border-medium)',
              fontSize: '0.9rem',
              lineHeight: 1.7,
              overflow: 'auto',
              marginBottom: '1.25rem'
            }}>{`# Clone the repository
git clone https://github.com/yourusername/aturi-to.git my-instance
cd my-instance

# Run interactive setup
node scripts/setup-fork.js

# Install and start
npm install
npm run dev`}</pre>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
              The setup script will ask for your domain, name, and preferences, then create a 
              <code style={{ margin: '0 0.25rem', padding: '0.125rem 0.375rem', background: 'var(--bg-primary)', border: '1px solid var(--border-medium)' }}>.env.local</code> 
              file with your configuration.
            </p>
          </div>
        </div>

        {/* Quick Links */}
        <div className="fork-quick-links-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: '1.5rem',
          marginTop: '2rem'
        }}>
          <div style={{ gridColumn: '1 / span 4' }}></div>
          
          <Link
            href="/fork#manual-setup"
            className="card"
            style={{
              gridColumn: '6 / span 3',
              padding: '2rem',
              textDecoration: 'none',
              color: 'inherit',
              cursor: 'pointer',
              transition: 'all 0.4s ease',
              transform: 'rotate(0.3deg)',
            }}
          >
            <Terminal size={24} style={{ color: 'var(--text-accent)', marginBottom: '0.75rem' }} />
            <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem', fontWeight: 400 }}>Manual Setup</h3>
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
              gridColumn: '9 / span 4',
              padding: '2rem',
              textDecoration: 'none',
              color: 'inherit',
              cursor: 'pointer',
              transition: 'all 0.4s ease',
              transform: 'rotate(-0.2deg)',
            }}
          >
            <Settings size={24} style={{ color: 'var(--text-accent)', marginBottom: '0.75rem' }} />
            <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem', fontWeight: 400 }}>Full Guide</h3>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
              Detailed documentation
            </p>
          </a>
        </div>
      </div>

      {/* Configuration - Diagonal Layout */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 6rem',
        padding: '0 2rem'
      }}>
        <div className="fork-config-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: '2rem',
          alignItems: 'start'
        }}>
          <div style={{ gridColumn: '1 / span 5' }}>
            <h2 style={{ 
              marginBottom: '1rem', 
              color: 'var(--text-accent)',
              fontSize: '2rem',
              fontWeight: 300
            }}>
              Configuration
            </h2>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Customize your instance through environment variables
            </p>
          </div>

          <div 
            className="card"
            style={{ 
              gridColumn: '7 / span 6',
              padding: '2.5rem',
              transform: 'rotate(0.3deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <pre style={{
              background: 'var(--bg-primary)',
              padding: '1.5rem',
              border: '1px solid var(--border-medium)',
              fontSize: '0.9rem',
              lineHeight: 1.7,
              overflow: 'auto',
              marginBottom: '1rem'
            }}>{`# .env.local
NEXT_PUBLIC_DOMAIN=yourdomain.com
NEXT_PUBLIC_SITE_NAME=Your Site Name
NEXT_PUBLIC_SITE_DESCRIPTION=Your description
NEXT_PUBLIC_AUTHOR_NAME=Your Name
NEXT_PUBLIC_REPO_URL=https://github.com/you/your-fork`}</pre>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
              See <code style={{ padding: '0.125rem 0.375rem', background: 'var(--bg-primary)', border: '1px solid var(--border-medium)' }}>.env.example</code> for all available options.
            </p>
          </div>
        </div>
      </div>

      {/* Manual Setup - Organic Staggered Cards */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 6rem',
        padding: '0 2rem'
      }} id="manual-setup">
        <h2 style={{ 
          marginBottom: '3rem', 
          color: 'var(--text-accent)',
          fontSize: '2rem',
          fontWeight: 300,
          textAlign: 'center'
        }}>
          Manual Setup
        </h2>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <div 
            className="card" 
            style={{ 
              padding: '2.5rem',
              transform: 'rotate(0.3deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '1.25rem', fontSize: '1.5rem', fontWeight: 400 }}>
              1. Clone & Configure
            </h3>
            <pre style={{
              background: 'var(--bg-primary)',
              padding: '1.5rem',
              border: '1px solid var(--border-medium)',
              fontSize: '0.9rem',
              lineHeight: 1.7,
              overflow: 'auto'
            }}>{`git clone https://github.com/yourusername/aturi-to.git
cd aturi-to
cp .env.example .env.local
# Edit .env.local with your settings`}</pre>
          </div>

          <div 
            className="card" 
            style={{ 
              padding: '2.5rem',
              transform: 'rotate(-0.4deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '1.25rem', fontSize: '1.5rem', fontWeight: 400 }}>
              2. Customize Waypoints
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '1rem', lineHeight: 1.6 }}>
              Edit <code style={{ padding: '0.125rem 0.375rem', background: 'var(--bg-primary)', border: '1px solid var(--border-medium)' }}>src/utils/waypoints.tsx</code> to add/remove platforms:
            </p>
            <pre style={{
              background: 'var(--bg-primary)',
              padding: '1.5rem',
              border: '1px solid var(--border-medium)',
              fontSize: '0.9rem',
              lineHeight: 1.7,
              overflow: 'auto'
            }}>{`export const waypoints: Waypoint[] = [
  {
    id: 'your-platform',
    name: 'Your Platform',
    urlPattern: (repo, collection, rkey) => {
      return \`https://platform.com/\${repo}/\${rkey}\`;
    },
  },
];`}</pre>
          </div>

          <div 
            className="card" 
            style={{ 
              padding: '2.5rem',
              transform: 'rotate(0.2deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '1.25rem', fontSize: '1.5rem', fontWeight: 400 }}>
              3. Update Branding
            </h3>
            <ul style={{ 
              color: 'var(--text-secondary)', 
              fontSize: '0.95rem',
              paddingLeft: '1.5rem',
              margin: 0,
              lineHeight: 2
            }}>
              <li>Replace logo in <code style={{ padding: '0.125rem 0.375rem', background: 'var(--bg-primary)', border: '1px solid var(--border-medium)' }}>public/</code></li>
              <li>Update colors in <code style={{ padding: '0.125rem 0.375rem', background: 'var(--bg-primary)', border: '1px solid var(--border-medium)' }}>src/app/globals.css</code></li>
              <li>Modify metadata in <code style={{ padding: '0.125rem 0.375rem', background: 'var(--bg-primary)', border: '1px solid var(--border-medium)' }}>src/app/layout.tsx</code></li>
            </ul>
          </div>

          <div 
            className="card" 
            style={{ 
              padding: '2.5rem',
              transform: 'rotate(-0.3deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <h3 style={{ marginBottom: '1.25rem', fontSize: '1.5rem', fontWeight: 400 }}>
              4. Test & Deploy
            </h3>
            <pre style={{
              background: 'var(--bg-primary)',
              padding: '1.5rem',
              border: '1px solid var(--border-medium)',
              fontSize: '0.9rem',
              lineHeight: 1.7,
              overflow: 'auto',
              marginBottom: '1rem'
            }}>{`npm install
npm run dev  # Test locally at http://localhost:3000

# Deploy to Vercel
vercel
# Add env vars in Vercel dashboard
# Add custom domain in Vercel settings`}</pre>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
              Test profile links and post links to ensure everything works before going live.
            </p>
          </div>
        </div>
      </div>

      {/* GPL Requirements - Featured Card */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 6rem',
        padding: '0 2rem'
      }}>
        <div 
          className="card" 
          style={{ 
            padding: '3rem',
            background: 'var(--bg-elevated)',
            borderLeft: '3px solid var(--text-accent)',
            transform: 'rotate(-0.2deg)',
            transition: 'all 0.4s ease',
          }}
        >
          <h3 style={{ marginBottom: '1.25rem', color: 'var(--text-accent)', fontSize: '1.75rem', fontWeight: 400 }}>
            ⚖️ GPL v3 Requirements
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '1rem', lineHeight: 1.7 }}>
            When forking aturi.to, you must:
          </p>
          <ul style={{ 
            color: 'var(--text-secondary)', 
            fontSize: '1rem',
            paddingLeft: '1.5rem',
            margin: 0,
            lineHeight: 2
          }}>
            <li>Keep your source code publicly available</li>
            <li>Use GPL v3 or later for your fork</li>
            <li>Include the LICENSE file</li>
            <li>Mark any changes you make</li>
          </ul>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', marginTop: '1.25rem', lineHeight: 1.6 }}>
            Attribution to the original project is appreciated and helps the ecosystem!
          </p>
        </div>
      </div>

      {/* Resources - Asymmetric Layout */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 6rem',
        padding: '0 2rem'
      }}>
        <div className="fork-resources-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: '2rem'
        }}>
          <div style={{ gridColumn: '1 / span 4' }}>
            <h2 style={{ 
              marginBottom: '1rem', 
              color: 'var(--text-accent)',
              fontSize: '2rem',
              fontWeight: 300
            }}>
              Resources
            </h2>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Everything you need to get started
            </p>
          </div>

          <div 
            className="card"
            style={{ 
              gridColumn: '6 / span 7',
              padding: '2.5rem',
              transform: 'rotate(0.3deg)',
              transition: 'all 0.4s ease',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <a
                href="https://github.com/yourusername/aturi-to/blob/main/QUICKSTART.md"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-accent)',
                  textDecoration: 'none',
                  fontSize: '1rem',
                  padding: '0.75rem',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-medium)',
                  transition: 'all 0.2s ease',
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
                  fontSize: '1rem',
                  padding: '0.75rem',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-medium)',
                  transition: 'all 0.2s ease',
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
                  fontSize: '1rem',
                  padding: '0.75rem',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-medium)',
                  transition: 'all 0.2s ease',
                }}
              >
                → Contributing Guidelines
              </a>
              <Link
                href="/integrate"
                style={{
                  color: 'var(--text-accent)',
                  textDecoration: 'none',
                  fontSize: '1rem',
                  padding: '0.75rem',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-medium)',
                  transition: 'all 0.2s ease',
                }}
              >
                → Integration Guide
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Support - Full Width Centered */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto 4rem',
        padding: '0 2rem'
      }}>
        <div 
          className="card" 
          style={{ 
            padding: '3rem',
            background: 'var(--bg-elevated)', 
            textAlign: 'center',
            transform: 'rotate(-0.2deg)',
            transition: 'all 0.4s ease',
          }}
        >
          <h2 style={{ marginBottom: '1rem', color: 'var(--text-accent)', fontSize: '2rem', fontWeight: 400 }}>
            Need Help?
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '1.05rem', lineHeight: 1.7 }}>
            Check the documentation or open an issue on GitHub.
          </p>
          <a
            href="https://github.com/yourusername/aturi-to/issues"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.875rem 1.75rem',
              background: 'var(--accent-moss)',
              border: '1px solid var(--accent-forest)',
              color: 'var(--text-primary)',
              textDecoration: 'none',
              fontSize: '1rem',
              transition: 'all 0.3s ease',
              fontWeight: 400
            }}
          >
            Report an issue
          </a>
        </div>
      </div>
    </div>
  );
}



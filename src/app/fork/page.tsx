'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  GitFork,
  Globe,
  Scale,
  Settings,
  SlidersHorizontal,
  Terminal,
  Users,
  Zap,
} from 'lucide-react';
import Header from '@/components/Header';

const WHY = [
  {
    icon: <Users size={18} />,
    title: 'Community-Specific',
    body: 'Create a version tailored to your community with custom branding and curated platforms.',
  },
  {
    icon: <Globe size={18} />,
    title: 'Regional Optimization',
    body: 'Host closer to your users for faster load times and better performance.',
  },
  {
    icon: <SlidersHorizontal size={18} />,
    title: 'Full Control',
    body: 'Self-host on your infrastructure with complete control over features and data.',
  },
];

const RESOURCES = [
  {
    href: 'https://github.com/yourusername/aturi-to/blob/main/QUICKSTART.md',
    label: 'Quick Start Guide (10 minutes)',
  },
  {
    href: 'https://github.com/yourusername/aturi-to/blob/main/FORKING.md',
    label: 'Complete Forking Guide',
  },
  {
    href: 'https://github.com/yourusername/aturi-to/blob/main/CONTRIBUTING.md',
    label: 'Contributing Guidelines',
  },
];

export default function ForkPage() {
  return (
    <>
      <Header compact />
      <div className="container-narrow fl-container">
        <div className="fl-page fl-fork">
          {/* Hero */}
          <header className="fl-hero-copy fl-fork-hero">
            <span className="fl-pill">
              <GitFork size={13} aria-hidden /> Open source
            </span>
            <h1 className="fl-title">Fork aturi.to</h1>
            <p className="fl-lede">
              Run your own Atmosphere link sharing service with a custom domain
            </p>
          </header>

          {/* Why fork */}
          <section className="fl-section">
            <h2 className="fl-cross-title">Why Fork?</h2>
            <div className="fl-fork-why">
              {WHY.map((w) => (
                <div key={w.title} className="fl-card fl-fork-card">
                  <span className="fl-icon-tile" aria-hidden>
                    {w.icon}
                  </span>
                  <h3>{w.title}</h3>
                  <p>{w.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Quick start */}
          <section className="fl-fork-split">
            <div className="fl-feature-copy">
              <span className="fl-kicker">
                <Zap size={14} aria-hidden /> Get started
              </span>
              <h2 className="fl-h2">Quick Start</h2>
              <p className="fl-body">Get your instance up and running in just a few minutes</p>
            </div>
            <div className="fl-fork-stack">
              <div className="fl-card fl-fork-card">
                <h3>Interactive Setup (Recommended)</h3>
                <pre className="fl-fork-pre">{`# Clone the repository
git clone https://github.com/yourusername/aturi-to.git my-instance
cd my-instance

# Run interactive setup
node scripts/setup-fork.js

# Install and start
npm install
npm run dev`}</pre>
                <p>
                  The setup script will ask for your domain, name, and preferences, then create a{' '}
                  <code className="fl-code">.env.local</code> file with your configuration.
                </p>
              </div>
              <div className="fl-fork-links">
                <Link href="/fork#manual-setup" className="fl-card fl-cross-card">
                  <span className="fl-cross-card-head">
                    <span className="fl-icon-tile" aria-hidden>
                      <Terminal size={18} />
                    </span>
                    <h3>Manual Setup</h3>
                  </span>
                  <p>Step-by-step instructions</p>
                </Link>
                <a
                  href="https://github.com/yourusername/aturi-to/blob/main/QUICKSTART.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="fl-card fl-cross-card"
                >
                  <span className="fl-cross-card-head">
                    <span className="fl-icon-tile" aria-hidden>
                      <Settings size={18} />
                    </span>
                    <h3>Full Guide</h3>
                  </span>
                  <p>Detailed documentation</p>
                </a>
              </div>
            </div>
          </section>

          {/* Configuration */}
          <section className="fl-fork-split">
            <div className="fl-feature-copy">
              <span className="fl-kicker">
                <Settings size={14} aria-hidden /> Environment
              </span>
              <h2 className="fl-h2">Configuration</h2>
              <p className="fl-body">Customize your instance through environment variables</p>
            </div>
            <div className="fl-card fl-fork-card">
              <pre className="fl-fork-pre">{`# .env.local
NEXT_PUBLIC_DOMAIN=yourdomain.com
NEXT_PUBLIC_SITE_NAME=Your Site Name
NEXT_PUBLIC_SITE_DESCRIPTION=Your description
NEXT_PUBLIC_AUTHOR_NAME=Your Name
NEXT_PUBLIC_REPO_URL=https://github.com/you/your-fork`}</pre>
              <p>
                See <code className="fl-code">.env.example</code> for all available options.
              </p>
            </div>
          </section>

          {/* Manual setup */}
          <section className="fl-section" id="manual-setup">
            <div className="fl-section-head">
              <span className="fl-kicker">
                <Terminal size={14} aria-hidden /> Step by step
              </span>
              <h2 className="fl-h2">Manual Setup</h2>
            </div>
            <ol className="fl-fork-steps">
              <li className="fl-card fl-fork-card">
                <h3>
                  <span className="fl-fork-num">1</span> Clone &amp; Configure
                </h3>
                <pre className="fl-fork-pre">{`git clone https://github.com/yourusername/aturi-to.git
cd aturi-to
cp .env.example .env.local
# Edit .env.local with your settings`}</pre>
              </li>

              <li className="fl-card fl-fork-card">
                <h3>
                  <span className="fl-fork-num">2</span> Customize Waypoints
                </h3>
                <p>
                  Edit <code className="fl-code">src/utils/waypoints.tsx</code> to add/remove platforms:
                </p>
                <pre className="fl-fork-pre">{`export const waypoints: Waypoint[] = [
  {
    id: 'your-platform',
    name: 'Your Platform',
    urlPattern: (repo, collection, rkey) => {
      return \`https://platform.com/\${repo}/\${rkey}\`;
    },
  },
];`}</pre>
              </li>

              <li className="fl-card fl-fork-card">
                <h3>
                  <span className="fl-fork-num">3</span> Update Branding
                </h3>
                <ul className="fl-fork-list">
                  <li>
                    Replace logo in <code className="fl-code">public/</code>
                  </li>
                  <li>
                    Update colors in <code className="fl-code">src/app/globals.css</code>
                  </li>
                  <li>
                    Modify metadata in <code className="fl-code">src/app/layout.tsx</code>
                  </li>
                </ul>
              </li>

              <li className="fl-card fl-fork-card">
                <h3>
                  <span className="fl-fork-num">4</span> Test &amp; Deploy
                </h3>
                <pre className="fl-fork-pre">{`npm install
npm run dev  # Test locally at http://localhost:3000

# Deploy to Vercel
vercel
# Add env vars in Vercel dashboard
# Add custom domain in Vercel settings`}</pre>
                <p>Test profile links and post links to ensure everything works before going live.</p>
              </li>
            </ol>
          </section>

          {/* GPL requirements */}
          <section className="fl-band">
            <span className="fl-kicker">
              <Scale size={14} aria-hidden /> License
            </span>
            <h2 className="fl-h2">GPL v3 Requirements</h2>
            <div className="fl-body">
              <p>When forking aturi.to, you must:</p>
              <ul className="fl-fork-list">
                <li>Keep your source code publicly available</li>
                <li>Use GPL v3 or later for your fork</li>
                <li>Include the LICENSE file</li>
                <li>Mark any changes you make</li>
              </ul>
              <p className="fl-fork-note">
                Attribution to the original project is appreciated and helps the ecosystem!
              </p>
            </div>
          </section>

          {/* Resources */}
          <section className="fl-fork-split">
            <div className="fl-feature-copy">
              <span className="fl-kicker">
                <BookOpen size={14} aria-hidden /> Docs
              </span>
              <h2 className="fl-h2">Resources</h2>
              <p className="fl-body">Everything you need to get started</p>
            </div>
            <div className="fl-card fl-fork-resources">
              {RESOURCES.map((r) => (
                <a key={r.href} href={r.href} target="_blank" rel="noopener noreferrer">
                  {r.label}
                  <ArrowRight size={15} aria-hidden />
                </a>
              ))}
            </div>
          </section>

          {/* Support */}
          <section className="fl-card fl-fork-help">
            <div>
              <h2 className="fl-cross-title">Need Help?</h2>
              <p>Check the documentation or open an issue on GitHub.</p>
            </div>
            <a
              href="https://github.com/yourusername/aturi-to/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="fl-button"
              data-variant="primary"
            >
              Report an issue
            </a>
          </section>
        </div>
      </div>
    </>
  );
}

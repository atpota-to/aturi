'use client';

import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
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
import CodeBlock from '@/components/docs/CodeBlock';

const WHY = [
  {
    icon: <Users size={18} />,
    title: 'Community-specific',
    body: 'Create a version tailored to your community with custom branding and curated platforms.',
  },
  {
    icon: <Globe size={18} />,
    title: 'Regional optimization',
    body: 'Host closer to your users for faster load times and better performance.',
  },
  {
    icon: <SlidersHorizontal size={18} />,
    title: 'Full control',
    body: 'Self-host on your infrastructure with complete control over features and data.',
  },
];

const REPO_URL = 'https://github.com/atpota-to/aturi';

const RESOURCES = [
  {
    href: `${REPO_URL}#running-locally`,
    label: 'Running locally (README)',
  },
  {
    href: `${REPO_URL}#deployment`,
    label: 'Deployment (README)',
  },
  {
    href: `${REPO_URL}/blob/main/CONTRIBUTING.md`,
    label: 'Contributing guidelines',
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
              Run your own Atmosphere link sharing service with a custom domain.
            </p>
          </header>

          {/* Why fork */}
          <section className="fl-section">
            <div className="fl-section-head">
              <span className="fl-kicker">
                <Users size={14} aria-hidden /> Reasons
              </span>
              <h2 className="fl-h2">Why fork?</h2>
            </div>
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
              <h2 className="fl-h2">Quick start</h2>
              <p className="fl-body">Get your instance up and running in a few minutes.</p>
            </div>
            <div className="fl-fork-stack">
              <div className="fl-card fl-fork-card">
                <h3>Clone and run</h3>
                <CodeBlock
                  label="bash"
                  code={`# Clone the repository
git clone ${REPO_URL}.git my-instance
cd my-instance

# Configure, install and start
cp .env.example .env.local
nvm use
npm install
npm run dev`}
                />
                <p>
                  Set your domain, name and links in{' '}
                  <code className="fl-code">.env.local</code>, then open http://localhost:3000.
                </p>
              </div>
              <div className="fl-fork-links">
                <Link href="/fork#manual-setup" className="fl-card fl-cross-card">
                  <span className="fl-cross-card-head">
                    <span className="fl-icon-tile" aria-hidden>
                      <Terminal size={18} />
                    </span>
                    <h3>Manual setup</h3>
                    <ChevronRight size={16} aria-hidden className="fl-cross-card-chev" />
                  </span>
                  <p>Step-by-step instructions</p>
                </Link>
                <a
                  href={`${REPO_URL}#running-locally`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="fl-card fl-cross-card"
                >
                  <span className="fl-cross-card-head">
                    <span className="fl-icon-tile" aria-hidden>
                      <Settings size={18} />
                    </span>
                    <h3>Full guide</h3>
                    <ArrowUpRight size={16} aria-hidden className="fl-cross-card-chev" />
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
              <p className="fl-body">Customize your instance through environment variables.</p>
            </div>
            <div className="fl-card fl-fork-card">
              <CodeBlock
                label="dotenv"
                code={`# .env.local
NEXT_PUBLIC_DOMAIN=yourdomain.com
NEXT_PUBLIC_SITE_NAME=Your Site Name
NEXT_PUBLIC_SITE_DESCRIPTION=Your description
NEXT_PUBLIC_AUTHOR_NAME=Your Name
NEXT_PUBLIC_REPO_URL=https://github.com/you/your-fork`}
              />
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
              <h2 className="fl-h2">Manual setup</h2>
            </div>
            <ol className="fl-fork-steps">
              <li className="fl-card fl-fork-card">
                <h3>
                  <span className="fl-fork-num">1</span> Clone &amp; configure
                </h3>
                <CodeBlock
                  label="bash"
                  code={`git clone ${REPO_URL}.git
cd aturi
cp .env.example .env.local
# Edit .env.local with your settings`}
                />
              </li>

              <li className="fl-card fl-fork-card">
                <h3>
                  <span className="fl-fork-num">2</span> Customize waypoints
                </h3>
                <p>
                  Add or remove apps in{' '}
                  <code className="fl-code">src/utils/waypoints.data.ts</code>, and list each
                  one&rsquo;s id in <code className="fl-code">WAYPOINT_ORDER</code>:
                </p>
                <CodeBlock
                  label="ts"
                  code={`'your-platform': {
  id: 'your-platform',
  name: 'Your Platform',
  description: 'Open it in Your Platform',
  getUrl: (handle, collection, rkey) =>
    \`https://platform.com/\${handle}/\${rkey}\`,
  supportedTypes: ['post', 'profile'],
  category: 'atmosphereApps',
  redirectCompat: [],
},`}
                />
              </li>

              <li className="fl-card fl-fork-card">
                <h3>
                  <span className="fl-fork-num">3</span> Update branding
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
                  <span className="fl-fork-num">4</span> Test &amp; deploy
                </h3>
                <CodeBlock
                  label="bash"
                  code={`npm install
npm run dev  # Test locally at http://localhost:3000

# Deploy to Vercel
vercel
# Add env vars in Vercel dashboard
# Add custom domain in Vercel settings`}
                />
                <p>Test profile links and post links to ensure everything works before going live.</p>
              </li>
            </ol>
          </section>

          {/* GPL requirements */}
          <section className="fl-band">
            <span className="fl-kicker">
              <Scale size={14} aria-hidden /> License
            </span>
            <h2 className="fl-h2">GPL v3 requirements</h2>
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
              <p className="fl-body">Everything you need to get started.</p>
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
              <h2 className="fl-cross-title">Need help?</h2>
              <p>Check the documentation or open an issue on GitHub.</p>
            </div>
            <a
              href={`${REPO_URL}/issues`}
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

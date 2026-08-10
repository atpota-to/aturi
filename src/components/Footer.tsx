import Link from 'next/link';
import { ChevronRight, Leaf } from 'lucide-react';

// IMPORTANT: If you fork aturi.to, you MUST keep it open source under GPL v3.
// This includes keeping the source code available and maintaining the same license.
// Attribution to the original project (made by dame) is appreciated.
// See LICENSE file for full details.

/**
 * The repo lives in two places. GitHub is canonical — issues, pull requests,
 * releases and npm's trusted publishing all point at it — and Tangled is the
 * atproto-native mirror. Both are named in the footer so a contributor lands
 * on the one that accepts their patch.
 */
const GITHUB_REPO_URL = 'https://github.com/atpota-to/aturi';
const TANGLED_REPO_URL = 'https://tangled.org/atpota.to/aturi';

/**
 * Site footer. Two-row layout: a brand+nav grid on top, then a single
 * monospace "made by" line below styled as a pair of at:// breadcrumbs —
 * picks up the AT-URI segment treatment used by the explorer pages so the
 * footer reads as part of the same vocabulary as the rest of the site.
 */
export default function Footer() {
  return (
    <footer
      style={{
        position: 'relative',
        zIndex: 1,
        marginTop: '4rem',
        paddingTop: '2.25rem',
        paddingBottom: '2.25rem',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <div className="footer-inner">
        <div className="footer-grid">
          {/* Brand */}
          <div className="footer-brand">
            <span
              aria-hidden
              className="footer-mark"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 38,
                height: 38,
                border: '1px solid var(--border-medium)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-accent)',
                flexShrink: 0,
                transform: 'rotate(-2deg)',
              }}
            >
              <Leaf size={18} strokeWidth={1.5} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: '1.5rem',
                  fontWeight: 300,
                  lineHeight: 1,
                  background:
                    'linear-gradient(135deg, var(--text-primary) 0%, var(--text-accent) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                aturi
              </div>
              <div
                style={{
                  marginTop: '0.3rem',
                  fontSize: '0.75rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-serif)',
                }}
              >
                Tour the Atmosphere
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="footer-nav" aria-label="Site">
            <Link href="/docs" className="footer-link">
              Docs
            </Link>
            <Link href="/terms" className="footer-link">
              Terms &amp; Privacy
            </Link>
            <div className="footer-source">
              <span className="footer-source-label">Source</span>
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link footer-source-primary"
                aria-label="Source code on GitHub"
              >
                GitHub
              </a>
              <span className="footer-source-sep" aria-hidden>
                /
              </span>
              <a
                href={TANGLED_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link"
                aria-label="Source code mirror on Tangled"
              >
                Tangled<span className="footer-source-note">mirror</span>
              </a>
            </div>
            <a
              href={`${GITHUB_REPO_URL}/blob/main/LICENSE`}
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
            >
              License
            </a>
          </nav>
        </div>

        {/* AT-URI styled credits — mirrors the explorer breadcrumb so the
            "made by" line reads as identity, not legalese. */}
        <div className="footer-credits">
          <span className="footer-credits-label">made by</span>
          <a
            href="https://anisota.net"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-uri"
          >
            <span className="footer-uri-scheme">at://</span>
            <span className="footer-uri-handle">anisota.net</span>
          </a>
          <ChevronRight
            size={12}
            aria-hidden
            style={{ color: 'var(--text-tertiary)', opacity: 0.7 }}
          />
          <a
            href="https://atpota.to"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-uri"
          >
            <span className="footer-uri-scheme">at://</span>
            <span className="footer-uri-handle">atpota.to</span>
          </a>
        </div>
      </div>
    </footer>
  );
}

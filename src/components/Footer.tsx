import Link from 'next/link';
import { Leaf } from 'lucide-react';

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
 * Site footer: one white bar under every page. Brand on the left, site links
 * in the middle, credits on the right; it wraps to stacked rows on narrow
 * screens (see .fn-footer in styles/fieldnotes/chrome.css).
 */
export default function Footer() {
  return (
    <footer className="fn-footer">
      <div className="fn-footer-brand">
        <Leaf size={16} strokeWidth={2.2} aria-hidden className="fn-footer-mark" />
        <span className="fn-footer-name">aturi.to</span>
        <span className="fn-footer-tagline">Tour the Atmosphere</span>
      </div>

      {/* Nav: `prefetch={false}` on each link, for the reason spelled out
          above <Header>: the footer renders on every page, so leaving the
          default on made these links a standing cost per render. */}
      <nav className="fn-footer-nav" aria-label="Site">
        <Link href="/docs" className="footer-link" prefetch={false}>
          Docs
        </Link>
        <Link href="/feedback" className="footer-link" prefetch={false}>
          Feedback
        </Link>
        <Link href="/terms" className="footer-link" prefetch={false}>
          Terms &amp; Privacy
        </Link>
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
          aria-label="Source code on GitHub"
        >
          GitHub
        </a>
        <a
          href={TANGLED_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
          aria-label="Source code mirror on Tangled"
          title="Atproto-native mirror of the GitHub repo"
        >
          Tangled
        </a>
        <a
          href={`${GITHUB_REPO_URL}/blob/main/LICENSE`}
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          License
        </a>
      </nav>

      <span className="fn-footer-credits">
        Made by{' '}
        <a href="https://anisota.net" target="_blank" rel="noopener noreferrer" className="fn-footer-handle">
          anisota.net
        </a>{' '}
        &amp;{' '}
        <a href="https://atpota.to" target="_blank" rel="noopener noreferrer" className="fn-footer-handle">
          atpota.to
        </a>
      </span>
    </footer>
  );
}

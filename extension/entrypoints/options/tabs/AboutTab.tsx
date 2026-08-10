import { browser } from '#imports';

const ATURI_SITE = 'https://aturi.to';
// GitHub is the primary repository — issues and pull requests land there.
// Tangled mirrors it for anyone who'd rather browse the source on atproto.
const REPO_URL = 'https://github.com/atpota-to/aturi';
const MIRROR_URL = 'https://tangled.org/atpota.to/aturi';
const PROJECT_HANDLE = 'aturi.to';
const CREATOR_HANDLE = 'dame.is';
const STEWARD_HANDLE = 'atpota.to';

function bskyProfileUrl(handle: string) {
  return `https://bsky.app/profile/${handle}`;
}

function getExtensionVersion(): string | null {
  try {
    if (typeof browser !== 'undefined' && browser.runtime?.getManifest) {
      return browser.runtime.getManifest().version ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

export default function AboutTab() {
  const version = getExtensionVersion();

  return (
    <div>
      <h1 className="options-h1">About</h1>
      <p className="options-lede">
        Aturi makes Atmosphere links shareable with anyone. Drop a person an
        Aturi link and they pick the client they prefer (Bluesky, Anisota,
        Leaflet, Red Dwarf, and more) instead of being locked into yours.
      </p>

      <div className="options-card">
        <div className="options-card-title">Aturi</div>
        <div className="options-card-sub">
          Tour the Atmosphere. The web app and this extension are part of the
          same project. The extension is a quick way to jump between
          Atmosphere clients while you browse.
        </div>
        <div className="about-links">
          <a href={ATURI_SITE} target="_blank" rel="noreferrer" className="about-link">
            <span className="about-link-label">Website</span>
            <span className="about-link-value">aturi.to</span>
          </a>
          <a
            href={bskyProfileUrl(PROJECT_HANDLE)}
            target="_blank"
            rel="noreferrer"
            className="about-link"
          >
            <span className="about-link-label">Project profile</span>
            <span className="about-link-value">@{PROJECT_HANDLE}</span>
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="about-link">
            <span className="about-link-label">Source &amp; issues</span>
            <span className="about-link-value">github.com/atpota-to/aturi</span>
          </a>
          <a href={MIRROR_URL} target="_blank" rel="noreferrer" className="about-link">
            <span className="about-link-label">Tangled mirror</span>
            <span className="about-link-value">tangled.org/atpota.to/aturi</span>
          </a>
        </div>
      </div>

      <div className="options-card">
        <div className="options-card-title">People</div>
        <div className="options-card-sub">
          Aturi is built by Dame and stewarded under the @{STEWARD_HANDLE}{' '}
          umbrella on the Atmosphere. Give them a follow for updates, releases,
          and the occasional bug fight.
        </div>
        <div className="about-links">
          <a
            href={bskyProfileUrl(CREATOR_HANDLE)}
            target="_blank"
            rel="noreferrer"
            className="about-link"
          >
            <span className="about-link-label">Creator</span>
            <span className="about-link-value">@{CREATOR_HANDLE}</span>
          </a>
          <a
            href={bskyProfileUrl(STEWARD_HANDLE)}
            target="_blank"
            rel="noreferrer"
            className="about-link"
          >
            <span className="about-link-label">Steward</span>
            <span className="about-link-value">@{STEWARD_HANDLE}</span>
          </a>
        </div>
      </div>

      <div className="options-card">
        <div className="options-card-title">Feedback</div>
        <div className="options-card-sub">
          Found a bug, want to suggest a new waypoint, or have an idea for the
          popup? File an issue or open a pull request on GitHub. Aturi is
          open source under GPL v3.
        </div>
        <div className="about-links">
          <a
            href={`${REPO_URL}/issues`}
            target="_blank"
            rel="noreferrer"
            className="about-link"
          >
            <span className="about-link-label">Report an issue</span>
            <span className="about-link-value">github.com/atpota-to/aturi/issues</span>
          </a>
          <a
            href={`${REPO_URL}/pulls`}
            target="_blank"
            rel="noreferrer"
            className="about-link"
          >
            <span className="about-link-label">Pull requests</span>
            <span className="about-link-value">github.com/atpota-to/aturi/pulls</span>
          </a>
        </div>
      </div>

      {version && (
        <div className="about-version">Aturi extension v{version}</div>
      )}
    </div>
  );
}

import { browser } from '#imports';
import { t } from '../../../lib/i18n';

const ATURI_SITE = 'https://aturi.to';
const REPO_URL = 'https://tangled.org/atpota.to/aturi';
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
      <h1 className="options-h1">{t('about_h1')}</h1>
      <p className="options-lede">{t('about_lede')}</p>

      <div className="options-card">
        <div className="options-card-title">{t('about_aturiTitle')}</div>
        <div className="options-card-sub">{t('about_aturiSub')}</div>
        <div className="about-links">
          <a href={ATURI_SITE} target="_blank" rel="noreferrer" className="about-link">
            <span className="about-link-label">{t('about_linkWebsite')}</span>
            <span className="about-link-value">aturi.to</span>
          </a>
          <a
            href={bskyProfileUrl(PROJECT_HANDLE)}
            target="_blank"
            rel="noreferrer"
            className="about-link"
          >
            <span className="about-link-label">{t('about_linkProjectProfile')}</span>
            <span className="about-link-value">@{PROJECT_HANDLE}</span>
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="about-link">
            <span className="about-link-label">{t('about_linkSource')}</span>
            <span className="about-link-value">tangled.org/atpota.to/aturi</span>
          </a>
        </div>
      </div>

      <div className="options-card">
        <div className="options-card-title">{t('about_peopleTitle')}</div>
        <div className="options-card-sub">{t('about_peopleSub', STEWARD_HANDLE)}</div>
        <div className="about-links">
          <a
            href={bskyProfileUrl(CREATOR_HANDLE)}
            target="_blank"
            rel="noreferrer"
            className="about-link"
          >
            <span className="about-link-label">{t('about_linkCreator')}</span>
            <span className="about-link-value">@{CREATOR_HANDLE}</span>
          </a>
          <a
            href={bskyProfileUrl(STEWARD_HANDLE)}
            target="_blank"
            rel="noreferrer"
            className="about-link"
          >
            <span className="about-link-label">{t('about_linkSteward')}</span>
            <span className="about-link-value">@{STEWARD_HANDLE}</span>
          </a>
        </div>
      </div>

      <div className="options-card">
        <div className="options-card-title">{t('about_feedbackTitle')}</div>
        <div className="options-card-sub">{t('about_feedbackSub')}</div>
        <div className="about-links">
          <a
            href={`${REPO_URL}/issues`}
            target="_blank"
            rel="noreferrer"
            className="about-link"
          >
            <span className="about-link-label">{t('about_linkReportIssue')}</span>
            <span className="about-link-value">tangled.org/atpota.to/aturi/issues</span>
          </a>
          <a
            href={`${REPO_URL}/pulls`}
            target="_blank"
            rel="noreferrer"
            className="about-link"
          >
            <span className="about-link-label">{t('about_linkPullRequests')}</span>
            <span className="about-link-value">tangled.org/atpota.to/aturi/pulls</span>
          </a>
        </div>
      </div>

      {version && (
        <div className="about-version">{t('about_version', version)}</div>
      )}
    </div>
  );
}

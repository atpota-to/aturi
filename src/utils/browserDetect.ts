export type Browser = 'chrome' | 'firefox' | 'safari' | 'edge' | 'other';

export const BROWSER_LABELS: Record<Browser, string> = {
  chrome: 'Chrome',
  firefox: 'Firefox',
  safari: 'Safari',
  edge: 'Edge',
  other: 'browser',
};

export const EXTENSION_URLS: Record<Browser, string | null> = {
  chrome: 'https://chrome.google.com/webstore/detail/PLACEHOLDER',
  firefox: 'https://addons.mozilla.org/en-US/firefox/addon/PLACEHOLDER',
  edge: 'https://chrome.google.com/webstore/detail/PLACEHOLDER',
  safari: null,
  other: null,
};

export function detectBrowser(): Browser {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;

  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Firefox/')) return 'firefox';
  if (ua.includes('Safari/') && !ua.includes('Chrome/') && !ua.includes('Chromium/')) {
    return 'safari';
  }
  if (ua.includes('Chrome/') || ua.includes('Chromium/')) return 'chrome';
  return 'other';
}

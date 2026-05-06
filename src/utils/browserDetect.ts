export type Browser = 'chrome' | 'firefox' | 'safari' | 'edge' | 'other';

export const BROWSER_LABELS: Record<Browser, string> = {
  chrome: 'Chrome',
  firefox: 'Firefox',
  safari: 'Safari',
  edge: 'Edge',
  other: 'browser',
};

// Until we have published store listings, all download buttons point back to
// the main aturi.to homepage. Browsers we don't yet support (Edge, Safari) get
// `null` so the UI falls back to the supported-browsers list.
export const EXTENSION_URLS: Record<Browser, string | null> = {
  chrome: 'https://aturi.to',
  firefox: 'https://aturi.to',
  edge: null,
  safari: null,
  other: null,
};

export const SUPPORTED_BROWSERS: Browser[] = ['chrome', 'firefox'];

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

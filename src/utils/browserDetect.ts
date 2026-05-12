export type Browser = 'chrome' | 'firefox' | 'safari' | 'edge' | 'other';

export const BROWSER_LABELS: Record<Browser, string> = {
  chrome: 'Chrome',
  firefox: 'Firefox',
  safari: 'Safari',
  edge: 'Edge',
  other: 'browser',
};

// Browsers we don't yet support (Edge, Safari) get `null` so the UI falls back
// to the supported-browsers list.
export const EXTENSION_URLS: Record<Browser, string | null> = {
  chrome: 'https://chromewebstore.google.com/detail/aturi/miblfaecnjbdoabhdmjfagocfokmpmnf',
  firefox: 'https://addons.mozilla.org/en-US/firefox/addon/aturi/',
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

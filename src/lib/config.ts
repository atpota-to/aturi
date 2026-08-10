/**
 * Configuration for aturi.to
 * 
 * If you're forking this project, update these values to customize your instance.
 * You can also use environment variables to override these settings.
 */

/**
 * Reduce a configured domain to a bare host (optionally with a port).
 *
 * NEXT_PUBLIC_DOMAIN is documented as a bare host, but it's easy to paste a
 * full URL into a dashboard env var instead. Left unnormalized, a value like
 * `https://aturi.to` turns `https://${config.domain}` into
 * `https://https://aturi.to`, which `new URL()` re-reads as the host `https`
 * with the path `/aturi.to` — that's what breaks `metadataBase`, and with it
 * every relative og:image, canonical URL, robots.txt and sitemap entry.
 */
function normalizeDomain(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') // drop any scheme
    .replace(/\/.*$/, '') // drop any path/query/hash
    .replace(/\.$/, '') // drop a trailing FQDN dot
    .toLowerCase();
}

/**
 * Coerce a configured base URL into an absolute, origin-only URL with no
 * trailing slash. Accepts bare hosts (`aturi.to`) and full URLs alike, and
 * returns '' when the value can't be parsed so callers fall back to the domain.
 */
function normalizeSiteUrl(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (!url.hostname || url.hostname === 'https' || url.hostname === 'http') return '';
    return url.origin;
  } catch {
    return '';
  }
}

// Site configuration
export const config = {
  // Your domain (change this when forking!)
  // Normalized to a bare host so a full-URL env value can't corrupt every
  // absolute URL the site generates.
  domain: normalizeDomain(process.env.NEXT_PUBLIC_DOMAIN) || 'aturi.to',
  
  // Site metadata
  siteName: process.env.NEXT_PUBLIC_SITE_NAME || 'aturi.to',
  siteDescription: process.env.NEXT_PUBLIC_SITE_DESCRIPTION || 'Tour the Atmosphere',
  
  // Author/Creator info (for attribution in forks)
  author: {
    name: process.env.NEXT_PUBLIC_AUTHOR_NAME || 'dame',
    url: process.env.NEXT_PUBLIC_AUTHOR_URL || 'https://atpota.to',
  },
  
  // Original project info (keep this if forking)
  originalProject: {
    name: 'aturi.to',
    author: 'dame',
    url: 'https://aturi.to',
    repo: 'https://github.com/atpota-to/aturi',
  },

  // Source code repository. GitHub is primary — issues, pull requests and
  // releases live there. tangled.org/atpota.to/aturi is a mirror of it.
  repo: process.env.NEXT_PUBLIC_REPO_URL || 'https://github.com/atpota-to/aturi',
  repoMirror: 'https://tangled.org/atpota.to/aturi',
  
  // Analytics (optional)
  analytics: {
    enabled: process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true',
  },
} as const;

/**
 * Get the full URL for the site
 */
export function getSiteUrl(): string {
  const configured = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (configured) {
    return configured;
  }

  // On PREVIEW deployments, the per-deployment *.vercel.app host is the right
  // base so OG images and canonical URLs resolve against the deploy you're
  // viewing. On PRODUCTION, VERCEL_URL is *also* a per-deployment *.vercel.app
  // host (not the canonical domain), so using it would point production OG
  // images and canonical links at an ephemeral hostname — prefer the
  // configured domain there instead.
  if (
    process.env.VERCEL_URL &&
    process.env.VERCEL_ENV &&
    process.env.VERCEL_ENV !== 'production'
  ) {
    const preview = normalizeSiteUrl(process.env.VERCEL_URL);
    if (preview) return preview;
  }

  return `https://${config.domain}`;
}

/**
 * Check if this is a fork (domain differs from original)
 */
export function isFork(): boolean {
  return config.domain !== config.originalProject.name;
}

/**
 * Get attribution text for forks
 */
export function getAttributionText(): string {
  if (isFork()) {
    return `Based on ${config.originalProject.name} by ${config.originalProject.author}`;
  }
  return '';
}







/**
 * Configuration for aturi.to
 * 
 * If you're forking this project, update these values to customize your instance.
 * You can also use environment variables to override these settings.
 */

// Site configuration
export const config = {
  // Your domain (change this when forking!)
  domain: process.env.NEXT_PUBLIC_DOMAIN || 'aturi.to',
  
  // Site metadata
  siteName: process.env.NEXT_PUBLIC_SITE_NAME || 'aturi.to',
  siteDescription: process.env.NEXT_PUBLIC_SITE_DESCRIPTION || 'Universal links for the ATmosphere',
  
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
    repo: 'https://tangled.org/atpota.to/aturi',
  },
  
  // Source code repository
  repo: process.env.NEXT_PUBLIC_REPO_URL || 'https://tangled.org/atpota.to/aturi',
  
  // Analytics (optional)
  analytics: {
    enabled: process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true',
  },
  
  // Feature flags
  features: {
    showIntegrationPromo: process.env.NEXT_PUBLIC_SHOW_INTEGRATION_PROMO !== 'false',
  },
} as const;

/**
 * Get the full URL for the site
 */
export function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
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



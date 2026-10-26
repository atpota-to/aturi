import { config, getSiteUrl } from '@/lib/config';

/**
 * Site-level JSON-LD: who runs aturi.to, what the site is, and what the
 * software does.
 *
 * Emitted on every page as a single `@graph` rather than three separate script
 * blocks, so the three nodes can reference each other by `@id` — `publisher`
 * and `author` point at the Organization node instead of repeating it. Record
 * and profile pages add their own, more specific, JSON-LD on top; multiple
 * blocks on one page are valid and consumers merge them.
 *
 * Deliberately absent: `address`. Schema.org's Organization allows a
 * PostalAddress and structured-data audits ask for one, but this is a project
 * run by one person from home — publishing that would be handing out a home
 * address to satisfy a checklist. `contactPoint` carries the email instead,
 * which is the part anyone actually needs.
 */

export function buildSiteJsonLd(baseUrl: string = getSiteUrl()) {
  const origin = baseUrl.replace(/\/$/, '');
  const organizationId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: config.siteName,
        alternateName: 'Aturi',
        url: `${origin}/`,
        description:
          'Open-source tools for navigating the Atmosphere, the network of apps built on the AT Protocol: universal links, an Atmosphere Explorer, and a browser extension.',
        email: 'contact@aturi.to',
        logo: {
          '@type': 'ImageObject',
          url: `${origin}/apple-touch-icon.svg`,
        },
        founder: {
          '@type': 'Person',
          name: config.author.name,
          url: config.author.url,
        },
        contactPoint: [
          {
            '@type': 'ContactPoint',
            contactType: 'customer support',
            email: 'contact@aturi.to',
            url: `${origin}/contact`,
            availableLanguage: ['English'],
          },
          {
            '@type': 'ContactPoint',
            contactType: 'technical support',
            email: 'aturi@atpota.to',
            url: `${origin}/contact`,
            availableLanguage: ['English'],
          },
        ],
        sameAs: [
          'https://bsky.app/profile/aturi.to',
          config.repo,
          config.repoMirror,
        ],
      },
      {
        '@type': 'WebSite',
        '@id': websiteId,
        name: config.siteName,
        url: `${origin}/`,
        description: config.siteDescription,
        inLanguage: 'en',
        publisher: { '@id': organizationId },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${origin}/#software`,
        name: config.siteName,
        applicationCategory: 'DeveloperApplication',
        applicationSubCategory: 'AT Protocol / Atmosphere tooling',
        operatingSystem: 'Any (web); browser extension for Chrome, Firefox and Safari',
        url: `${origin}/`,
        description:
          'Turn any Atmosphere link into the atproto record behind it, then open that record in whichever client you prefer. Includes universal links, a PDS explorer, a browser extension, and a keyless public API.',
        browserRequirements: 'Requires JavaScript for the interactive surfaces; content pages and the API work without it.',
        license: 'https://www.gnu.org/licenses/gpl-3.0.html',
        isAccessibleForFree: true,
        author: { '@id': organizationId },
        publisher: { '@id': organizationId },
        // Free with no account, no key and no paid tier. A zero-price Offer is
        // how that is stated in a way a parser can act on; omitting `offers`
        // entirely reads as "pricing unknown".
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
        },
        softwareHelp: { '@type': 'CreativeWork', url: `${origin}/docs` },
        codeRepository: config.repo,
      },
    ],
  };
}

/**
 * URL and Content Sanitization Utilities
 * Prevents XSS attacks from user-generated content
 */

/**
 * Sanitizes a URL to prevent javascript: and data: URI attacks
 * Only allows http:, https:, and relative URLs
 */
export function sanitizeUrl(url: string | undefined | null): string {
  if (!url) return '#';

  const trimmedUrl = url.trim();

  // Empty string check
  if (!trimmedUrl) return '#';

  try {
    // Check for dangerous protocols
    const lowerUrl = trimmedUrl.toLowerCase();

    // Block javascript:, data:, vbscript:, file:, and other dangerous protocols
    const dangerousProtocols = [
      'javascript:',
      'data:',
      'vbscript:',
      'file:',
      'about:',
      'blob:',
    ];

    for (const protocol of dangerousProtocols) {
      if (lowerUrl.startsWith(protocol)) {
        console.warn(`Blocked dangerous URL protocol: ${protocol}`);
        return '#';
      }
    }

    // Allow relative URLs (starting with / or #), but NOT protocol-relative
    // URLs (//host), which the browser resolves to https://host — an
    // open-redirect/phishing vector. Those fall through to the URL()
    // validation below, which rejects them (no base).
    if (
      (trimmedUrl.startsWith('/') && !trimmedUrl.startsWith('//')) ||
      trimmedUrl.startsWith('#')
    ) {
      return trimmedUrl;
    }

    // For absolute URLs, validate with URL constructor
    const urlObj = new URL(trimmedUrl);

    // Only allow http and https protocols
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      console.warn(`Blocked non-HTTP(S) protocol: ${urlObj.protocol}`);
      return '#';
    }

    return trimmedUrl;
  } catch {
    // Invalid URL format
    console.warn(`Invalid URL format: ${trimmedUrl}`);
    return '#';
  }
}

/**
 * Sanitizes a facet link URL from ATProto records
 * More strict validation for external links
 */
export function sanitizeFacetLink(uri: string | undefined | null): string {
  if (!uri) return '#';

  // Use the base sanitizeUrl function
  const sanitized = sanitizeUrl(uri);

  // Additional validation: must be absolute http(s) URL or blocked
  if (sanitized === '#') return '#';

  try {
    // Facet links should always be absolute URLs
    const urlObj = new URL(sanitized);

    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return '#';
    }

    return sanitized;
  } catch {
    // If it's a relative URL, block it for facet links (they should be absolute)
    return '#';
  }
}

/**
 * Sanitizes a DID (Decentralized Identifier) to prevent path traversal
 * DIDs should match the format: did:method:identifier
 */
export function sanitizeDid(did: string | undefined | null): string {
  if (!did) return '';

  const trimmedDid = did.trim();

  // DID format: did:method:identifier
  // Method and identifier can contain alphanumeric and some special chars
  const didRegex = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;

  if (!didRegex.test(trimmedDid)) {
    console.warn(`Invalid DID format: ${trimmedDid}`);
    return '';
  }

  // Prevent path traversal attempts
  if (trimmedDid.includes('..') || trimmedDid.includes('//')) {
    console.warn(`Potential path traversal in DID: ${trimmedDid}`);
    return '';
  }

  return trimmedDid;
}

/**
 * Sanitizes a hashtag to prevent injection attacks
 * Hashtags should only contain alphanumeric characters and underscores
 */
export function sanitizeHashtag(tag: string | undefined | null): string {
  if (!tag) return '';

  const trimmedTag = tag.trim();

  // Remove any # prefix if present
  const cleanTag = trimmedTag.startsWith('#') ? trimmedTag.slice(1) : trimmedTag;

  // Only allow alphanumeric, underscores, and hyphens
  // This prevents URL encoding issues and injection attacks
  const sanitized = cleanTag.replace(/[^a-zA-Z0-9_-]/g, '');

  if (sanitized !== cleanTag) {
    console.warn(`Sanitized hashtag from "${cleanTag}" to "${sanitized}"`);
  }

  return sanitized;
}

/**
 * Sanitizes a handle (username) to prevent injection
 * Handles should only contain alphanumeric, dots, and hyphens
 */
export function sanitizeHandle(handle: string | undefined | null): string {
  if (!handle) return '';

  const trimmedHandle = handle.trim();

  // Remove @ prefix if present
  const cleanHandle = trimmedHandle.startsWith('@') ? trimmedHandle.slice(1) : trimmedHandle;

  // ATProto handles can contain: alphanumeric, dots, hyphens
  // Must also support colon for handles that look like "did:plc:..." being used as handles
  // But no path traversal or special characters
  const handleRegex = /^[a-zA-Z0-9.:-]+$/;

  if (!handleRegex.test(cleanHandle)) {
    console.warn(`Invalid handle format: ${cleanHandle}`);
    return '';
  }

  // Prevent path traversal
  if (cleanHandle.includes('..') || cleanHandle.includes('//')) {
    console.warn(`Potential path traversal in handle: ${cleanHandle}`);
    return '';
  }

  return cleanHandle;
}

/**
 * Escapes HTML special characters to prevent XSS
 * Note: React already does this for text content, but this is useful
 * for dynamic HTML generation or non-React contexts
 */
export function escapeHtml(text: string | undefined | null): string {
  if (!text) return '';

  const htmlEscapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };

  return text.replace(/[&<>"'/]/g, (char) => htmlEscapeMap[char] || char);
}

/**
 * Serializes an object for safe embedding inside a
 * `<script type="application/ld+json">` tag via dangerouslySetInnerHTML.
 *
 * Plain JSON.stringify does NOT escape `<`, so attacker-controlled record
 * content such as `</script><img src=x onerror=...>` in a post's text or an
 * author's display name would break out of the script element and execute.
 * Escaping `<`, `>`, `&` and the U+2028 / U+2029 line separators to their
 * `\uXXXX` forms keeps the payload a valid, inert JSON string while staying
 * byte-for-byte parseable by any JSON-LD consumer.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Validates and sanitizes an AT URI path component
 */
export function sanitizeAtUriComponent(component: string | undefined | null): string {
  if (!component) return '';

  const trimmed = component.trim();

  // Prevent path traversal and null bytes
  if (
    trimmed.includes('..') ||
    trimmed.includes('\0') ||
    trimmed.includes('%00') ||
    trimmed.includes('//')
  ) {
    console.warn(`Blocked malicious AT URI component: ${trimmed}`);
    return '';
  }

  return trimmed;
}

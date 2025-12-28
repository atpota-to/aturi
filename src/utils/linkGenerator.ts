/**
 * Extracts AT URI components from various URL formats and generates aturi.to links
 */

interface AtUriComponents {
  identifier: string; // DID or handle
  collection?: string;
  rkey?: string;
}

/**
 * Extracts AT URI components from a URL or AT URI string
 * Supports various formats:
 * - https://bsky.app/profile/did:plc:xxx
 * - https://bsky.app/profile/handle.bsky.social/post/rkey
 * - https://leaflet.pub/p/did:plc:xxx
 * - https://pdsls.dev/at://did:plc:xxx/app.bsky.feed.like/rkey
 * - at://did:plc:xxx/app.bsky.feed.post/rkey
 */
export function extractAtUriComponents(input: string): AtUriComponents | null {
  const trimmedInput = input.trim();
  
  // Case 1: Native AT URI format (at://...)
  if (trimmedInput.startsWith('at://')) {
    const withoutProtocol = trimmedInput.substring(5); // Remove "at://"
    const parts = withoutProtocol.split('/');
    
    if (parts.length === 1) {
      // Just a profile: at://did:plc:xxx or at://handle.bsky.social
      return { identifier: parts[0] };
    } else if (parts.length === 3) {
      // Full record: at://identifier/collection/rkey
      return {
        identifier: parts[0],
        collection: parts[1],
        rkey: parts[2],
      };
    }
  }
  
  // Case 2: URL formats (https://...)
  try {
    const url = new URL(trimmedInput);
    const pathname = url.pathname;
    
    // Bluesky format: /profile/identifier or /profile/identifier/post/rkey
    if (pathname.startsWith('/profile/')) {
      const parts = pathname.substring(9).split('/'); // Remove "/profile/"
      
      if (parts.length === 1) {
        // Profile only: /profile/identifier
        return { identifier: parts[0] };
      } else if (parts.length === 3 && parts[1] === 'post') {
        // Post: /profile/identifier/post/rkey
        return {
          identifier: parts[0],
          collection: 'app.bsky.feed.post',
          rkey: parts[2],
        };
      } else if (parts.length === 3 && parts[1] === 'lists') {
        // List: /profile/identifier/lists/rkey
        return {
          identifier: parts[0],
          collection: 'app.bsky.graph.list',
          rkey: parts[2],
        };
      }
    }
    
    // Leaflet format: /p/identifier or similar
    if (pathname.startsWith('/p/')) {
      const parts = pathname.substring(3).split('/'); // Remove "/p/"
      
      if (parts.length === 1) {
        return { identifier: parts[0] };
      }
    }
    
    // pdsls.dev format: /at://identifier/collection/rkey
    if (pathname.startsWith('/at://')) {
      const atUri = pathname.substring(1); // Remove leading "/"
      return extractAtUriComponents(atUri); // Recursive call
    }
    
  } catch {
    // Not a valid URL, might be a bare identifier
  }
  
  // Case 3: Bare identifier (DID or handle)
  if (trimmedInput.startsWith('did:')) {
    return { identifier: trimmedInput };
  }
  
  // Case 4: Handle-like string (contains dots and no slashes)
  if (trimmedInput.includes('.') && !trimmedInput.includes('/')) {
    return { identifier: trimmedInput };
  }
  
  return null;
}

/**
 * Generates an aturi.to link from AT URI components
 * @param useAtPrefix - If true, uses /at/ prefix format (e.g., aturi.to/at/did:plc:xxx/...)
 */
export function generateAturiLink(components: AtUriComponents, useAtPrefix: boolean = false): string {
  const { identifier, collection, rkey } = components;
  
  if (collection && rkey) {
    if (useAtPrefix) {
      return `https://aturi.to/at/${identifier}/${collection}/${rkey}`;
    }
    return `https://aturi.to/${identifier}/${collection}/${rkey}`;
  }
  
  if (useAtPrefix) {
    return `https://aturi.to/at/${identifier}`;
  }
  return `https://aturi.to/${identifier}`;
}

/**
 * Main function to convert any input to an aturi.to link
 * @param useAtPrefix - If true, uses /at/ prefix format for DIDs
 */
export function convertToAturiLink(input: string, useAtPrefix: boolean = false): string | null {
  const components = extractAtUriComponents(input);
  
  if (!components) {
    return null;
  }
  
  return generateAturiLink(components, useAtPrefix);
}

/**
 * Validates if the input can be converted to an aturi.to link
 */
export function isValidInput(input: string): boolean {
  return extractAtUriComponents(input) !== null;
}


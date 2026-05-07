/**
 * Extracts AT URI components from various URL formats and generates aturi.to links
 */

import { resolveHandleToDid } from './didResolver';

interface AtUriComponents {
  identifier: string; // DID or handle
  collection?: string;
  rkey?: string;
}

/**
 * Extracts AT URI components from a URL or AT URI string
 * 
 * Universal AT URI pattern detection (works with any domain):
 * - https://anydomain.com/at://did:plc:xxx/collection/rkey
 * - https://anydomain.com/at:/did:plc:xxx/collection/rkey
 * - https://anydomain.com/did:plc:xxx/collection/rkey
 * - https://anydomain.com/handle.bsky.social/collection/rkey
 * 
 * Specific platform formats also supported:
 * - https://bsky.app/profile/did:plc:xxx
 * - https://bsky.app/profile/handle.bsky.social/post/rkey
 * - https://blacksky.community/profile/handle/post/rkey
 * - https://anisota.net/profile/handle/post/rkey
 * - https://anisota.net/explorer/handle/collection/rkey
 * - https://reddwarf.app/profile/handle/post/rkey
 * - https://leaflet.pub/p/identifier
 * - https://margin.at/domain.com/annotation/rkey (maps to at.margin.annotation)
 * - https://margin.at/domain.com/collection/rkey (maps to at.margin.collection)
 * - https://semble.so/profile/identifier
 * - https://witchsky.app/profile/handle/post/rkey
 * - https://catsky.social/profile/handle/post/rkey
 * - https://deer.social/profile/handle/post/rkey
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
    const hostname = url.hostname;
    
    // Universal AT URI pattern detection: /at://identifier/collection/rkey
    if (pathname.startsWith('/at://')) {
      const atUri = pathname.substring(1); // Remove leading "/"
      return extractAtUriComponents(atUri); // Recursive call
    }
    
    // Universal AT URI pattern detection: /at:/identifier/collection/rkey
    if (pathname.startsWith('/at:/')) {
      const parts = pathname.substring(5).split('/'); // Remove "/at:/"
      
      if (parts.length === 1) {
        // Profile only: /at:/identifier
        return { identifier: parts[0] };
      } else if (parts.length === 3) {
        // Full record: /at:/identifier/collection/rkey
        return {
          identifier: parts[0],
          collection: parts[1],
          rkey: parts[2],
        };
      }
    }
    
    // Universal pattern: /did:xxx/collection/rkey or /handle.tld/collection/rkey
    // This catches any domain with a DID or handle-like structure in the path
    const pathParts = pathname.substring(1).split('/').filter(p => p); // Remove leading "/" and split
    
    if (pathParts.length >= 1) {
      const potentialIdentifier = pathParts[0];
      
      // Check if first segment looks like a DID or handle
      const isDid = potentialIdentifier.startsWith('did:');
      const isHandle = !isDid && potentialIdentifier.includes('.') && !potentialIdentifier.includes(' ');
      
      if (isDid || isHandle) {
        if (pathParts.length === 1) {
          // Just identifier: /did:plc:xxx or /handle.bsky.social
          return { identifier: potentialIdentifier };
        } else if (pathParts.length === 3) {
          // Full record: /identifier/collection/rkey
          const collection = pathParts[1];
          const rkey = pathParts[2];
          
          // Validate that collection looks like a lexicon (contains dots)
          if (collection.includes('.')) {
            return {
              identifier: potentialIdentifier,
              collection: collection,
              rkey: rkey,
            };
          }
        }
      }
    }
    
    // Specific domain patterns (for non-AT-URI-like paths)
    
    // Standard /profile/identifier format (bsky.app, blacksky.community, anisota.net, 
    // reddwarf.app, witchsky.app, catsky.social, deer.social)
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
    
    // Anisota explorer format: /explorer/identifier/collection/rkey
    if (pathname.startsWith('/explorer/') && hostname === 'anisota.net') {
      const parts = pathname.substring(10).split('/'); // Remove "/explorer/"
      
      if (parts.length === 1) {
        // Profile only
        return { identifier: parts[0] };
      } else if (parts.length === 3) {
        // Full record
        return {
          identifier: parts[0],
          collection: parts[1],
          rkey: parts[2],
        };
      }
    }
    
    // Leaflet format: /p/identifier
    if (pathname.startsWith('/p/')) {
      const parts = pathname.substring(3).split('/'); // Remove "/p/"
      
      if (parts.length === 1) {
        return { identifier: parts[0] };
      }
    }
    
    // Margin.at format: /domain/recordType/rkey
    // Maps to at.margin.{recordType} lexicons
    if (hostname === 'margin.at') {
      const parts = pathname.substring(1).split('/').filter(p => p); // Remove leading "/" and split
      
      if (parts.length === 3) {
        const domain = parts[0];
        const recordType = parts[1];
        const rkey = parts[2];
        
        // Valid margin record types: annotation, highlight, bookmark, collection, collectionItem, reply, like
        const validMarginTypes = ['annotation', 'highlight', 'bookmark', 'collection', 'collectionitem', 'reply', 'like'];
        
        if (validMarginTypes.includes(recordType.toLowerCase())) {
          // The domain in the URL is actually the handle
          // Collection is at.margin.{recordType}
          return {
            identifier: domain,
            collection: `at.margin.${recordType.toLowerCase()}`,
            rkey: rkey,
          };
        }
      } else if (parts.length === 2 && parts[0] === 'profile') {
        // Profile format: /profile/identifier
        return { identifier: parts[1] };
      } else if (parts.length === 1) {
        // Just a domain/handle
        return { identifier: parts[0] };
      }
    }
    
    // Semble format: /profile/identifier
    if (hostname === 'semble.so' && pathname.startsWith('/profile/')) {
      const parts = pathname.substring(9).split('/'); // Remove "/profile/"
      
      if (parts.length === 1) {
        return { identifier: parts[0] };
      }
    }
    
    // Legacy /at/ format: /at/identifier or /at/identifier/collection/rkey
    if (pathname.startsWith('/at/')) {
      const parts = pathname.substring(4).split('/'); // Remove "/at/"
      
      if (parts.length === 1) {
        // Profile only
        return { identifier: parts[0] };
      } else if (parts.length === 3) {
        // Full record
        return {
          identifier: parts[0],
          collection: parts[1],
          rkey: parts[2],
        };
      }
    }
    
    // atp.tools format: /record/identifier/collection/rkey or /profile/identifier
    if (pathname.startsWith('/record/')) {
      const parts = pathname.substring(8).split('/'); // Remove "/record/"
      
      if (parts.length === 1) {
        // Just identifier
        return { identifier: parts[0] };
      } else if (parts.length === 3) {
        // Full record
        return {
          identifier: parts[0],
          collection: parts[1],
          rkey: parts[2],
        };
      }
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
 * Generates an aturi.to link from AT URI components.
 *
 * Canonical URLs include the `/profile/` prefix to mirror the bsky.app /
 * anisota.net layout. The bare-path forms (`aturi.to/{identifier}/...`) still
 * resolve, but new links should always use `/profile/` so callers like the
 * extension and share UI produce consistent output.
 *
 * @param useAtPrefix - If true, keeps the literal at:// prefix (e.g., aturi.to/at://did:plc:xxx/...)
 */
export function generateAturiLink(components: AtUriComponents, useAtPrefix: boolean = false): string {
  const { identifier, collection, rkey } = components;

  if (useAtPrefix) {
    if (collection && rkey) {
      return `https://aturi.to/at://${identifier}/${collection}/${rkey}`;
    }
    return `https://aturi.to/at://${identifier}`;
  }

  if (collection && rkey) {
    if (collection === 'app.bsky.feed.post') {
      return `https://aturi.to/profile/${identifier}/post/${rkey}`;
    }
    if (collection === 'app.bsky.graph.list') {
      return `https://aturi.to/profile/${identifier}/lists/${rkey}`;
    }
    return `https://aturi.to/profile/${identifier}/${collection}/${rkey}`;
  }

  return `https://aturi.to/profile/${identifier}`;
}

/**
 * Resolves a handle to DID if possible, returns the original if it's already a DID or resolution fails
 */
async function resolveIdentifierToDid(identifier: string): Promise<string> {
  // If it's already a DID, return it
  if (identifier.startsWith('did:')) {
    return identifier;
  }
  
  // Try to resolve handle to DID
  try {
    const did = await resolveHandleToDid(identifier);
    return did || identifier; // Fall back to handle if resolution fails
  } catch (error) {
    console.warn(`Failed to resolve handle ${identifier} to DID:`, error);
    return identifier; // Fall back to handle on error
  }
}

/**
 * Main function to convert any input to an aturi.to link
 * @param useAtPrefix - If true, keeps the literal at:// prefix for full AT URI format
 * @param preferDid - If true, attempts to resolve handles to DIDs (default: false for backwards compatibility)
 */
export async function convertToAturiLink(input: string, useAtPrefix: boolean = false, preferDid: boolean = false): Promise<string | null> {
  const components = extractAtUriComponents(input);
  
  if (!components) {
    return null;
  }
  
  // If preferDid is true, try to resolve handle to DID
  if (preferDid) {
    components.identifier = await resolveIdentifierToDid(components.identifier);
  }
  
  return generateAturiLink(components, useAtPrefix);
}

/**
 * Synchronous version that doesn't resolve handles to DIDs
 * Kept for backwards compatibility
 */
export function convertToAturiLinkSync(input: string, useAtPrefix: boolean = false): string | null {
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


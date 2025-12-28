'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/**
 * Catch-all route for handling AT URI format URLs with literal at://
 * Supports: /at://did:plc:xxx or /at://did:plc:xxx/collection/rkey
 * 
 * This handles URLs like:
 * - aturi.to/at://did:plc:xxx/app.bsky.feed.post/3k7qw...
 * - aturi.to/at://alice.bsky.social/app.bsky.feed.post/3k7qw...
 * 
 * The route path is /at/[...slug] which captures everything after /at/
 * including the :// part as the first segment
 */
export default function AtUriRedirect() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string[];

  useEffect(() => {
    if (!slug || slug.length === 0) {
      router.replace('/');
      return;
    }

    // slug will be something like ['', '', 'did:plc:xxx', 'collection', 'rkey']
    // because the :// creates empty segments
    // We need to reconstruct the identifier and path
    
    // Find the first non-empty segment (the identifier)
    const nonEmptySegments = slug.filter(s => s !== '');
    
    if (nonEmptySegments.length === 0) {
      router.replace('/');
      return;
    }
    
    // Reconstruct the path without the at:// prefix
    const cleanPath = nonEmptySegments.map(segment => encodeURIComponent(segment)).join('/');
    
    // Redirect to the standard route format
    router.replace(`/${cleanPath}`);
  }, [slug, router]);

  // Show minimal loading state during redirect
  return (
    <div style={{ 
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-secondary)'
    }}>
      <p>Redirecting...</p>
    </div>
  );
}


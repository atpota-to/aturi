'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/**
 * Catch-all route for handling AT URI format URLs
 * Supports: /at/did:plc:xxx or /at/did:plc:xxx/collection/rkey
 * 
 * This handles URLs like:
 * - aturi.to/at/did:plc:xxx/app.bsky.feed.post/3k7qw...
 * - aturi.to/at/alice.bsky.social/app.bsky.feed.post/3k7qw...
 * 
 * Redirects to the standard format without the /at/ prefix
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

    // Reconstruct the path without the /at/ prefix
    // slug will be something like ['did:plc:xxx', 'collection', 'rkey']
    const cleanPath = slug.map(segment => encodeURIComponent(segment)).join('/');
    
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


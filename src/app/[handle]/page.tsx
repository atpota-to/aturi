'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import WaypointPicker from '@/components/WaypointPicker';
import { parseURI, resolveHandle, getDisplayName } from '@/utils/uriParser';

export default function ProfilePage() {
  const params = useParams();
  const handle = params.handle as string;
  
  const [isLoading, setIsLoading] = useState(true);
  const [did, setDid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function resolve() {
      try {
        const resolvedDid = await resolveHandle(handle);
        if (resolvedDid) {
          setDid(resolvedDid);
        } else {
          setError('Could not resolve handle');
        }
      } catch (err) {
        setError('Error resolving handle');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }

    resolve();
  }, [handle]);

  if (isLoading) {
    return (
      <div className="container-narrow" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
        <p className="loading">Resolving handle...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-narrow" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Error</h1>
        <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
      </div>
    );
  }

  const parsed = parseURI(handle);

  return (
    <WaypointPicker
      type="profile"
      handle={handle}
      displayName={getDisplayName(handle, did || undefined)}
    />
  );
}



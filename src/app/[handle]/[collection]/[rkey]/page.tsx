'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import WaypointPicker from '@/components/WaypointPicker';
import PostPreview from '@/components/PostPreview';
import RecordPreview from '@/components/RecordPreview';
import { parseURI, resolveHandle, getDisplayName, type ParsedURI } from '@/utils/uriParser';
import { fetchRecordData, type PostThread, type GenericRecord } from '@/utils/recordFetcher';

export default function RecordPage() {
  const params = useParams();
  const handle = params.handle as string;
  const collection = params.collection as string;
  const rkey = params.rkey as string;
  
  const [isLoading, setIsLoading] = useState(true);
  const [did, setDid] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedURI | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordData, setRecordData] = useState<
    { type: 'post'; data: PostThread } | { type: 'record'; data: GenericRecord } | null
  >(null);

  useEffect(() => {
    async function resolve() {
      try {
        const parsedData = parseURI(handle, collection, rkey);
        
        if (parsedData.error) {
          setError(parsedData.error);
          setIsLoading(false);
          return;
        }

        setParsed(parsedData);

        const resolvedDid = await resolveHandle(handle);
        if (resolvedDid) {
          setDid(resolvedDid);
          
          // Fetch the record data for preview
          const data = await fetchRecordData(resolvedDid, collection, rkey);
          if (data) {
            setRecordData(data);
          }
        } else {
          setError('Could not resolve handle');
        }
      } catch (err) {
        setError('Error processing URI');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }

    resolve();
  }, [handle, collection, rkey]);

  if (isLoading) {
    return (
      <div className="container-narrow" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
        <p className="loading">Loading...</p>
      </div>
    );
  }

  if (error || !parsed || parsed.type === 'unknown') {
    return (
      <div className="container-narrow" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Error</h1>
        <p style={{ color: 'var(--text-secondary)' }}>{error || 'Invalid or unsupported URI'}</p>
      </div>
    );
  }

  return (
    <div className="container-narrow" style={{ padding: '4rem 2rem' }}>
      {/* Branding */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <a
          href="/"
          className="branding-link"
          style={{
            display: 'inline-block',
            color: 'var(--text-tertiary)',
            fontSize: '1.25rem',
            textDecoration: 'none',
            transition: 'color 0.2s ease',
          }}
        >
          aturi.to
        </a>
      </div>

      {/* Record Preview */}
      {recordData && (
        <>
          {recordData.type === 'post' && recordData.data.thread[0]?.value.post && (
            <PostPreview post={recordData.data.thread[0].value.post} />
          )}
          {recordData.type === 'record' && (
            <RecordPreview record={recordData.data} collection={collection} />
          )}
        </>
      )}

      {/* Waypoint Picker */}
      <WaypointPicker
        type={parsed.type}
        handle={handle}
        collection={collection}
        rkey={rkey}
        displayName={getDisplayName(handle, did || undefined)}
      />
    </div>
  );
}



/**
 * RecordPreview Component
 * Displays a preview of a generic ATProto record
 */

'use client';

import { useState } from 'react';
import { GenericRecord } from '@/utils/recordFetcher';

type RecordPreviewProps = {
  record: GenericRecord;
  collection: string;
};

// Helper to render a field value
function FieldValue({ value }: { value: any }) {
  if (typeof value === 'string') {
    return <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value}</div>;
  }
  
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <div>{String(value)}</div>;
  }
  
  if (value === null || value === undefined) {
    return <div style={{ fontStyle: 'italic', color: 'var(--text-tertiary)' }}>null</div>;
  }
  
  if (typeof value === 'object') {
    return (
      <pre
        style={{
          margin: 0,
          padding: '0.75rem',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          fontSize: '0.875rem',
          overflow: 'auto',
          maxHeight: '300px',
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  
  return <div>{String(value)}</div>;
}

export default function RecordPreview({ record, collection }: RecordPreviewProps) {
  const { value, uri, cid } = record;
  const [showFullJson, setShowFullJson] = useState(false);

  // Format the record type nicely
  const recordType = value.$type || collection;
  const displayType = recordType.replace('app.bsky.', '').replace('com.atproto.', '');

  // Get key fields to display in summary view
  const keyFields = Object.entries(value).filter(
    ([key]) => !key.startsWith('$') && key !== 'createdAt'
  );

  // Format date if available
  const createdAt = value.createdAt ? new Date(value.createdAt) : null;
  const formattedDate = createdAt
    ? createdAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div
      style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
      }}
    >
      {/* Record Type Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', marginBottom: '0.25rem' }}>
            Record Type
          </div>
          <div style={{ fontWeight: '600', color: 'var(--text-accent)' }}>
            {displayType}
          </div>
        </div>
        {formattedDate && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', marginBottom: '0.25rem' }}>
              Created
            </div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>
              {formattedDate}
            </div>
          </div>
        )}
      </div>

      {/* Toggle between summary and full JSON view */}
      <div style={{ marginBottom: '1rem' }}>
        <button
          onClick={() => setShowFullJson(!showFullJson)}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            color: 'var(--text-primary)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-quaternary)';
            e.currentTarget.style.borderColor = 'var(--border-medium)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-tertiary)';
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
          }}
        >
          {showFullJson ? '← View Summary' : 'View Full JSON →'}
        </button>
      </div>

      {/* Conditional Rendering: Summary vs Full JSON */}
      {showFullJson ? (
        <div
          className="scroll-container"
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <pre
            style={{
              margin: 0,
              padding: '1rem',
              fontSize: '0.875rem',
              lineHeight: '1.5',
            }}
          >
            {JSON.stringify(value, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="scroll-container">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.125rem' }}>
            {keyFields.map(([key, val]) => (
              <div key={key}>
                <div
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--text-tertiary)',
                    marginBottom: '0.375rem',
                  }}
                >
                  {key}
                </div>
                <div style={{ color: 'var(--text-primary)' }}>
                  <FieldValue value={val} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata footer */}
      <div
        style={{
          marginTop: '1.5rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        {/* AT URI */}
        <div>
          <div
            style={{
              fontSize: '0.75rem',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--text-tertiary)',
              marginBottom: '0.375rem',
            }}
          >
            AT URI
          </div>
          <code
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-secondary)',
              wordBreak: 'break-all',
              fontFamily: 'monospace',
            }}
          >
            {uri}
          </code>
        </div>
        
        {/* CID if available */}
        {cid && (
          <div>
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-tertiary)',
                marginBottom: '0.375rem',
              }}
            >
              CID
            </div>
            <code
              style={{
                fontSize: '0.875rem',
                color: 'var(--text-secondary)',
                wordBreak: 'break-all',
                fontFamily: 'monospace',
              }}
            >
              {cid}
            </code>
          </div>
        )}
      </div>
    </div>
  );
}


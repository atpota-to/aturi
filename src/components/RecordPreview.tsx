/**
 * RecordPreview Component
 * Displays a preview of a generic ATProto record
 */

import { GenericRecord } from '@/utils/recordFetcher';

type RecordPreviewProps = {
  record: GenericRecord;
  collection: string;
};

export default function RecordPreview({ record, collection }: RecordPreviewProps) {
  const { value, uri } = record;

  // Format the record type nicely
  const recordType = value.$type || collection;
  const displayType = recordType.replace('app.bsky.', '').replace('com.atproto.', '');

  // Get key fields to display
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
      className="card"
      style={{
        marginBottom: '2rem',
        padding: '1.5rem',
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

      {/* Record Fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
              {typeof val === 'string' ? (
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{val}</div>
              ) : typeof val === 'object' && val !== null ? (
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
                  {JSON.stringify(val, null, 2)}
                </pre>
              ) : (
                <div>{String(val)}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* URI */}
      <div
        style={{
          marginTop: '1rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border-color)',
        }}
      >
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
    </div>
  );
}


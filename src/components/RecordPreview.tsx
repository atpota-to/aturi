/**
 * RecordPreview Component
 * Displays a preview of a generic ATProto record
 */

'use client';

import { useState } from 'react';
import { GenericRecord } from '@/utils/recordFetcher';
import { X } from 'lucide-react';

type RecordPreviewProps = {
  record: GenericRecord;
  collection: string;
  handle: string;
  rkey: string;
};

export default function RecordPreview({ record, collection, handle, rkey }: RecordPreviewProps) {
  const { value, cid } = record;
  const [showJsonModal, setShowJsonModal] = useState(false);

  // Format the record type nicely
  const recordType = value.$type || collection;
  const displayType = recordType.replace('app.bsky.', '').replace('com.atproto.', '').replace('net.anisota.', '');

  // Get a few key interesting fields to preview (limit to 5-6)
  const allFields = Object.entries(value).filter(
    ([key]) => !key.startsWith('$') && key !== 'createdAt' && key !== 'updatedAt'
  );
  const previewFields = allFields.slice(0, 6);
  const hasMoreFields = allFields.length > 6;

  // Format date if available
  const createdAt = value.createdAt ? new Date(value.createdAt) : null;
  const formattedDate = createdAt
    ? createdAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  // Helper to render field preview (simplified)
  const renderFieldPreview = (val: unknown) => {
    if (typeof val === 'string') {
      // Truncate long strings
      return val.length > 100 ? `${val.substring(0, 100)}...` : val;
    }
    if (typeof val === 'number' || typeof val === 'boolean') {
      return String(val);
    }
    if (typeof val === 'object' && val !== null) {
      return `{${Object.keys(val).length} fields}`;
    }
    return String(val);
  };

  return (
    <>
      <div
        style={{
          marginBottom: '2rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          overflow: 'hidden',
          transform: 'rotate(0.2deg)',
          transition: 'all 0.4s ease',
        }}
        className="card record-preview-card"
      >
        {/* Header: URI Structure */}
        <div
          style={{
            padding: '1.5rem',
            background: 'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%)',
            borderBottom: '1px solid var(--border-medium)',
          }}
        >
          {/* AT URI Path */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '1rem',
              flexWrap: 'wrap',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.875rem',
            }}
          >
            <span style={{ color: 'var(--text-tertiary)' }}>at://</span>
            <span style={{ color: 'var(--text-accent)', fontWeight: '500' }}>{handle}</span>
            <span style={{ color: 'var(--text-tertiary)' }}>/</span>
            <span style={{ color: 'var(--text-secondary)' }}>{collection}</span>
            <span style={{ color: 'var(--text-tertiary)' }}>/</span>
            <span style={{ color: 'var(--text-tertiary)', opacity: 0.7 }}>{rkey}</span>
          </div>

          {/* Record Type Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'inline-block',
                padding: '0.375rem 0.875rem',
                background: 'var(--glow-subtle)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-accent)',
                fontSize: '0.8125rem',
                fontWeight: '600',
                letterSpacing: '0.03em',
              }}
            >
              {displayType}
            </div>
            {formattedDate && (
              <div style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
                {formattedDate}
              </div>
            )}
          </div>
        </div>

        {/* Preview Fields - Simplified */}
        <div style={{ padding: '1.5rem' }}>
          <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
            {previewFields.map(([key, val]) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  gap: '1rem',
                  alignItems: 'flex-start',
                  paddingBottom: '1rem',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <div
                  style={{
                    minWidth: '140px',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--text-tertiary)',
                    paddingTop: '0.125rem',
                  }}
                >
                  {key}
                </div>
                <div
                  style={{
                    flex: 1,
                    color: 'var(--text-primary)',
                    fontSize: '0.9375rem',
                    lineHeight: '1.6',
                    wordBreak: 'break-word',
                  }}
                >
                  {renderFieldPreview(val)}
                </div>
              </div>
            ))}
          </div>

          {/* View Full Record Button */}
          <button
            onClick={() => setShowJsonModal(true)}
            style={{
              width: '100%',
              padding: '0.875rem 1.25rem',
              fontSize: '0.9375rem',
              fontWeight: '400',
              color: 'var(--text-primary)',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-medium)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              position: 'relative',
              overflow: 'hidden',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-elevated)';
              e.currentTarget.style.borderColor = 'var(--text-accent)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-tertiary)';
              e.currentTarget.style.borderColor = 'var(--border-medium)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {hasMoreFields
              ? `View Full Record (${allFields.length} fields)`
              : 'View Full Record'}
          </button>
        </div>

        {/* Footer: CID */}
        {cid && (
          <div
            style={{
              padding: '1rem 1.5rem',
              background: 'var(--bg-tertiary)',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
              wordBreak: 'break-all',
            }}
          >
            <span style={{ opacity: 0.6, marginRight: '0.5rem' }}>CID:</span>
            {cid}
          </div>
        )}
      </div>

      {/* Full JSON Modal */}
      {showJsonModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10, 10, 10, 0.75)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            animation: 'modal-fade-in 0.3s ease-out',
          }}
          onClick={() => setShowJsonModal(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '900px',
              maxHeight: '85vh',
              background: 'linear-gradient(145deg, rgba(21, 21, 21, 0.95) 0%, rgba(26, 26, 26, 0.98) 100%)',
              border: '1px solid var(--border-medium)',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5), 0 0 80px var(--glow-subtle)',
              display: 'flex',
              flexDirection: 'column',
              animation: 'modal-slide-up 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
              position: 'relative',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Ambient glow effect */}
            <div
              style={{
                position: 'absolute',
                top: '-50%',
                left: '-20%',
                width: '140%',
                height: '100%',
                background: 'radial-gradient(circle at 30% 40%, var(--glow-medium) 0%, transparent 50%)',
                opacity: 0.3,
                pointerEvents: 'none',
                animation: 'breathe 8s ease-in-out infinite',
              }}
            />

            {/* Modal Header */}
            <div
              style={{
                padding: '1.75rem 2rem',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                background: 'rgba(26, 26, 26, 0.4)',
                position: 'relative',
                zIndex: 1,
              }}
            >
              <div style={{ flex: 1, paddingRight: '1rem' }}>
                <div style={{ 
                  fontSize: '1.25rem', 
                  fontWeight: '300', 
                  color: 'var(--text-primary)', 
                  marginBottom: '0.5rem',
                  letterSpacing: '-0.01em',
                }}>
                  Full Record Data
                </div>
                <div style={{ 
                  fontSize: '0.8125rem', 
                  color: 'var(--text-tertiary)', 
                  fontFamily: 'var(--font-mono)',
                  wordBreak: 'break-all',
                }}>
                  {displayType}
                </div>
              </div>
              <button
                onClick={() => setShowJsonModal(false)}
                style={{
                  padding: '0.625rem',
                  background: 'rgba(26, 26, 26, 0.6)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-tertiary)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                  e.currentTarget.style.borderColor = 'var(--border-medium)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(26, 26, 26, 0.6)';
                  e.currentTarget.style.color = 'var(--text-tertiary)';
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Content */}
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                padding: '2rem',
                position: 'relative',
                zIndex: 1,
              }}
            >
              <pre
                style={{
                  margin: 0,
                  padding: '1.5rem',
                  background: 'rgba(26, 26, 26, 0.6)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.875rem',
                  lineHeight: '1.7',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  boxShadow: 'inset 0 0 40px rgba(0, 0, 0, 0.3)',
                }}
              >
                {JSON.stringify(value, null, 2)}
              </pre>
            </div>

            {/* Subtle bottom fade */}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '60px',
                background: 'linear-gradient(to top, rgba(21, 21, 21, 0.95), transparent)',
                pointerEvents: 'none',
                zIndex: 2,
              }}
            />
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes modal-fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes modal-slide-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </>
  );
}


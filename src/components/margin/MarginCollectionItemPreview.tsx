/**
 * MarginCollectionItemPreview Component
 * Custom preview for at.margin.collectionItem records
 */

'use client';

import { useState } from 'react';
import { GenericRecord } from '@/utils/recordFetcher';
import { X, Link2, Calendar } from 'lucide-react';

type MarginCollectionItemPreviewProps = {
  record: GenericRecord;
  collection: string;
  handle: string;
  rkey: string;
};

type CollectionItemRecord = {
  $type: string;
  collection: string;
  annotation: string;
  position?: number;
  createdAt: string;
};

export default function MarginCollectionItemPreview({
  record,
  collection,
  handle,
  rkey,
}: MarginCollectionItemPreviewProps) {
  const { value, cid } = record;
  const item = value as CollectionItemRecord;
  const [showJsonModal, setShowJsonModal] = useState(false);

  const createdAt = new Date(item.createdAt);
  const formattedDate = createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

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
        className="margin-collection-item-card"
      >
        {/* Header */}
        <div
          style={{
            padding: '2rem',
            background: 'linear-gradient(135deg, #2a4a1a 0%, var(--bg-secondary) 100%)',
            borderBottom: '1px solid var(--border-medium)',
            textAlign: 'center',
          }}
        >
          <Link2 size={48} style={{ color: '#86efac', marginBottom: '1rem', display: 'inline-block' }} />

          <div
            style={{
              padding: '0.375rem 0.875rem',
              background: 'rgba(134, 239, 172, 0.15)',
              border: '1px solid rgba(134, 239, 172, 0.3)',
              color: '#86efac',
              fontSize: '0.8125rem',
              fontWeight: '600',
              letterSpacing: '0.03em',
              display: 'inline-block',
              marginBottom: '1rem',
            }}
          >
            Collection Item
          </div>

          <div
            style={{
              fontSize: '0.9375rem',
              color: 'var(--text-secondary)',
            }}
          >
            Links an annotation to a collection
          </div>

          {typeof item.position !== 'undefined' && (
            <div
              style={{
                fontSize: '0.875rem',
                color: 'var(--text-tertiary)',
                marginTop: '0.5rem',
              }}
            >
              Position: {item.position}
            </div>
          )}
        </div>

        {/* Collection Reference */}
        <div
          style={{
            padding: '1.5rem',
            background: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>
            <strong>Collection:</strong>
          </div>
          <div
            style={{
              fontSize: '0.8125rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
              wordBreak: 'break-all',
            }}
          >
            {item.collection}
          </div>
        </div>

        {/* Annotation Reference */}
        <div
          style={{
            padding: '1.5rem',
            background: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>
            <strong>Annotation:</strong>
          </div>
          <div
            style={{
              fontSize: '0.8125rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
              wordBreak: 'break-all',
            }}
          >
            {item.annotation}
          </div>
        </div>

        {/* Metadata Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            background: 'var(--bg-tertiary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Calendar size={14} style={{ color: 'var(--text-tertiary)' }} />
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
              {formattedDate}
            </span>
          </div>

          <button
            onClick={() => setShowJsonModal(true)}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.8125rem',
              fontWeight: '500',
              color: 'var(--text-secondary)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-elevated)';
              e.currentTarget.style.borderColor = 'var(--text-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-medium)';
            }}
          >
            View Raw Data
          </button>
        </div>

        {/* AT URI Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            background: 'rgba(0, 0, 0, 0.2)',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            wordBreak: 'break-all',
          }}
        >
          <span style={{ opacity: 0.6 }}>at://</span>
          {handle}/<span style={{ opacity: 0.8 }}>{collection}</span>/{rkey}
        </div>
      </div>

      {/* Full JSON Modal */}
      {showJsonModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--modal-backdrop)',
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
              background: 'var(--modal-bg)',
              border: '1px solid var(--border-medium)',
              boxShadow: 'var(--modal-shadow)',
              display: 'flex',
              flexDirection: 'column',
              animation: 'modal-slide-up 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
              position: 'relative',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
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
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: '300',
                    color: 'var(--text-primary)',
                    marginBottom: '0.5rem',
                    letterSpacing: '-0.01em',
                  }}
                >
                  Raw Collection Item Data
                </div>
                <div
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)',
                    wordBreak: 'break-all',
                  }}
                >
                  at.margin.collectionItem
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

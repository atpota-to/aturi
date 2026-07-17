/**
 * MarginCollectionItemPreview Component
 * Custom preview for at.margin.collectionItem records
 */

'use client';

import { useState } from 'react';
import { GenericRecord } from '@/utils/recordFetcher';
import { Link2, Calendar } from 'lucide-react';
import JsonModal from './JsonModal';

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
  const { value } = record;
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
            background: 'linear-gradient(135deg, var(--margin-collection-item-tint) 0%, var(--bg-secondary) 100%)',
            borderBottom: '1px solid var(--border-medium)',
            textAlign: 'center',
          }}
        >
          <Link2 size={48} style={{ color: 'var(--margin-collection-item-fg)', marginBottom: '1rem', display: 'inline-block' }} />

          <div
            style={{
              padding: '0.375rem 0.875rem',
              background: 'var(--margin-collection-item-tint)',
              border: '1px solid var(--margin-collection-item-border)',
              color: 'var(--margin-collection-item-fg)',
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
            background: 'var(--surface-overlay-dim)',
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

      <JsonModal
        open={showJsonModal}
        onClose={() => setShowJsonModal(false)}
        title="Raw Collection Item Data"
        subtitle="at.margin.collection"
        value={value}
      />

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

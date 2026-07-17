/**
 * MarginCollectionPreview Component
 * Custom preview for at.margin.collection records
 */

'use client';

import { useState } from 'react';
import { GenericRecord } from '@/utils/recordFetcher';
import { FolderOpen, Calendar } from 'lucide-react';
import JsonModal from './JsonModal';

type MarginCollectionPreviewProps = {
  record: GenericRecord;
  collection: string;
  handle: string;
  rkey: string;
};

type CollectionRecord = {
  $type: string;
  name: string;
  description?: string;
  icon?: string;
  createdAt: string;
};

export default function MarginCollectionPreview({
  record,
  collection,
  handle,
  rkey,
}: MarginCollectionPreviewProps) {
  const { value } = record;
  const marginCollection = value as CollectionRecord;
  const [showJsonModal, setShowJsonModal] = useState(false);

  const createdAt = new Date(marginCollection.createdAt);
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
        className="margin-collection-card"
      >
        {/* Header */}
        <div
          style={{
            padding: '2rem',
            background: 'linear-gradient(135deg, var(--margin-collection-tint) 0%, var(--bg-secondary) 100%)',
            borderBottom: '1px solid var(--border-medium)',
            textAlign: 'center',
          }}
        >
          {marginCollection.icon && (
            <div
              style={{
                fontSize: '3rem',
                marginBottom: '1rem',
              }}
            >
              {marginCollection.icon}
            </div>
          )}
          {!marginCollection.icon && (
            <FolderOpen
              size={48}
              style={{ color: 'var(--margin-collection-fg)', marginBottom: '1rem', display: 'inline-block' }}
            />
          )}

          <div
            style={{
              padding: '0.375rem 0.875rem',
              background: 'var(--margin-collection-tint)',
              border: '1px solid var(--margin-collection-border)',
              color: 'var(--margin-collection-fg)',
              fontSize: '0.8125rem',
              fontWeight: '600',
              letterSpacing: '0.03em',
              display: 'inline-block',
              marginBottom: '1.5rem',
            }}
          >
            Collection
          </div>

          <h2
            style={{
              fontSize: '1.75rem',
              fontWeight: '500',
              color: 'var(--text-primary)',
              marginBottom: '1rem',
              lineHeight: '1.3',
            }}
          >
            {marginCollection.name}
          </h2>

          {marginCollection.description && (
            <p
              style={{
                fontSize: '1rem',
                lineHeight: '1.6',
                color: 'var(--text-secondary)',
                maxWidth: '600px',
                margin: '0 auto',
              }}
            >
              {marginCollection.description}
            </p>
          )}
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
              Created {formattedDate}
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
        title="Raw Collection Data"
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

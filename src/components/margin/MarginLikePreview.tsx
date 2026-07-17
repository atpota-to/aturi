/**
 * MarginLikePreview Component
 * Custom preview for at.margin.like records
 */

'use client';

import { useState } from 'react';
import { GenericRecord } from '@/utils/recordFetcher';
import { Heart, Calendar } from 'lucide-react';
import JsonModal from './JsonModal';

type MarginLikePreviewProps = {
  record: GenericRecord;
  collection: string;
  handle: string;
  rkey: string;
};

type LikeRecord = {
  $type: string;
  subject: {
    uri: string;
    cid: string;
  };
  createdAt: string;
};

export default function MarginLikePreview({
  record,
  collection,
  handle,
  rkey,
}: MarginLikePreviewProps) {
  const { value } = record;
  const like = value as LikeRecord;
  const [showJsonModal, setShowJsonModal] = useState(false);

  const createdAt = new Date(like.createdAt);
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
        className="margin-like-card"
      >
        {/* Header */}
        <div
          style={{
            padding: '2rem',
            background: 'linear-gradient(135deg, var(--margin-like-tint) 0%, var(--bg-secondary) 100%)',
            borderBottom: '1px solid var(--border-medium)',
            textAlign: 'center',
          }}
        >
          <Heart size={48} style={{ color: 'var(--margin-like-fg)', marginBottom: '1rem', display: 'inline-block' }} />

          <div
            style={{
              padding: '0.375rem 0.875rem',
              background: 'var(--margin-like-tint)',
              border: '1px solid var(--margin-like-border)',
              color: 'var(--margin-like-fg)',
              fontSize: '0.8125rem',
              fontWeight: '600',
              letterSpacing: '0.03em',
              display: 'inline-block',
              marginBottom: '1rem',
            }}
          >
            Like
          </div>

          <div
            style={{
              fontSize: '0.9375rem',
              color: 'var(--text-secondary)',
            }}
          >
            Liked an annotation or reply
          </div>
        </div>

        {/* Subject Reference */}
        <div
          style={{
            padding: '1.5rem',
            background: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>
            <strong>Subject:</strong>
          </div>
          <div
            style={{
              fontSize: '0.8125rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
              wordBreak: 'break-all',
            }}
          >
            {like.subject.uri}
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
        title="Raw Like Data"
        subtitle="at.margin.like"
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

/**
 * MarginBookmarkPreview Component
 * Custom preview for at.margin.bookmark records
 */

'use client';

import { useState } from 'react';
import { GenericRecord } from '@/utils/recordFetcher';
import { sanitizeUrl } from '@/utils/sanitize';
import { Bookmark, ExternalLink, Tag, Calendar } from 'lucide-react';
import JsonModal from './JsonModal';

type MarginBookmarkPreviewProps = {
  record: GenericRecord;
  collection: string;
  handle: string;
  rkey: string;
};

type BookmarkRecord = {
  $type: string;
  source: string;
  title?: string;
  description?: string;
  tags?: string[];
  sourceHash?: string;
  createdAt: string;
};

export default function MarginBookmarkPreview({
  record,
  collection,
  handle,
  rkey,
}: MarginBookmarkPreviewProps) {
  const { value } = record;
  const bookmark = value as BookmarkRecord;
  const [showJsonModal, setShowJsonModal] = useState(false);

  const createdAt = new Date(bookmark.createdAt);
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
        className="margin-bookmark-card"
      >
        {/* Header */}
        <div
          style={{
            padding: '1.5rem',
            background: 'linear-gradient(135deg, var(--margin-bookmark-tint) 0%, var(--bg-secondary) 100%)',
            borderBottom: '1px solid var(--border-medium)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <Bookmark size={18} style={{ color: 'var(--margin-bookmark-fg)' }} />
            <div
              style={{
                padding: '0.375rem 0.875rem',
                background: 'var(--margin-bookmark-tint)',
                border: '1px solid var(--margin-bookmark-border)',
                color: 'var(--margin-bookmark-fg)',
                fontSize: '0.8125rem',
                fontWeight: '600',
                letterSpacing: '0.03em',
              }}
            >
              Bookmark
            </div>
          </div>

          {/* Page Title */}
          {bookmark.title && (
            <h2
              style={{
                fontSize: '1.375rem',
                fontWeight: '500',
                color: 'var(--text-primary)',
                marginBottom: '0.75rem',
                lineHeight: '1.4',
              }}
            >
              {bookmark.title}
            </h2>
          )}

          {/* Description */}
          {bookmark.description && (
            <p
              style={{
                fontSize: '0.9375rem',
                lineHeight: '1.6',
                color: 'var(--text-secondary)',
                marginBottom: '1rem',
              }}
            >
              {bookmark.description}
            </p>
          )}

          {/* Source URL */}
          <a
            href={sanitizeUrl(bookmark.source)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.875rem',
              color: 'var(--text-accent)',
              textDecoration: 'none',
              transition: 'opacity 0.2s ease',
              wordBreak: 'break-all',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.7';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
          >
            <ExternalLink size={14} />
            {bookmark.source}
          </a>
        </div>

        {/* Tags */}
        {bookmark.tags && bookmark.tags.length > 0 && (
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Tag size={14} style={{ color: 'var(--text-tertiary)' }} />
              {bookmark.tags.map((tag, i) => (
                <span
                  key={i}
                  style={{
                    padding: '0.25rem 0.625rem',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.8125rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

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
              Bookmarked {formattedDate}
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
        title="Raw Bookmark Data"
        subtitle="at.margin.bookmark"
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

/**
 * MarginHighlightPreview Component
 * Custom preview for at.margin.highlight records
 */

'use client';

import { useState } from 'react';
import { GenericRecord } from '@/utils/recordFetcher';
import { sanitizeUrl } from '@/utils/sanitize';
import { Highlighter, ExternalLink, Tag, Calendar } from 'lucide-react';
import JsonModal from './JsonModal';

type MarginHighlightPreviewProps = {
  record: GenericRecord;
  collection: string;
  handle: string;
  rkey: string;
};

type HighlightRecord = {
  $type: string;
  target: {
    source: string;
    title?: string;
    sourceHash?: string;
    /** W3C-style text quote selector — margin records store the picked text here. */
    selector?: { exact?: string; prefix?: string; suffix?: string };
  };
  color?: string;
  tags?: string[];
  createdAt: string;
};

export default function MarginHighlightPreview({
  record,
  collection,
  handle,
  rkey,
}: MarginHighlightPreviewProps) {
  const { value } = record;
  const highlight = value as HighlightRecord;
  const [showJsonModal, setShowJsonModal] = useState(false);

  const createdAt = new Date(highlight.createdAt);
  const formattedDate = createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const selectedText = highlight.target.selector?.exact;
  const highlightColor = highlight.color || '#fde047';

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
        className="margin-highlight-card"
      >
        {/* Header */}
        <div
          style={{
            padding: '1.5rem',
            background: 'linear-gradient(135deg, var(--margin-highlight-tint) 0%, var(--bg-secondary) 100%)',
            borderBottom: '1px solid var(--border-medium)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <Highlighter size={18} style={{ color: 'var(--margin-highlight-fg)' }} />
            <div
              style={{
                padding: '0.375rem 0.875rem',
                background: 'var(--margin-highlight-tint)',
                border: '1px solid var(--margin-highlight-border)',
                color: 'var(--margin-highlight-fg)',
                fontSize: '0.8125rem',
                fontWeight: '600',
                letterSpacing: '0.03em',
              }}
            >
              Highlight
            </div>
            {highlight.color && (
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  background: highlightColor,
                  border: '1px solid var(--border-medium)',
                }}
                title={highlightColor}
              />
            )}
          </div>

          {/* Page Title */}
          {highlight.target.title && (
            <h2
              style={{
                fontSize: '1.25rem',
                fontWeight: '500',
                color: 'var(--text-primary)',
                marginBottom: '0.75rem',
                lineHeight: '1.4',
              }}
            >
              {highlight.target.title}
            </h2>
          )}

          {/* Source URL */}
          <a
            href={sanitizeUrl(highlight.target.source)}
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
            {highlight.target.source}
          </a>
        </div>

        {/* Highlighted Text */}
        {selectedText && (
          <div
            style={{
              padding: '1.5rem',
              background: 'var(--margin-highlight-tint)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-tertiary)',
                marginBottom: '0.75rem',
              }}
            >
              Highlighted Text
            </div>
            <div
              style={{
                padding: '0.75rem 1rem',
                background: `${highlightColor}22`,
                borderLeft: `3px solid ${highlightColor}`,
                fontSize: '1rem',
                lineHeight: '1.7',
                color: 'var(--text-primary)',
              }}
            >
              {selectedText}
            </div>
          </div>
        )}

        {/* Tags */}
        {highlight.tags && highlight.tags.length > 0 && (
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Tag size={14} style={{ color: 'var(--text-tertiary)' }} />
              {highlight.tags.map((tag, i) => (
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
        title="Raw Highlight Data"
        subtitle="at.margin.highlight"
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

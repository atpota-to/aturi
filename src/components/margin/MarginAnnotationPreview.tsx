/**
 * MarginAnnotationPreview Component
 * Custom preview for at.margin.annotation records
 */

'use client';

import { useState } from 'react';
import { GenericRecord } from '@/utils/recordFetcher';
import { sanitizeUrl } from '@/utils/sanitize';
import { ExternalLink, Tag, Calendar } from 'lucide-react';
import JsonModal from './JsonModal';

type MarginAnnotationPreviewProps = {
  record: GenericRecord;
  collection: string;
  handle: string;
  rkey: string;
};

type AnnotationRecord = {
  $type: string;
  target: {
    source: string;
    title?: string;
    sourceHash?: string;
    /** W3C-style text quote selector — margin records store the picked text here. */
    selector?: { exact?: string; prefix?: string; suffix?: string };
  };
  body?: {
    value?: string;
    format?: string;
    language?: string;
  };
  tags?: string[];
  motivation?: string;
  createdAt: string;
};

export default function MarginAnnotationPreview({
  record,
  collection,
  handle,
  rkey,
}: MarginAnnotationPreviewProps) {
  const { value } = record;
  const annotation = value as AnnotationRecord;
  const [showJsonModal, setShowJsonModal] = useState(false);

  const createdAt = new Date(annotation.createdAt);
  const formattedDate = createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  // Extract selected text if available
  const selectedText = annotation.target.selector?.exact;

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
        className="margin-annotation-card"
      >
        {/* Header */}
        <div
          style={{
            padding: '1.5rem',
            background: 'linear-gradient(135deg, var(--margin-annotation-tint) 0%, var(--bg-secondary) 100%)',
            borderBottom: '1px solid var(--border-medium)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div
              style={{
                padding: '0.375rem 0.875rem',
                background: 'var(--margin-annotation-tint)',
                border: '1px solid var(--margin-annotation-border)',
                color: 'var(--margin-annotation-fg)',
                fontSize: '0.8125rem',
                fontWeight: '600',
                letterSpacing: '0.03em',
              }}
            >
              Annotation
            </div>
            {annotation.motivation && (
              <div
                style={{
                  fontSize: '0.8125rem',
                  color: 'var(--text-tertiary)',
                  fontStyle: 'italic',
                }}
              >
                {annotation.motivation}
              </div>
            )}
          </div>

          {/* Page Title */}
          {annotation.target.title && (
            <h2
              style={{
                fontSize: '1.25rem',
                fontWeight: '500',
                color: 'var(--text-primary)',
                marginBottom: '0.75rem',
                lineHeight: '1.4',
              }}
            >
              {annotation.target.title}
            </h2>
          )}

          {/* Source URL */}
          <a
            href={sanitizeUrl(annotation.target.source)}
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
            {annotation.target.source}
          </a>
        </div>

        {/* Selected Text (if available) */}
        {selectedText && (
          <div
            style={{
              padding: '1.5rem',
              background: 'var(--margin-annotation-tint)',
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
              Selected Text
            </div>
            <blockquote
              style={{
                margin: 0,
                padding: '0 0 0 1rem',
                borderLeft: '3px solid var(--margin-annotation-border)',
                fontSize: '1rem',
                lineHeight: '1.7',
                color: 'var(--text-primary)',
                fontStyle: 'italic',
              }}
            >
              {selectedText}
            </blockquote>
          </div>
        )}

        {/* Annotation Body */}
        {annotation.body?.value && (
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
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
              Note
            </div>
            <div
              style={{
                fontSize: '0.9375rem',
                lineHeight: '1.7',
                color: 'var(--text-primary)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {annotation.body.value}
            </div>
          </div>
        )}

        {/* Tags */}
        {annotation.tags && annotation.tags.length > 0 && (
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Tag size={14} style={{ color: 'var(--text-tertiary)' }} />
              {annotation.tags.map((tag, i) => (
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
        title="Raw Annotation Data"
        subtitle="at.margin.annotation"
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

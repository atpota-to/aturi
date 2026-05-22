/**
 * MarginAnnotationPreview Component
 * Custom preview for at.margin.annotation records
 */

'use client';

import { useState } from 'react';
import { GenericRecord } from '@/utils/recordFetcher';
import { sanitizeHandle } from '@/utils/sanitize';
import { X, ExternalLink, Tag, Calendar } from 'lucide-react';

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
    selector?: any;
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
  const { value, cid } = record;
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
            href={annotation.target.source}
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
                background: 'var(--modal-header-bg)',
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
                  Raw Annotation Data
                </div>
                <div
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)',
                    wordBreak: 'break-all',
                  }}
                >
                  at.margin.annotation
                </div>
              </div>
              <button
                onClick={() => setShowJsonModal(false)}
                aria-label="Close raw annotation data"
                style={{
                  padding: '0.625rem',
                  background: 'var(--modal-pane-bg)',
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
                  e.currentTarget.style.background = 'var(--modal-pane-bg)';
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
                  background: 'var(--modal-pane-bg)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.875rem',
                  lineHeight: '1.7',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  boxShadow: 'var(--modal-pane-vignette)',
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

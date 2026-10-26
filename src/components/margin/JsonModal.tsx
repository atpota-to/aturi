'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Shared "view raw record data" modal for the margin.* previews. Built on the
 * native <dialog> element via showModal(), which provides the accessibility the
 * old hand-rolled fixed-div versions lacked: role=dialog + aria-modal, a focus
 * trap, Escape-to-close, focus moved into the dialog on open, and focus
 * restored to the trigger on close. Previously each of the seven previews
 * carried its own copy of a plain <div> overlay with none of that.
 */
export default function JsonModal({
  open,
  onClose,
  title,
  subtitle,
  value,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  value: unknown;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // Drive the native modal state from the `open` prop.
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  // The dialog fires `close` on Escape (and on dlg.close()); mirror it back so
  // the parent's `showJsonModal` state stays in sync.
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const handleClose = () => onClose();
    dlg.addEventListener('close', handleClose);
    return () => dlg.removeEventListener('close', handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="margin-json-dialog"
      // A click whose target is the dialog element itself is a backdrop click
      // (content sits in the inner wrapper), so close on it.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
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
          position: 'relative',
          overflow: 'hidden',
        }}
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
                fontWeight: 300,
                color: 'var(--text-primary)',
                marginBottom: '0.5rem',
                letterSpacing: '-0.01em',
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontSize: '0.8125rem',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
                wordBreak: 'break-all',
              }}
            >
              {subtitle}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
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

      <style jsx>{`
        .margin-json-dialog {
          margin: auto;
          padding: 2rem;
          border: none;
          background: transparent;
          max-width: 100vw;
          max-height: 100vh;
          overflow: visible;
          animation: modal-slide-up 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .margin-json-dialog::backdrop {
          background: var(--modal-backdrop);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          animation: modal-fade-in 0.3s ease-out;
        }
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
    </dialog>
  );
}

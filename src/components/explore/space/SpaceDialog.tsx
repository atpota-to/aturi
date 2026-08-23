'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * The modal shell the three space-administration forms share, plus the field
 * primitives they fill it with.
 *
 * Built on the native `<dialog>` and `showModal()` for the same reason
 * `<JsonModal>` is: it brings role=dialog, aria-modal, a focus trap,
 * Escape-to-close, focus moved in on open and restored to the trigger on close,
 * none of which a fixed-position div has. These forms are consequential —
 * one of them deletes a space — so the affordances that keep a keyboard user
 * oriented are not optional.
 *
 * The one deviation from `<JsonModal>`: closing is refused while a request is
 * in flight, including via Escape and the backdrop. A create that is answered
 * after its form has vanished leaves the user with no address and no error, and
 * an in-flight delete has nothing to cancel — the request is already at the
 * host.
 */
export default function SpaceDialog({
  open,
  onClose,
  busy,
  title,
  description,
  error,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  /** Blocks every close path while a request is in flight. */
  busy?: boolean;
  title: string;
  description?: ReactNode;
  /** Rendered above the actions, in the danger colour. */
  error?: string | null;
  children: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  // `close` fires on Escape as well as on `dlg.close()`, so it is where the
  // parent's state is brought back into sync.
  //
  // It does NOT re-open a dialog that closed while busy, even though that reads
  // like the obvious guard. Escape is already refused by `onCancel` below, and
  // the backdrop and the X check `busy` themselves — so the only remaining
  // closes are the ones the effect above performs *because the parent asked*,
  // and a form that submitted successfully and is navigating away is exactly
  // that: still busy, deliberately closed. Re-opening it would flash the form
  // back over a page that is already leaving.
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
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className="space-dialog"
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClick={(e) => {
        // Only a click on the dialog element itself is a backdrop click; the
        // content lives in the panel below.
        if (e.target === ref.current && !busy) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '30rem',
          maxHeight: '85vh',
          overflowY: 'auto',
          background: 'var(--modal-bg)',
          border: '1px solid var(--border-medium)',
          boxShadow: 'var(--modal-shadow)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          padding: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <h2
            id={titleId}
            style={{
              margin: 0,
              flex: 1,
              minWidth: 0,
              fontFamily: 'var(--font-serif)',
              fontWeight: 400,
              fontSize: '1.05rem',
              color: 'var(--text-primary)',
            }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              flexShrink: 0,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {description && (
          <p id={descriptionId} style={dialogNoteStyle}>
            {description}
          </p>
        )}

        {children}

        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              color: 'var(--danger)',
              fontSize: '0.8rem',
              lineHeight: 1.5,
            }}
          >
            {error}
          </p>
        )}

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            gap: '0.5rem',
          }}
        >
          {footer}
        </div>
      </div>

      <style jsx>{`
        .space-dialog {
          margin: auto;
          padding: 1.5rem;
          border: none;
          background: transparent;
          max-width: 100vw;
          max-height: 100vh;
          overflow: visible;
        }
        .space-dialog::backdrop {
          background: var(--modal-backdrop);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
      `}</style>
    </dialog>
  );
}

/**
 * A labelled field. The hint is wired through `aria-describedby` rather than
 * left as adjacent text, because every one of these hints carries the part that
 * decides the answer — what a space key is for, who a policy lets in.
 */
export function DialogField({
  label,
  hint,
  children,
  htmlFor,
  hintId,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor: string;
  hintId: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <label
        htmlFor={htmlFor}
        style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p id={hintId} style={dialogNoteStyle}>
          {hint}
        </p>
      )}
    </div>
  );
}

export const dialogNoteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  lineHeight: 1.5,
  color: 'var(--text-tertiary)',
};

/** The affirmative action. `tone` swaps it for the destructive palette. */
export function DialogButton({
  children,
  onClick,
  disabled,
  busy,
  tone = 'accent',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: 'accent' | 'danger' | 'quiet';
  type?: 'button' | 'submit';
}) {
  const palette =
    tone === 'danger'
      ? {
          background: 'var(--danger-soft)',
          color: 'var(--danger)',
          borderColor: 'var(--danger-border)',
        }
      : tone === 'quiet'
        ? {
            background: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            borderColor: 'var(--border-subtle)',
          }
        : {
            background: 'var(--accent-moss)',
            color: 'var(--text-on-accent)',
            borderColor: 'var(--accent-moss)',
          };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.45rem 0.9rem',
        background: palette.background,
        color: palette.color,
        border: `1px solid ${palette.borderColor}`,
        fontFamily: 'var(--font-serif)',
        fontSize: '0.8125rem',
        cursor: disabled ? 'not-allowed' : busy ? 'wait' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

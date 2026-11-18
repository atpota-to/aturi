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
  onSubmit,
  hasPopover,
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
  /**
   * Makes the body a real `<form>`, so Enter in a field submits it. Pass it
   * only where that is wanted — a delete confirmation should not be one
   * keystroke away — and give the affirmative action `type="submit"` when you
   * do, since implicit submission needs a submit button to aim at.
   */
  onSubmit?: () => void;
  /**
   * Set when the dialog contains something that draws outside its own box — in
   * practice a typeahead's suggestion list, which is absolutely positioned under
   * its input.
   *
   * The panel is a scroll container by default so a long form can't run off the
   * bottom of a phone, and `overflow-y: auto` clips absolutely positioned
   * descendants whether or not it is currently scrolling. So a dialog gets one
   * or the other, and the two needs happen not to collide: the forms long
   * enough to scroll have no popover, and the one with a popover is four
   * elements tall.
   */
  hasPopover?: boolean;
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
      <div className="fx-sp-dialog-panel" data-scroll={hasPopover ? undefined : ''}>
        <div className="fx-sp-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="fx-btn fx-btn-icon"
          >
            <X size={14} />
          </button>
        </div>

        {description && (
          <p id={descriptionId} className="fx-sp-dialog-note">
            {description}
          </p>
        )}

        <Body onSubmit={onSubmit}>
          {children}

          {error && (
            <p role="alert" className="fx-sp-dialog-error">
              {error}
            </p>
          )}

          <div className="fx-sp-dialog-foot">{footer}</div>
        </Body>
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
 * The fields and the actions, as a `<form>` where the caller asked for one and
 * a plain stack otherwise. Both carry the same layout so a dialog does not
 * change shape depending on whether Enter submits it.
 */
function Body({ onSubmit, children }: { onSubmit?: () => void; children: ReactNode }) {
  if (!onSubmit) return <div className="fx-sp-dialog-body">{children}</div>;
  return (
    <form
      className="fx-sp-dialog-body"
      onSubmit={(e) => {
        // A `<form>` in a `<dialog>` without `method="dialog"` would otherwise
        // navigate.
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
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
  /** Required whenever `hint` is given; it is what the field points at. */
  hintId?: string;
}) {
  return (
    <div className="fx-sp-dialog-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && (
        <p id={hintId} className="fx-sp-dialog-note">
          {hint}
        </p>
      )}
    </div>
  );
}

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
  const tones = {
    accent: 'fx-btn fx-sp-primary',
    danger: 'fx-btn fx-btn-danger-solid',
    quiet: 'fx-btn',
  } as const;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-wait={busy || undefined}
      className={tones[tone]}
    >
      {children}
    </button>
  );
}

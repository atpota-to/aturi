/**
 * RecordPreview Component
 * Displays a preview of a generic ATProto record
 */

'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { GenericRecord } from '@/utils/recordFetcher';
import { sanitizeHandle, sanitizeUrl } from '@/utils/sanitize';
import { Check, ChevronDown, ChevronRight, Copy, Telescope } from 'lucide-react';
import { encodeRepo, explorePathFromAtUri } from '@/utils/atproto/urls';
import { resolveDidHandle } from '@/utils/atproto/identity';
import RecordImageThumb from '@/components/RecordImageThumb';
import {
  didFromAtUri,
  getBlobUrl,
  imageBlobFromValue,
  imageUrlFromValue,
} from '@/utils/recordImages';

type RecordPreviewProps = {
  record: GenericRecord;
  collection: string;
  handle: string;
  rkey: string;
  /**
   * When true, suppress the "View Full Record" JSON-modal button and the
   * "Open in Explorer" cross-link. Used inside the explorer's record view,
   * which already shows the raw (linkified) JSON inline and is itself the
   * Explorer destination.
   */
  hideExplorerCtas?: boolean;
  /**
   * Optional action UI rendered in the card's footer next to the CID
   * (e.g. the explorer's "Edit record" button). Only shown when
   * hideExplorerCtas is true — the universal-link version keeps a
   * cleaner footer with just the CID. Passing this turns the card's
   * bottom strip into a flex row that fits the CID on the left and
   * the actions on the right.
   */
  footerActions?: import('react').ReactNode;
  /**
   * Owning repo's PDS endpoint. When present, blob-backed image fields render
   * an inline thumbnail (served via `com.atproto.sync.getBlob`); without it,
   * only direct image URLs preview. The explorer passes it; the universal-link
   * page omits it (it doesn't resolve the PDS), so blob thumbnails are
   * explorer-only for now.
   */
  pds?: string;
};

/**
 * Supplies the repo coordinates a blob image needs to build its getBlob URL.
 * Read by the recursive FieldRow so we don't thread `pds`/`did` through every
 * nested level by hand. `did` comes from the record URI; both are optional so
 * blob previews simply no-op when either is missing.
 */
const RecordImageContext = createContext<{ pds?: string; did: string | null }>({
  did: null,
});

export default function RecordPreview({
  record,
  collection,
  handle,
  rkey,
  hideExplorerCtas,
  footerActions,
  pds,
}: RecordPreviewProps) {
  const { value, cid } = record;
  const did = didFromAtUri(record.uri);

  // Format the record type nicely
  const recordType = value.$type || collection;
  const displayType = recordType.replace('app.bsky.', '').replace('com.atproto.', '').replace('net.anisota.', '');

  // Show every field in the record value — including $type, createdAt, and
  // updatedAt. The preview is meant to be a faithful, readable rendering of
  // the record (and, inside the explorer, the rich counterpart to the raw
  // JSON view), so dropping fields would make the two disagree and hide real
  // data. Universal-link pages still cap the count for a compact teaser.
  const allFields = Object.entries(value);
  const previewFields = hideExplorerCtas ? allFields : allFields.slice(0, 6);
  const hasMoreFields = !hideExplorerCtas && allFields.length > 6;

  // Format date if available
  const createdAt = value.createdAt ? new Date(value.createdAt) : null;
  const formattedDate = createdAt
    ? createdAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;


  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        overflow: 'hidden',
        transform: 'rotate(0.2deg)',
        transition: 'all 0.4s ease',
      }}
      className="card record-preview-card"
    >
        {/* Header: URI Structure. Suppressed inside the explorer, where the
            breadcrumb already shows the at:// segments and the collection
            chip — repeating them here is the redundancy this prop targets. */}
        {!hideExplorerCtas && (
          <div
            style={{
              padding: '1.5rem',
              background: 'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%)',
              borderBottom: '1px solid var(--border-medium)',
            }}
          >
            {/* AT URI Path */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '1rem',
                flexWrap: 'wrap',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.875rem',
              }}
            >
              <span style={{ color: 'var(--text-tertiary)' }}>at://</span>
              <a
                href={`/${sanitizeHandle(handle)}`}
                style={{
                  color: 'var(--text-accent)',
                  fontWeight: '500',
                  textDecoration: 'none',
                  transition: 'opacity 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.7';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1';
                }}
              >
                {handle}
              </a>
              <span style={{ color: 'var(--text-tertiary)' }}>/</span>
              <span style={{ color: 'var(--text-secondary)' }}>{collection}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>/</span>
              <span style={{ color: 'var(--text-tertiary)', opacity: 0.7 }}>{rkey}</span>
            </div>

            {/* Record Type Badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div
                style={{
                  display: 'inline-block',
                  padding: '0.375rem 0.875rem',
                  background: 'var(--glow-subtle)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-accent)',
                  fontSize: '0.8125rem',
                  fontWeight: '600',
                  letterSpacing: '0.03em',
                }}
              >
                {displayType}
              </div>
              {formattedDate && (
                <div style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
                  {formattedDate}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Preview Fields. Each row is a stateful FieldRow — tapping an
            object/array chip slides a full-width panel down BELOW the row
            (not into the right column), so nested content gets the full
            container width instead of compounding indentation. */}
        <div style={{ padding: '1.5rem' }}>
          {/* container-query host: field rows below read this wrapper's
              width (not the viewport's) to decide whether the value sits
              beside its label or drops onto its own line — see .record-fields
              in globals.css. Lets the card stack correctly inside narrow
              split panes, not just on small screens. */}
          <RecordImageContext.Provider value={{ pds, did }}>
            <div className="record-fields" style={{ marginBottom: '1.5rem' }}>
              {previewFields.map(([key, val]) => (
                // Inside the explorer (hideExplorerCtas) this card IS the
                // canonical record view, so top-level fields start expanded —
                // the visitor came here to read the record, not to click each
                // object/array chip open. Nested rows stay collapsed so deep
                // structures don't unfurl all at once. On universal-link pages
                // the preview stays compact (everything collapsed).
                <FieldRow
                  key={key}
                  label={key}
                  value={val}
                  defaultOpen={hideExplorerCtas}
                />
              ))}
            </div>
          </RecordImageContext.Provider>

          {/* Single CTA: navigates into the explorer's record page, which
              shows the full record JSON (linkified), backlinks, identity,
              and editing affordances. Replaces the previous \"View Full
              Record\" modal + secondary \"Open in Explorer\" link — one
              click instead of two surfaces. Hidden when we're already
              rendering inside the explorer. */}
          {!hideExplorerCtas && (
            <Link
              href={`/explore/${encodeRepo(handle)}/${collection}/${encodeURIComponent(rkey)}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                width: '100%',
                padding: '0.875rem 1.25rem',
                fontSize: '0.9375rem',
                fontWeight: 400,
                color: 'var(--text-primary)',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-medium)',
                textDecoration: 'none',
                transition: 'all 0.3s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-elevated)';
                e.currentTarget.style.borderColor = 'var(--text-accent)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-tertiary)';
                e.currentTarget.style.borderColor = 'var(--border-medium)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <Telescope size={15} style={{ color: 'var(--text-accent)' }} />
              <span>
                {hasMoreFields
                  ? `View full record (${allFields.length} fields) in Explorer →`
                  : 'View full record in Explorer →'}
              </span>
            </Link>
          )}

          {/* Quick action: grab the raw record JSON without leaving the
              universal link page. Sits beneath the primary CTA as a
              quieter secondary affordance. Hidden inside the explorer —
              the consolidated copy row already covers JSON. */}
          {!hideExplorerCtas && <CopyJsonRow record={record} />}
        </div>

        {/* Footer: CID + caller-supplied action slot. Universal-link pages
            get just the CID display; the explorer passes its Edit button
            in via footerActions so editing affordances live with the
            record they apply to. */}
        {(cid || footerActions) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
              padding: '0.875rem 1.5rem',
              background: 'var(--bg-tertiary)',
              borderTop: '1px solid var(--border-subtle)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
            }}
          >
            {cid ? (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '0.4rem',
                  minWidth: 0,
                  flex: 1,
                  wordBreak: 'break-all',
                }}
              >
                <span style={{ opacity: 0.6, flexShrink: 0 }}>CID:</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <CopyableValue display={cid} copy={cid} />
                </span>
              </span>
            ) : (
              <span style={{ flex: 1 }} />
            )}
            {footerActions && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  flexShrink: 0,
                }}
              >
                {footerActions}
              </span>
            )}
          </div>
        )}
      </div>

  );
}

async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall through */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

/**
 * A single field row: `[LABEL] [value-or-expand-chip]` on top, and — when
 * the value is an object/array and the chip is open — a full-width panel
 * below the row containing nested FieldRows.
 *
 * The expansion lives BELOW the row rather than inside the right column,
 * so deeply-nested data gets the parent container's full width instead of
 * compounding indentation. The slide-down uses CSS grid-template-rows
 * (0fr -> 1fr), which animates height changes without needing a fixed
 * max-height ceiling.
 */
function FieldRow({
  label,
  value,
  isLast,
  defaultOpen = false,
  suppressBlobImage = false,
}: {
  label: string;
  value: unknown;
  /** When true, the row's separator is suppressed — used for the last
   * child inside an expansion so it doesn't double up against the parent
   * row's bottom border. */
  isLast?: boolean;
  /** Initial expansion state. Top-level rows in the explorer pass true so
   * the record opens already unfurled; nested rows default to collapsed. */
  defaultOpen?: boolean;
  /** When true, don't render a blob thumbnail for this row — set by the parent
   * when a sibling field already previews the same image as a direct URL (e.g.
   * arena mirror's `image.src` next to `image.blob`), so we show it once. */
  suppressBlobImage?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { pds, did } = useContext(RecordImageContext);
  const expandable = isExpandable(value);
  const children = expandable ? childEntries(value) : [];
  // A sibling direct-URL image means this object's blob is (almost always) the
  // same asset; let the URL row own the single preview.
  const childrenHaveImageUrl = children.some(
    ([, v]) => imageUrlFromValue(v) != null,
  );

  // Blob-backed image preview (needs the repo coordinates to build getBlob).
  const blob = suppressBlobImage ? null : imageBlobFromValue(value);
  const blobSrc = blob && pds && did ? getBlobUrl(pds, did, blob.cid) : null;
  return (
    <div
      style={{
        borderBottom: isLast ? undefined : '1px solid var(--border-subtle)',
      }}
    >
      <div
        className="field-row-main"
        style={{
          display: 'flex',
          gap: '1rem',
          alignItems: 'flex-start',
          padding: '0.875rem 0',
        }}
      >
        <div className="field-row-label" style={fieldLabelStyle}>
          {label}
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            color: 'var(--text-primary)',
            fontSize: '0.9375rem',
            lineHeight: 1.6,
            wordBreak: 'break-word',
          }}
        >
          {expandable ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              style={fieldChipStyle}
            >
              {open ? (
                <ChevronDown size={12} aria-hidden />
              ) : (
                <ChevronRight size={12} aria-hidden />
              )}
              <span>{summarizeContainer(value)}</span>
            </button>
          ) : (
            <FieldPrimitive value={value} />
          )}
        </div>
      </div>
      {blobSrc && (
        <div style={{ paddingBottom: '0.75rem' }}>
          <RecordImageThumb src={blobSrc} alt={label} />
        </div>
      )}
      {expandable && (
        <div
          style={{
            display: 'grid',
            gridTemplateRows: open ? '1fr' : '0fr',
            transition: 'grid-template-rows 0.25s ease',
          }}
        >
          {/* paddingBottom lives on the overflow wrapper, not on the
              bordered indent below — so the left vertical line ends at
              the last child's content instead of running past it down
              to the parent row's separator. */}
          <div
            style={{
              overflow: 'hidden',
              minHeight: 0,
              paddingBottom: '0.5rem',
            }}
          >
            <div
              style={{
                marginLeft: '0.5rem',
                paddingLeft: '0.875rem',
                borderLeft: '2px solid var(--border-subtle)',
              }}
            >
              {children.map(([k, v], i) => (
                <FieldRow
                  key={k}
                  label={k}
                  value={v}
                  isLast={i === children.length - 1}
                  suppressBlobImage={childrenHaveImageUrl}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldPrimitive({ value }: { value: unknown }) {
  if (value === null) {
    return <span style={{ color: 'var(--text-tertiary)' }}>null</span>;
  }
  const full = typeof value === 'string' ? value : String(value);
  const display =
    typeof value === 'string' && value.length > 280
      ? `${value.substring(0, 280)}…`
      : full;
  // AT URI / DID values in record fields are cross-references (e.g.
  // gallery.item -> photo, follow.subject -> repo). Click-to-copy is the
  // wrong default — users want to follow the link into the explorer. The
  // copy affordance moves onto the trailing clipboard icon.
  if (typeof value === 'string') {
    if (isDid(value)) {
      return <DidValue did={value} />;
    }
    const href = explorePathFromAtUri(value);
    if (href && value.startsWith('at://')) {
      return <LinkableValue display={display} copy={full} href={href} />;
    }
    // Direct image URL: keep the copyable text and preview it beneath. The
    // URL still renders as a plain external string (like other non-AT URLs);
    // the thumbnail is the added affordance.
    const imageUrl = imageUrlFromValue(value);
    if (imageUrl) {
      const safe = sanitizeUrl(imageUrl);
      if (safe !== '#') {
        return (
          <>
            <CopyableValue display={display} copy={full} />
            <RecordImageThumb src={safe} />
          </>
        );
      }
    }
  }
  return <CopyableValue display={display} copy={full} />;
}

const DID_RE = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/;
function isDid(v: string): boolean {
  return DID_RE.test(v);
}

/**
 * Resolve a DID to its handle (cached/de-duped), re-running whenever the
 * DID changes. Returns null until resolved, or when the DID has no handle.
 */
function useDidHandle(did: string): string | null {
  // Keyed by DID: when it changes, the derived return value below is null
  // until the new resolution lands — no reset-setState inside the effect.
  const [entry, setEntry] = useState<{ did: string; handle: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    resolveDidHandle(did).then((h) => {
      if (!cancelled) setEntry({ did, handle: h });
    });
    return () => {
      cancelled = true;
    };
  }, [did]);
  return entry && entry.did === did ? entry.handle : null;
}

/**
 * A DID-valued field: the DID links into its repo explorer page, the
 * resolved handle trails it for readability, and the clipboard icon copies
 * the raw DID. Delegates the link + copy chrome to LinkableValue.
 */
function DidValue({ did }: { did: string }) {
  const handle = useDidHandle(did);
  return (
    <LinkableValue
      display={did}
      copy={did}
      href={`/explore/${did}`}
      linkTitle="Open repo in Explorer"
      copyLabel="Copy DID"
      suffix={
        handle ? (
          <span
            style={{
              marginLeft: '0.4rem',
              color: 'var(--text-tertiary)',
              fontSize: '0.875rem',
            }}
          >
            @{handle}
          </span>
        ) : null
      }
    />
  );
}

/**
 * Field value that is also an AT URI: the text navigates into the
 * explorer, the trailing clipboard icon copies the raw value. Mirrors
 * CopyableValue's visual treatment so non-AT-URI rows still feel
 * consistent next to it.
 */
function LinkableValue({
  display,
  copy,
  href,
  suffix,
  linkTitle = 'Open in Explorer',
  copyLabel = 'Copy to clipboard',
}: {
  display: string;
  copy: string;
  href: string;
  /** Optional trailing node (e.g. a resolved handle) shown after the link. */
  suffix?: import('react').ReactNode;
  linkTitle?: string;
  copyLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function onCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await writeToClipboard(copy);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  return (
    <span style={{ wordBreak: 'break-word' }}>
      <Link
        href={href}
        title={linkTitle}
        style={{
          color: 'var(--text-accent)',
          textDecoration: 'underline',
          textUnderlineOffset: '0.15em',
          wordBreak: 'break-word',
        }}
      >
        {display}
      </Link>
      {suffix}
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? 'Copied' : copyLabel}
        title={copied ? 'Copied!' : copyLabel}
        style={{
          marginLeft: '0.35rem',
          display: 'inline-flex',
          verticalAlign: 'middle',
          background: 'transparent',
          border: 0,
          padding: 0,
          color: copied ? 'var(--text-accent)' : 'var(--text-tertiary)',
          opacity: copied ? 1 : 0.45,
          cursor: 'pointer',
          transition: 'opacity 0.2s ease, color 0.2s ease',
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  );
}

/**
 * Tap-anywhere-to-copy wrapper for a primitive field value. Renders the
 * text inline with a faint copy icon trailing it; clicking copies the
 * full (untruncated) value to the clipboard and flashes a check mark.
 */
function CopyableValue({ display, copy }: { display: string; copy: string }) {
  const [copied, setCopied] = useState(false);
  async function onClick() {
    await writeToClipboard(copy);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
      aria-label={copied ? 'Copied' : 'Click to copy'}
      title={copied ? 'Copied!' : 'Click to copy'}
      style={{
        cursor: 'pointer',
        wordBreak: 'break-word',
        outline: 'none',
        transition: 'color 0.2s ease',
        color: copied ? 'var(--text-accent)' : 'inherit',
      }}
    >
      {display}
      <span
        style={{
          marginLeft: '0.35rem',
          display: 'inline-block',
          verticalAlign: 'middle',
          color: copied ? 'var(--text-accent)' : 'var(--text-tertiary)',
          opacity: copied ? 1 : 0.35,
          transition: 'opacity 0.2s ease, color 0.2s ease',
        }}
        aria-hidden
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </span>
    </div>
  );
}

function isExpandable(v: unknown): boolean {
  return typeof v === 'object' && v !== null;
}

function summarizeContainer(v: unknown): string {
  if (Array.isArray(v)) {
    return v.length === 0 ? '[ ]' : `[${v.length} ${v.length === 1 ? 'item' : 'items'}]`;
  }
  if (typeof v === 'object' && v !== null) {
    const n = Object.keys(v).length;
    return n === 0 ? '{ }' : `{${n} ${n === 1 ? 'field' : 'fields'}}`;
  }
  return '';
}

function childEntries(v: unknown): [string, unknown][] {
  if (Array.isArray(v)) return v.map((item, i) => [String(i), item]);
  if (typeof v === 'object' && v !== null) {
    return Object.entries(v as Record<string, unknown>);
  }
  return [];
}

const fieldLabelStyle: React.CSSProperties = {
  // Width lives in .field-row-label (globals.css), not here — a container
  // query collapses it to 0 when the card is narrow so the value can drop
  // onto its own full-width line. An inline minWidth would override that.
  fontSize: '0.75rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-tertiary)',
  paddingTop: '0.125rem',
  fontFamily: 'var(--font-mono)',
  wordBreak: 'break-all',
};

const fieldChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.3rem 0.625rem',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-accent)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.85rem',
  cursor: 'pointer',
  userSelect: 'none',
};

function CopyJsonRow({ record }: { record: GenericRecord }) {
  const [copied, setCopied] = useState(false);
  async function onClick() {
    await writeToClipboard(JSON.stringify(record, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div
      style={{
        marginTop: '0.625rem',
        textAlign: 'center',
      }}
    >
      <button
        type="button"
        onClick={onClick}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.4rem 0.75rem',
          background: 'transparent',
          border: 0,
          color: copied ? 'var(--text-accent)' : 'var(--text-tertiary)',
          fontFamily: 'var(--font-serif)',
          fontSize: '0.8125rem',
          cursor: 'pointer',
          transition: 'color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          if (!copied) e.currentTarget.style.color = 'var(--text-accent)';
        }}
        onMouseLeave={(e) => {
          if (!copied) e.currentTarget.style.color = 'var(--text-tertiary)';
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? 'Copied JSON to clipboard' : 'Copy raw record JSON'}</span>
      </button>
    </div>
  );
}


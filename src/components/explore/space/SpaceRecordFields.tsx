'use client';

import type { ReactNode } from 'react';
import AtUriLink from '../AtUriLink';
import LinkifiedJson from '../LinkifiedJson';

/**
 * Field-table view of a permissioned record.
 *
 * The public record page reaches for <RichRecordCard> and <RecordPreview>
 * here. Neither can be reused, and not for cosmetic reasons: both resolve a
 * record through public infrastructure. RichRecordCard fetches
 * `at://{did}/{collection}/{rkey}` from the Bluesky AppView, an address a
 * permissioned record does not have — the request would find nothing and
 * would hand the AppView the address of a record it is not allowed to see.
 * RecordPreview resolves blobs through the PDS's public sync endpoint, where
 * a permissioned blob is not served; those live behind
 * `com.atproto.space.getBlob` and a space credential.
 *
 * So this renders the record out of itself and makes no network call at all.
 * It is the honest ceiling for permissioned data until there is a space-aware
 * blob path, and it covers what a field table is actually for: seeing the
 * shape and the values without reading braces.
 *
 * Addresses stay clickable at any depth. A reply's `parent.uri` is nested two
 * objects down, and dumping that object as JSON text turned the one thing you
 * would want to follow into plain characters, so nested values go through
 * <LinkifiedJson> rather than JSON.stringify. It tokenises the seven-segment
 * space address the same way it tokenises a public one, and the explorer's
 * AT URI mapper already routes those back into this tree, so a record that
 * replies to another permissioned record links straight to it.
 */

type Props = { value: Record<string, unknown> };

export default function SpaceRecordFields({ value }: Props) {
  // `$type` first when present: it names what everything below it means.
  const keys = Object.keys(value).sort((a, b) => {
    if (a === '$type') return -1;
    if (b === '$type') return 1;
    return a.localeCompare(b);
  });

  if (keys.length === 0) {
    return <p className="explore-placeholder">This record has no fields.</p>;
  }

  return (
    <dl
      style={{
        margin: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(6rem, max-content) 1fr',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
      }}
    >
      {keys.map((key, i) => {
        const last = i === keys.length - 1;
        return (
          <div key={key} style={{ display: 'contents' }}>
            <dt
              style={{
                padding: '0.5rem 0.75rem',
                borderBottom: last ? 'none' : '1px solid var(--border-subtle)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                color: 'var(--text-tertiary)',
                overflowWrap: 'anywhere',
              }}
            >
              {key}
            </dt>
            <dd
              style={{
                margin: 0,
                padding: '0.5rem 0.75rem',
                borderBottom: last ? 'none' : '1px solid var(--border-subtle)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                color: 'var(--text-primary)',
                overflowWrap: 'anywhere',
                whiteSpace: 'pre-wrap',
              }}
            >
              {renderValue(value[key])}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** ISO-8601 instants, which every atproto lexicon spells the same way. */
const DATETIME_REGEXP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function renderValue(value: unknown): ReactNode {
  if (value === null) return <Muted>null</Muted>;
  if (value === undefined) return <Muted>undefined</Muted>;

  if (typeof value === 'string') {
    if (value.startsWith('at://')) return <AtUriLink uri={value} className="explore-json-link" />;
    // Absolute time is the stored truth; the local rendering beside it is the
    // part a reader can actually place themselves in.
    if (DATETIME_REGEXP.test(value)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return (
          <>
            {value} <Muted>({parsed.toLocaleString()})</Muted>
          </>
        );
      }
    }
    if (value === '') return <Muted>(empty string)</Muted>;
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return <Muted>(empty list)</Muted>;
    return (
      <>
        <Muted>
          {value.length} item{value.length === 1 ? '' : 's'}
        </Muted>
        <LinkifiedJson value={value} style={nestedJsonStyle} />
      </>
    );
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // A blob is the one nested shape worth naming rather than dumping, since
    // its bytes are unreachable here and the metadata is the whole story.
    if (obj.$type === 'blob') {
      const size = typeof obj.size === 'number' ? formatBytes(obj.size) : null;
      const mime = typeof obj.mimeType === 'string' ? obj.mimeType : 'unknown type';
      return (
        <>
          <Muted>blob</Muted> {mime}
          {size ? ` · ${size}` : ''}
          {'\n'}
          <Muted>Permissioned blobs aren’t fetchable here yet.</Muted>
        </>
      );
    }
    return <LinkifiedJson value={value} style={nestedJsonStyle} />;
  }

  return String(value);
}

/** Nested JSON inside a table cell: inherits the cell's type, adds no box. */
const nestedJsonStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'inherit',
  fontSize: 'inherit',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

function Muted({ children }: { children: ReactNode }) {
  return <span style={{ color: 'var(--text-tertiary)' }}>{children}</span>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

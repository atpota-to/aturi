'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  resolveSpaceTypeDeclaration,
  type SpaceTypeDeclaration,
} from '@/utils/atproto/spaceLexicon';
import { lexiconPathFor } from '@/utils/ufos/nsid';
import { explorePathFromAtUri } from '@/utils/atproto/urls';
import CopyButton from '../CopyButton';

/**
 * Tier 0 for the space type: the `space` definition published at an NSID.
 *
 * This is an ordinary lexicon record in an ordinary public repository, so it
 * resolves with no authentication at all — which makes it the one thing about
 * a space that a signed-out visitor can genuinely read. Every level of the
 * space tree renders it for that reason.
 *
 * A null result is three different things wearing one face — no `_lexicon` TXT
 * record and no schema at the conventional publisher, a schema that is a record
 * type rather than a space type, or a network failure — so the empty state says
 * what was looked for rather than claiming the type doesn't exist.
 */
export default function SpaceTypeCard({ nsid }: { nsid: string }) {
  const [declaration, setDeclaration] = useState<SpaceTypeDeclaration | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDeclaration(null);
    setResolved(false);
    resolveSpaceTypeDeclaration(nsid).then((result) => {
      if (cancelled) return;
      setDeclaration(result);
      setResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [nsid]);

  const sourcePath = declaration ? explorePathFromAtUri(declaration.source.uri) : null;
  const otherNames = declaration?.nameByLang
    ? Object.entries(declaration.nameByLang)
    : [];

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        padding: '1rem',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontSize: '1rem',
            color: 'var(--text-primary)',
          }}
        >
          {declaration ? declaration.name : 'Space type'}
        </h2>
        <Link href={lexiconPathFor(nsid)} className="explore-json-link">
          <code style={{ background: 'transparent', padding: 0 }}>{nsid}</code>
        </Link>
      </div>

      {!resolved && <p className="explore-placeholder">Resolving space type…</p>}

      {resolved && !declaration && (
        <p style={noteStyle}>
          No space type declaration resolved for <code>{nsid}</code>. Either its
          publisher hasn’t published a <code>com.atproto.lexicon.schema</code>{' '}
          record for it, or the record there isn’t a space definition. The space
          itself may still exist; the declaration is documentation, not a
          gatekeeper.
        </p>
      )}

      {resolved && declaration && (
        <>
          {declaration.description && (
            <p
              style={{
                margin: 0,
                fontSize: '0.9rem',
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
                maxWidth: '46rem',
              }}
            >
              {declaration.description}
            </p>
          )}

          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
              gap: '1rem',
              margin: 0,
            }}
          >
            <Field label="key type">
              <code style={codeStyle}>{declaration.key}</code>
            </Field>
            <Field label="collections">
              {declaration.collections.length === 0 ? (
                <span className="explore-muted">none declared</span>
              ) : (
                <span
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.375rem',
                    minWidth: 0,
                  }}
                >
                  {declaration.collections.map((collection) => (
                    <Link
                      key={collection}
                      href={lexiconPathFor(collection)}
                      className="explore-json-link"
                    >
                      {collection}
                    </Link>
                  ))}
                </span>
              )}
            </Field>
            <Field label="declared at">
              {sourcePath ? (
                <Link href={sourcePath} style={{ color: 'var(--text-primary)', textDecoration: 'none', minWidth: 0 }}>
                  <code style={codeStyle}>{declaration.source.uri}</code>
                </Link>
              ) : (
                <code style={codeStyle}>{declaration.source.uri}</code>
              )}
              <CopyButton
                value={declaration.source.uri}
                label="Copy declaration URI"
                compact
                variant="subtle"
              />
            </Field>
          </dl>

          {otherNames.length > 0 && (
            <p style={noteStyle}>
              Also named{' '}
              {otherNames.map(([lang, name], i) => (
                <span key={lang}>
                  {i > 0 && ', '}
                  <strong>{name}</strong> ({lang})
                </span>
              ))}
              .
            </p>
          )}
        </>
      )}
    </section>
  );
}

const codeStyle: React.CSSProperties = {
  background: 'transparent',
  padding: 0,
  color: 'inherit',
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-tertiary)',
  maxWidth: '46rem',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt className="explore-small-caps" style={{ marginBottom: '0.25rem' }}>
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          wordBreak: 'break-all',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        {children}
      </dd>
    </div>
  );
}

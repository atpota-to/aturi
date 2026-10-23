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
import { SpaceTypeFieldsSkeleton } from '../skeletons/pages';

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
    <section className="fx-card fx-sp-section">
      <div className="fx-sp-head">
        <h2 className="fx-sp-h2">{declaration ? declaration.name : 'Space type'}</h2>
        <span className="fx-sp-head-end">
          <Link href={lexiconPathFor(nsid)} prefetch={false} className="fx-sp-head-link">
            <code>{nsid}</code>
          </Link>
        </span>
      </div>

      <div className="fx-sp-body">
        {!resolved && <SpaceTypeFieldsSkeleton />}

        {resolved && !declaration && (
          <p className="fx-sp-note">
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
              <p className="fx-sp-lede">{declaration.description}</p>
            )}

            <dl className="fx-sp-fields">
              <Field label="Key type">
                <code>{declaration.key}</code>
              </Field>
              <Field label="Collections">
                {declaration.collections.length === 0 ? (
                  <span className="explore-muted">none declared</span>
                ) : (
                  <span className="fx-sp-tags">
                    {declaration.collections.map((collection) => (
                      <Link key={collection} href={lexiconPathFor(collection)} prefetch={false}>
                        {collection}
                      </Link>
                    ))}
                  </span>
                )}
              </Field>
              <Field label="Declared at">
                {sourcePath ? (
                  <Link href={sourcePath} prefetch={false}>
                    <code>{declaration.source.uri}</code>
                  </Link>
                ) : (
                  <code>{declaration.source.uri}</code>
                )}
                <CopyButton
                  value={declaration.source.uri}
                  label="Copy declaration URI"
                  compact
                  variant="subtle"
                  iconOnly
                />
              </Field>
            </dl>

            {otherNames.length > 0 && (
              <p className="fx-sp-note">
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
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

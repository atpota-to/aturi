'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Braces, FileQuestion, Globe, ShieldCheck } from 'lucide-react';
import LinkifiedJson from '../../LinkifiedJson';
import { SkeletonBar } from '../../skeletons/primitives';
import { Segmented } from '../primitives';
import { homeScopeFor } from '@/lib/lexiconExplorer';
import { declaredRecordFields, type DeclaredField } from '@/lib/lexiconFieldUsage';
import {
  summarizeLexicon,
  typeText,
  type LexiconDef,
  type LexiconField,
  type LexiconRef,
  type LexiconSection,
  type LexiconType,
} from '@/lib/lexiconSchema';
import {
  cachedLexiconSchema,
  lookupLexiconSchema,
  LEXICON_SCHEMA_COLLECTION,
  type SchemaLookup,
} from '@/utils/atproto/lexiconSchemaLookup';
import { FieldsInPractice, UndeclaredFields, UsageMeter, UsageNote, useFieldUsage, type UsageState } from './FieldUsage';
import { useDidLabel } from './useDidLabel';
import type { AddressFor } from './LexiconRail';

/** A lexicon's published schema, looked up once per visit and shared by every pane that asks. */
export function useSchema(nsid: string): SchemaLookup | null {
  const [answer, setAnswer] = useState<{ nsid: string; lookup: SchemaLookup } | null>(() => {
    const hit = cachedLexiconSchema(nsid);
    return hit ? { nsid, lookup: hit } : null;
  });
  useEffect(() => {
    let cancelled = false;
    const hit = cachedLexiconSchema(nsid);
    if (hit) {
      setAnswer({ nsid, lookup: hit });
      return undefined;
    }
    lookupLexiconSchema(nsid).then((lookup) => {
      if (!cancelled) setAnswer({ nsid, lookup });
    });
    return () => {
      cancelled = true;
    };
  }, [nsid]);
  return answer && answer.nsid === nsid ? answer.lookup : null;
}

/** What the main definition is, in a word, for the inspector's head. */
export function schemaKind(lookup: SchemaLookup | null): string | null {
  if (lookup?.status !== 'found') return null;
  const doc = lookup.doc as { defs?: { main?: { type?: unknown } } } | null;
  const type = doc?.defs?.main?.type;
  return typeof type === 'string' ? type : null;
}

/**
 * The schema tab: who publishes the lexicon and how that was found, then its
 * main definition's fields, each with its type, its limits and what it is
 * for, then the document's other definitions and the lexicons it refers to.
 * A ref to another lexicon opens it beside the same list; a ref within the
 * document scrolls to it. The JSON is a switch away, as published.
 *
 * A record lexicon's fields also say how often records set them (FieldUsage),
 * with the fields records set that the schema leaves out; a lexicon with no
 * schema to find shows the fields records set instead.
 */
export default function SchemaView({
  nsid,
  lookup,
  addressFor,
}: {
  nsid: string;
  lookup: SchemaLookup | null;
  addressFor: AddressFor;
}) {
  const [raw, setRaw] = useState<'summary' | 'json'>('summary');
  const summary = useMemo(
    () => (lookup?.status === 'found' ? summarizeLexicon(lookup.doc, nsid) : null),
    [lookup, nsid],
  );
  const declared = useMemo(() => declaredRecordFields(summary), [summary]);
  // Only records have fields to count, and an invalid NSID has no records.
  const measure = lookup?.status === 'found' ? declared !== null : lookup != null && lookup.status !== 'invalid';
  const usage = useFieldUsage(nsid, measure);
  const rootRef = useRef<HTMLDivElement>(null);

  if (!lookup) return <SchemaSkeleton />;

  if (lookup.status !== 'found') {
    return (
      <div className="fx-lx-schema">
        <NoSchema lookup={lookup} />
        {usage && <FieldsInPractice state={usage} nsid={nsid} addressFor={addressFor} />}
      </div>
    );
  }

  const recordHref = `/explore/${lookup.authority.did}/${LEXICON_SCHEMA_COLLECTION}/${encodeURIComponent(nsid)}`;
  const jump = (ref: LexiconRef) => {
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-def="${CSS.escape(ref.def)}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    target.setAttribute('data-flash', '');
    window.setTimeout(() => target.removeAttribute('data-flash'), 1200);
  };
  const refs: RefTools = { addressFor, jump, nsid };
  const fieldUsage = usage && declared ? { state: usage, declared } : null;

  return (
    <div ref={rootRef} className="fx-lx-schema">
      <div className="fx-lx-schema-bar">
        <Authority lookup={lookup} />
        <div className="fx-lx-schema-tools">
          <Segmented
            ariaLabel="Show the schema as"
            options={[
              { value: 'summary', label: 'Summary' },
              { value: 'json', label: 'JSON' },
            ]}
            value={raw}
            onChange={setRaw}
          />
          <Link href={recordHref} prefetch={false} className="fx-btn fx-btn-sm" title="The schema record in its repository">
            Record
            <ArrowUpRight size={13} aria-hidden />
          </Link>
        </div>
      </div>

      {raw === 'json' || !summary ? (
        <div className="fx-lx-json">
          {!summary && raw === 'summary' && (
            <p className="fx-lx-schema-note">This record doesn’t read as a lexicon document, so here it is as published.</p>
          )}
          <LinkifiedJson value={lookup.doc} />
        </div>
      ) : (
        <>
          {summary.main ? (
            <DefCard def={summary.main} refs={refs} main usage={fieldUsage} />
          ) : (
            <p className="fx-lx-schema-note">This document has no main definition, only the ones below.</p>
          )}
          {summary.defs.length > 0 && (
            <section className="fx-lx-defs" aria-label="Other definitions">
              <h3 className="fx-lx-h">
                Definitions <span className="fx-lx-h-count">{summary.defs.length}</span>
              </h3>
              {summary.defs.map((def) => (
                <DefCard key={def.name} def={def} refs={refs} />
              ))}
            </section>
          )}
          {summary.references.length > 0 && (
            <section className="fx-lx-refs" aria-label="Lexicons this one refers to">
              <h3 className="fx-lx-h">
                Refers to <span className="fx-lx-h-count">{summary.references.length}</span>
              </h3>
              <ul>
                {summary.references.map((ref) => (
                  <li key={ref}>
                    <Link href={addressFor({ scope: homeScopeFor(ref), nsid: ref })} prefetch={false} className="fx-lx-ref">
                      <Braces size={12} aria-hidden />
                      {ref}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

type RefTools = { addressFor: AddressFor; jump: (ref: LexiconRef) => void; nsid: string };

/** How often records set a record lexicon's fields, for its main definition's field table. */
type UsageTools = { state: UsageState; declared: Map<string, DeclaredField> };

function Authority({ lookup }: { lookup: Extract<SchemaLookup, { status: 'found' }> }) {
  const label = useDidLabel(lookup.authority.did);
  return (
    <p className="fx-lx-authority">
      <ShieldCheck size={14} aria-hidden />
      <span>
        Published by{' '}
        <Link href={`/explore/${lookup.authority.did}`} prefetch={false} className="fx-lx-authority-who">
          {label}
        </Link>
        , found through {lookup.authority.via === 'dns' ? 'its domain’s _lexicon record' : 'the handle its NSID reverses to'}
      </span>
    </p>
  );
}

/**
 * Into the lexicon publishing checker, which walks the same chain step by
 * step and says what to add. A static page, so the link keeps its prefetch.
 */
function PublishingCheckLink({ nsid }: { nsid: string }) {
  return (
    <Link href={`/tools/lexicon?nsid=${encodeURIComponent(nsid)}`} rel="nofollow">
      See where the chain stops.
    </Link>
  );
}

function NoSchema({ lookup }: { lookup: Exclude<SchemaLookup, { status: 'found' }> }) {
  if (lookup.status === 'invalid') {
    return (
      <div className="fx-lx-empty">
        <FileQuestion size={18} aria-hidden />
        <p>
          <code>{lookup.nsid}</code> isn’t a valid NSID, so it can’t have a published schema.
        </p>
      </div>
    );
  }
  if (lookup.status === 'no-authority') {
    return (
      <div className="fx-lx-empty">
        <Globe size={18} aria-hidden />
        <p>
          <strong>No schema to find.</strong> Nothing claims this namespace: there’s no <code>_lexicon</code> record
          {lookup.domain ? (
            <>
              {' '}
              on <code>{lookup.domain}</code>
            </>
          ) : null}
          , and <code>{lookup.publisher}</code> isn’t a handle. That’s common for lexicons that work fine; the fields
          below are the shape they take in practice. <PublishingCheckLink nsid={lookup.nsid} />
        </p>
      </div>
    );
  }
  return <Unpublished lookup={lookup} />;
}

function Unpublished({ lookup }: { lookup: Extract<SchemaLookup, { status: 'unpublished' }> }) {
  const label = useDidLabel(lookup.authority.did);
  return (
    <div className="fx-lx-empty">
      <FileQuestion size={18} aria-hidden />
      <p>
        <strong>No schema published.</strong>{' '}
        <Link href={`/explore/${lookup.authority.did}`} prefetch={false}>
          {label}
        </Link>{' '}
        answers for this namespace but has no <code>{LEXICON_SCHEMA_COLLECTION}</code> record for{' '}
        <code>{lookup.nsid}</code>. A lexicon can be widely used without one; the fields below are the shape it takes in
        practice. <PublishingCheckLink nsid={lookup.nsid} />
      </p>
    </div>
  );
}

/** What each main type means, for a reader who hasn't met it. */
const TYPE_NOTES: Record<string, string> = {
  record: 'A record type: what accounts write to their repositories under this NSID.',
  query: 'An XRPC query: an HTTP GET that reads.',
  procedure: 'An XRPC procedure: an HTTP POST that acts.',
  subscription: 'An event stream over a WebSocket.',
  token: 'A token: a named value other definitions refer to.',
  object: 'An object shape other definitions refer to.',
  'permission-set': 'A bundle of permissions an app asks for at once.',
};

function DefCard({
  def,
  refs,
  main = false,
  usage = null,
}: {
  def: LexiconDef;
  refs: RefTools;
  main?: boolean;
  usage?: UsageTools | null;
}) {
  return (
    <article className="fx-lx-def" data-def={def.name} data-main={main || undefined}>
      <header className="fx-lx-def-head">
        <h3 className="fx-lx-def-name">{main ? 'main' : `#${def.name}`}</h3>
        <span className="fx-lx-kind" data-kind={def.type}>
          {def.type}
        </span>
        {def.key && (
          <span className="fx-lx-key" title="The record key type">
            key: <code>{def.key}</code>
          </span>
        )}
      </header>
      {def.description ? (
        <p className="fx-lx-def-desc">{def.description}</p>
      ) : main && TYPE_NOTES[def.type] ? (
        <p className="fx-lx-def-desc" data-muted>
          {TYPE_NOTES[def.type]}
        </p>
      ) : null}
      {def.shape && (
        <p className="fx-lx-shape">
          <TypeView type={def.shape} refs={refs} />
          {def.constraints.map((c) => (
            <span key={c} className="fx-lx-chip">
              {c}
            </span>
          ))}
        </p>
      )}
      {def.sections.map((section, i) => (
        // A record has one section, its fields.
        <SectionView key={section.title} section={section} refs={refs} usage={i === 0 ? usage : null} />
      ))}
      {def.errors.length > 0 && (
        <div className="fx-lx-errors">
          <h4 className="fx-lx-section-title">Errors</h4>
          <ul>
            {def.errors.map((e) => (
              <li key={e.name}>
                <code>{e.name}</code>
                {e.description && <span> {e.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function SectionView({
  section,
  refs,
  usage,
}: {
  section: LexiconSection;
  refs: RefTools;
  usage: UsageTools | null;
}) {
  return (
    <>
      <div className="fx-lx-section">
        <h4 className="fx-lx-section-title">
          {section.title}
          {section.encoding && <code className="fx-lx-encoding">{section.encoding}</code>}
        </h4>
        {section.description && <p className="fx-lx-def-desc">{section.description}</p>}
        {usage && section.fields.length > 0 && <UsageNote state={usage.state} />}
        {section.body && (
          <p className="fx-lx-shape">
            <TypeView type={section.body} refs={refs} />
          </p>
        )}
        {section.fields.length > 0 ? (
          <FieldTable fields={section.fields} refs={refs} usage={usage?.state ?? null} />
        ) : (
          !section.body && <p className="fx-lx-schema-note">No fields.</p>
        )}
      </div>
      {usage && (
        <UndeclaredFields state={usage.state} declared={usage.declared} nsid={refs.nsid} addressFor={refs.addressFor} />
      )}
    </>
  );
}

/**
 * Required fields first, as a reader building a record wants them. With
 * `usage`, each says how often records set it; `parent` is the path of the
 * object a nested table's fields belong to.
 */
function FieldTable({
  fields,
  refs,
  usage = null,
  parent = null,
}: {
  fields: LexiconField[];
  refs: RefTools;
  usage?: UsageState | null;
  parent?: string | null;
}) {
  const ordered = [...fields].sort((a, b) => Number(b.required) - Number(a.required));
  return (
    <dl className="fx-lx-fields">
      {ordered.map((field) => (
        <div key={field.name} className="fx-lx-field" data-deprecated={field.deprecated || undefined}>
          <dt>
            <code className="fx-lx-field-name">{field.name}</code>
            {field.required && (
              <span className="fx-lx-req" title="Required">
                required
              </span>
            )}
            {field.nullable && <span className="fx-lx-opt">nullable</span>}
            {usage && (
              <UsageMeter state={usage} path={parent ? `${parent}.${field.name}` : field.name} required={field.required} />
            )}
          </dt>
          <dd>
            <span className="fx-lx-field-type">
              <TypeView type={field.type} refs={refs} />
              {field.constraints.map((c) => (
                <span key={c} className="fx-lx-chip">
                  {c}
                </span>
              ))}
            </span>
            {field.description && <span className="fx-lx-field-desc">{field.description}</span>}
            {field.type.kind === 'object' && field.type.fields.length > 0 && (
              <div className="fx-lx-nested">
                <FieldTable
                  fields={field.type.fields}
                  refs={refs}
                  usage={usage}
                  parent={parent ? `${parent}.${field.name}` : field.name}
                />
              </div>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TypeView({ type, refs }: { type: LexiconType; refs: RefTools }): ReactNode {
  switch (type.kind) {
    case 'primitive':
      return <code className="fx-lx-type">{type.name}</code>;
    case 'ref':
      return <RefLink ref_={type.ref} refs={refs} />;
    case 'array':
      return (
        <>
          <span className="fx-lx-type-word">array of</span> <TypeView type={type.items} refs={refs} />
        </>
      );
    case 'object':
      return <code className="fx-lx-type">object</code>;
    case 'union':
      return (
        <span className="fx-lx-union" title={typeText(type)}>
          <span className="fx-lx-type-word">{type.closed ? 'one of' : 'any of'}</span>
          {type.refs.length === 0 ? (
            <code className="fx-lx-type">anything</code>
          ) : (
            type.refs.map((r) => <RefLink key={r.label} ref_={r} refs={refs} />)
          )}
        </span>
      );
  }
}

function RefLink({ ref_, refs }: { ref_: LexiconRef; refs: RefTools }) {
  if (ref_.local) {
    return (
      <button type="button" className="fx-lx-reflink" data-local onClick={() => refs.jump(ref_)} title={`Go to ${ref_.label}`}>
        {ref_.label}
      </button>
    );
  }
  return (
    <Link
      href={refs.addressFor({ scope: homeScopeFor(ref_.nsid), nsid: ref_.nsid })}
      prefetch={false}
      className="fx-lx-reflink"
      title={`Open ${ref_.nsid}`}
    >
      {ref_.label}
    </Link>
  );
}

function SchemaSkeleton() {
  return (
    <div className="fx-lx-schema" aria-hidden>
      <SkeletonBar width="70%" height="0.75rem" />
      <div className="fx-lx-def">
        <SkeletonBar width="8rem" height="0.9rem" />
        <SkeletonBar width="90%" height="0.65rem" />
        {['40%', '55%', '35%', '50%', '45%'].map((w, i) => (
          <div key={i} className="fx-lx-field">
            <SkeletonBar width="5rem" height="0.65rem" />
            <SkeletonBar width={w} height="0.65rem" />
          </div>
        ))}
      </div>
    </div>
  );
}

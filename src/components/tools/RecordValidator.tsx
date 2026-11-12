'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { Nsid } from '@/components/explore/lexicons/primitives';
import { toolHref } from '@/lib/tools/catalog';
import { parseValidatorInput, type ValidatorInput } from '@/lib/tools/validateInput';
import { checkRecord, recordVerdict, type RecordCheck } from '@/lib/tools/validateRun';
import type { ValidationIssue } from '@/lib/tools/validate';
import type { SchemaLookup } from '@/utils/atproto/lexiconSchemaLookup';
import { getRecordByUri } from '@/utils/atproto/slingshot';
import {
  ToolCard,
  ToolError,
  ToolFact,
  ToolFacts,
  ToolIntro,
  ToolJson,
  ToolSection,
  ToolShell,
  ToolSkeleton,
  ToolTextForm,
  ToolVerdict,
} from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'validate';

/** A record with three things wrong, so the list of problems has something to show. */
const BROKEN_EXAMPLE = JSON.stringify(
  {
    $type: 'app.bsky.feed.post',
    text: 'A post with a few mistakes in it',
    createdAt: '2026-01-31',
    langs: 'en',
    facets: [{ index: { byteStart: 2 }, features: [] }],
  },
  null,
  2,
);

const EXAMPLES = [
  { label: 'A Bluesky post', value: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3n22yg6lg2k2f' },
  { label: 'A profile', value: 'at://bsky.app/app.bsky.actor.profile/self' },
  { label: 'A record with mistakes', value: BROKEN_EXAMPLE },
];

type Outcome = {
  record: unknown;
  /** The address the record was read from, when it was fetched rather than pasted. */
  uri: string | null;
  check: RecordCheck;
};

async function run(input: Exclude<ValidatorInput, { kind: 'error' }>, signal: AbortSignal): Promise<Outcome> {
  if (input.kind === 'json') {
    return { record: input.record, uri: null, check: await checkRecord(input.record, input.nsid, { signal }) };
  }
  const fetched = await getRecordByUri(input.uri, signal);
  if (!fetched) {
    throw new Error('That record could not be read. It may have been deleted, or its repository may be unreachable.');
  }
  const check = await checkRecord(fetched.value, input.collection, { rkey: input.rkey, signal });
  return { record: fetched.value, uri: fetched.uri, check };
}

/** Why a type has no schema to check against, in words. */
export function noSchemaReason(schema: SchemaLookup): string {
  if (schema.status === 'no-authority') {
    return `Nobody answers for this namespace: there is no _lexicon record on ${schema.domain ?? 'its domain'}, and no account at ${schema.publisher}.`;
  }
  if (schema.status === 'unpublished') {
    return 'The namespace has an owner, but no schema record has been published for this type.';
  }
  if (schema.status === 'invalid') return 'That type is not a valid NSID.';
  return '';
}

function Issues({ issues }: { issues: ValidationIssue[] }) {
  return (
    <ToolCard flush>
      <ul className="fn-tool-rows">
        {issues.map((issue, index) => (
          <li key={index} className="fn-tool-row fn-tool-validate-issue">
            <span className="fn-tool-mark" data-status={issue.severity === 'error' ? 'fail' : 'warn'} aria-hidden>
              {issue.severity === 'error' ? <X size={13} strokeWidth={2.6} /> : <TriangleAlert size={13} />}
            </span>
            <span className="fn-tool-row-main">
              <code className="fn-tool-validate-path">{issue.path || 'record'}</code>
              <span className="fn-tool-validate-message">
                <span className="fn-sr-only">{issue.severity === 'error' ? 'Error: ' : 'Warning: '}</span>
                {issue.message}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </ToolCard>
  );
}

const LOOKUP_WORD: Record<SchemaLookup['status'], { label: string; tone: 'pass' | 'outline' }> = {
  found: { label: 'Found', tone: 'pass' },
  unpublished: { label: 'Not published', tone: 'outline' },
  'no-authority': { label: 'No authority', tone: 'outline' },
  invalid: { label: 'Not an NSID', tone: 'outline' },
};

function Schemas({ check }: { check: RecordCheck }) {
  const { schema } = check;
  return (
    <ToolCard>
      {schema.status === 'found' && (
        <ToolFacts>
          <ToolFact label="Lexicon" copy={schema.nsid}>
            <Link href={`/explore/lexicons/${schema.nsid}`} prefetch={false}>
              <Nsid value={schema.nsid} />
            </Link>
          </ToolFact>
          <ToolFact label="Published by" copy={schema.authority.did}>
            <Link href={`/explore/${schema.authority.did}`} prefetch={false}>
              {schema.authority.did}
            </Link>
          </ToolFact>
          <ToolFact label="Found by" plain>
            {schema.authority.via === 'dns'
              ? 'The _lexicon DNS record on its domain'
              : 'An account at the handle its name reverses to'}
          </ToolFact>
          <ToolFact label="Values checked" plain>
            {check.result.checked.toLocaleString('en-US')}
          </ToolFact>
        </ToolFacts>
      )}
      {check.lookups.length > 1 && (
        <div className="fn-tool-validate-consulted">
          <span className="fn-dt">Also consulted</span>
          <ul>
            {check.lookups.slice(1).map((lookup) => (
              <li key={lookup.nsid}>
                <Link href={`/explore/lexicons/${lookup.nsid}`} prefetch={false}>
                  <Nsid value={lookup.nsid} />
                </Link>
                <span className="fn-tool-pill" data-tone={LOOKUP_WORD[lookup.status].tone}>
                  {LOOKUP_WORD[lookup.status].label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {check.result.unresolved.length > 0 && schema.status === 'found' && (
        <p className="fn-tool-note fn-tool-validate-unchecked">
          Not checked, because these could not be found: {check.result.unresolved.join(', ')}.
        </p>
      )}
      <div className="fn-tool-actions">
        <Link
          href={`${toolHref('lexicon')}?nsid=${encodeURIComponent(check.nsid)}`}
          className="fx-btn fx-btn-sm"
        >
          Check how this lexicon is published
        </Link>
      </div>
    </ToolCard>
  );
}

/**
 * Checks a record against the lexicon published for its type. The checking
 * is in src/lib/tools/validate.ts and the schema fetching in validateRun.ts;
 * the explorer's record view runs the same two.
 *
 * An at:// URI is kept in the link like every other tool's input. A pasted
 * record is not: it can be long, and it is somebody's data.
 */
export default function RecordValidator() {
  const [{ uri }, setQuery] = useToolQuery(['uri'] as const);
  const [pasted, setPasted] = useState('');
  const raw = pasted || uri;
  const input = raw ? parseValidatorInput(raw) : null;
  const runnable = input && input.kind !== 'error' ? input : null;

  const state = useToolRun<Outcome>(runnable ? raw : null, ({ signal }) =>
    run(runnable as Exclude<ValidatorInput, { kind: 'error' }>, signal),
  );

  function submit(value: string) {
    if (value.startsWith('{')) {
      setPasted(value);
      setQuery({ uri: '' }, { replace: true });
    } else {
      setPasted('');
      setQuery({ uri: value });
    }
  }

  const outcome = state.status === 'done' ? state.data : null;
  const verdict = outcome ? recordVerdict(outcome.check) : null;
  const errors = outcome?.check.result.issues.filter((issue) => issue.severity === 'error') ?? [];
  const warnings = outcome?.check.result.issues.filter((issue) => issue.severity === 'warning') ?? [];

  return (
    <ToolShell
      slug={SLUG}
      share={uri && !pasted ? `${toolHref(SLUG)}?uri=${encodeURIComponent(uri)}` : undefined}
      form={
        <ToolTextForm
          value={raw}
          onSubmit={submit}
          label="Record to validate"
          placeholder={'at://did:plc:…/app.bsky.feed.post/…\n\nor a record as JSON, with its $type'}
          submitLabel="Validate"
          rows={5}
          busy={state.status === 'loading'}
          examples={EXAMPLES}
        />
      }
    >
      {input?.kind === 'error' && <ToolError>{input.reason}</ToolError>}
      {state.status === 'error' && <ToolError onRetry={state.rerun}>{state.error}</ToolError>}
      {state.status === 'loading' && (
        <>
          <ToolVerdict tone="info" title="Checking the record" icon={<LoaderCircle size={18} className="fn-tool-spin" />}>
            Reading the record and the schema published for its type.
          </ToolVerdict>
          <ToolSkeleton rows={3} />
        </>
      )}

      {outcome && verdict && (
        <>
          {verdict === 'valid' && (
            <ToolVerdict tone="pass" title="The record matches its schema" icon={<Check size={18} strokeWidth={2.6} />}>
              Every field is of the type, and within the limits, that {outcome.check.nsid} sets.
            </ToolVerdict>
          )}
          {verdict === 'warnings' && (
            <ToolVerdict
              tone="warn"
              title={`The record is valid, with ${warnings.length === 1 ? 'one thing' : `${warnings.length} things`} to look at`}
              icon={<TriangleAlert size={18} />}
            >
              Nothing breaks {outcome.check.nsid}, but something in it is probably not what was meant.
            </ToolVerdict>
          )}
          {verdict === 'invalid' && (
            <ToolVerdict
              tone="fail"
              title={`The record does not match its schema: ${errors.length === 1 ? 'one problem' : `${errors.length} problems`}`}
              icon={<X size={18} strokeWidth={2.6} />}
            >
              Apps that check records against {outcome.check.nsid} may refuse or ignore this one.
            </ToolVerdict>
          )}
          {verdict === 'no-schema' && (
            <ToolVerdict tone="info" title={`No schema is published for ${outcome.check.nsid}`} icon={<Info size={18} />}>
              {noSchemaReason(outcome.check.schema)} There is nothing to check the record against.
            </ToolVerdict>
          )}

          {outcome.check.result.issues.length > 0 && (
            <ToolSection
              title="Problems"
              meta={[
                errors.length ? `${errors.length} ${errors.length === 1 ? 'error' : 'errors'}` : null,
                warnings.length ? `${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}` : null,
              ]
                .filter(Boolean)
                .join(', ')}
            >
              <Issues issues={[...errors, ...warnings]} />
            </ToolSection>
          )}

          <ToolSection title="Schema">
            <Schemas check={outcome.check} />
          </ToolSection>

          <ToolSection
            title="Record"
            meta={
              outcome.uri ? (
                <Link href={`/explore/${outcome.uri.slice('at://'.length)}`} prefetch={false} className="fn-tool-link">
                  Open in the Explorer
                </Link>
              ) : undefined
            }
          >
            <ToolJson value={outcome.record} label="record" />
          </ToolSection>
        </>
      )}

      {!raw && (
        <ToolIntro
          items={[
            {
              term: 'The schema is the published one',
              text: (
                <>
                  The record’s <code>$type</code> names a lexicon. Its schema is found the way the network finds
                  it: the <code>_lexicon</code> DNS record on its domain, then the schema record in that account’s
                  repository.
                </>
              ),
            },
            {
              term: 'Every field is checked',
              text: 'Required fields, types, string formats, byte and character limits, array sizes, blobs, and the types a union allows.',
            },
            {
              term: 'References are followed',
              text: 'When a field’s type lives in another lexicon, that one is fetched and checked too. Anything that could not be found is listed, not passed.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}

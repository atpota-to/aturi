'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, FileCheck2, TriangleAlert, X } from 'lucide-react';
import { checkRecord, recordVerdict, type RecordCheck, type RecordVerdict } from '@/lib/tools/validateRun';

/**
 * A record checked against the schema published for its type, in the record
 * view and in the editor. The record validator (/tools/validate) runs the
 * same check on its own page; this is that check where the record already is.
 *
 * Schemas are found the way the lexicon pane finds them and are kept an hour
 * (lexiconSchemaLookup.ts), so stepping through a collection looks each type
 * up once.
 */

const VERDICT_WORDS: Record<RecordVerdict, string> = {
  valid: 'Matches its schema',
  warnings: 'Valid, with notes',
  invalid: 'Does not match its schema',
  'no-schema': 'No published schema',
};

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function summary(check: RecordCheck, verdict: RecordVerdict): string {
  const errors = check.result.issues.filter((i) => i.severity === 'error').length;
  const warnings = check.result.issues.length - errors;
  if (verdict === 'invalid') return count(errors, 'problem', 'problems');
  if (verdict === 'warnings') return `Valid, ${count(warnings, 'note', 'notes')}`;
  return VERDICT_WORDS[verdict];
}

function Mark({ verdict }: { verdict: RecordVerdict }) {
  if (verdict === 'no-schema') return null;
  return (
    <span
      aria-hidden
      className="fn-tool-mark fn-rec-schema-mark"
      data-status={verdict === 'valid' ? 'pass' : verdict === 'warnings' ? 'warn' : 'fail'}
    >
      {verdict === 'valid' ? (
        <Check size={10} strokeWidth={3} />
      ) : verdict === 'warnings' ? (
        <TriangleAlert size={10} />
      ) : (
        <X size={10} strokeWidth={3} />
      )}
    </span>
  );
}

/** The problems found, one per line: where, then what. */
export function SchemaIssueList({ check, id }: { check: RecordCheck; id?: string }) {
  const issues = [...check.result.issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return (
    <ul className="fn-rec-schema-issues" id={id}>
      {issues.map((issue, index) => (
        <li key={index} data-severity={issue.severity}>
          <code>{issue.path || 'record'}</code>
          <span>
            <span className="fn-sr-only">{issue.severity === 'error' ? 'Error: ' : 'Note: '}</span>
            {issue.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The record card's Schema row, beside URI and CID. It checks on its own once
 * the record is in hand, and says nothing if the lookup fails: a record page
 * should not grow an error because a third party did not answer.
 */
export function RecordSchemaRow({
  record,
  collection,
  rkey,
  atUri,
}: {
  record: unknown;
  collection: string;
  rkey: string;
  atUri: string;
}) {
  const [state, setState] = useState<{ key: string; check: RecordCheck } | null>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();

  useEffect(() => {
    const controller = new AbortController();
    checkRecord(record, collection, { rkey, signal: controller.signal })
      .then((check) => {
        if (!controller.signal.aborted) setState({ key: atUri, check });
      })
      .catch(() => {
        // Leave the row out rather than report someone else's outage.
      });
    return () => controller.abort();
  }, [record, collection, rkey, atUri]);

  const check = state?.key === atUri ? state.check : null;
  if (!check) return null;
  const verdict = recordVerdict(check);
  const hasIssues = check.result.issues.length > 0;
  const validatorHref = `/tools/validate?uri=${encodeURIComponent(atUri)}`;

  return (
    <>
      <dt>Schema</dt>
      <dd className="fn-rec-schema" data-verdict={verdict}>
        <Mark verdict={verdict} />
        {hasIssues ? (
          <button
            type="button"
            className="fn-rec-schema-toggle"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
          >
            {summary(check, verdict)}
            <ChevronDown size={12} aria-hidden />
          </button>
        ) : (
          <span className="fn-rec-schema-text">{summary(check, verdict)}</span>
        )}
        {/* Static page, so the link keeps its prefetch; nofollow because it
            carries a record address, one per record page. */}
        <Link
          href={verdict === 'no-schema' ? `/tools/lexicon?nsid=${encodeURIComponent(collection)}` : validatorHref}
          rel="nofollow"
          className="fx-copy fn-rec-schema-open"
          data-variant="subtle"
          data-icon-only
          title={verdict === 'no-schema' ? 'Check how this lexicon is published' : 'Open in the record validator'}
          aria-label={verdict === 'no-schema' ? 'Check how this lexicon is published' : 'Open in the record validator'}
        >
          <FileCheck2 size={12} aria-hidden />
        </Link>
      </dd>
      {hasIssues && open && (
        <dd className="fn-rec-schema-detail">
          <SchemaIssueList check={check} id={listId} />
        </dd>
      )}
    </>
  );
}

/**
 * The editor's check: run on request against what is in the editor now, and
 * shown above the Save button. It advises; the PDS decides what it accepts.
 */
export function SchemaCheckResult({ check }: { check: RecordCheck }) {
  const verdict = recordVerdict(check);
  return (
    <div className="fn-rec-schema-result" data-verdict={verdict} role="status">
      <p>
        <Mark verdict={verdict} />
        <strong>{summary(check, verdict)}</strong>
        <span>
          {verdict === 'no-schema'
            ? `Nothing is published for ${check.nsid}, so there is nothing to check against.`
            : verdict === 'valid'
              ? `Checked against the published ${check.nsid} schema.`
              : `Against the published ${check.nsid} schema.`}
        </span>
      </p>
      {check.result.issues.length > 0 && <SchemaIssueList check={check} />}
    </div>
  );
}

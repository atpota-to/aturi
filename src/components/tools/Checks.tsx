'use client';

import type { ReactNode } from 'react';
import { Check, Info, LoaderCircle, Minus, TriangleAlert, X } from 'lucide-react';

/**
 * A check list: the steps a tool walks, each with how it came out.
 *
 * The handle debugger, the lexicon publishing checker, the OAuth client
 * checker and the relay check all answer the same kind of question, "where
 * does this chain break?", so they share one way of showing it.
 */

/**
 * `pass` and `fail` are findings. `warn` works but is worth knowing about.
 * `info` is a fact with no judgment attached, `skip` could not be run because
 * an earlier step failed, and `pending` is still on its way.
 */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'skip' | 'pending';

export type CheckItem = {
  id: string;
  status: CheckStatus;
  /** What was checked, e.g. "DNS record". */
  title: string;
  /** How it came out, in a sentence. */
  summary?: ReactNode;
  /** The evidence: what was asked and what came back. */
  detail?: ReactNode;
  /** What to change, when the step failed or warned. */
  fix?: ReactNode;
};

/** The word beside the mark, so a status never rests on colour alone. */
const STATUS_WORD: Record<CheckStatus, string> = {
  pass: 'Pass',
  warn: 'Warning',
  fail: 'Fail',
  info: 'Note',
  skip: 'Skipped',
  pending: 'Checking',
};

export function CheckMark({ status, size = 13 }: { status: CheckStatus; size?: number }) {
  const glyph =
    status === 'pass' ? (
      <Check size={size} strokeWidth={2.6} />
    ) : status === 'warn' ? (
      <TriangleAlert size={size} />
    ) : status === 'fail' ? (
      <X size={size} strokeWidth={2.6} />
    ) : status === 'info' ? (
      <Info size={size} />
    ) : status === 'skip' ? (
      <Minus size={size} />
    ) : (
      <LoaderCircle size={size} className="fn-tool-spin" />
    );
  return (
    <span aria-hidden className="fn-tool-mark" data-status={status}>
      {glyph}
    </span>
  );
}

export function CheckList({ checks, label }: { checks: CheckItem[]; label: string }) {
  return (
    <ol className="fx-card fn-tool-checks" aria-label={label}>
      {checks.map((check) => (
        <li key={check.id} className="fn-tool-check" data-status={check.status}>
          <CheckMark status={check.status} />
          <div className="fn-tool-check-body">
            <div className="fn-tool-check-head">
              <span className="fn-tool-check-title">{check.title}</span>
              <span className="fn-tool-check-state">{STATUS_WORD[check.status]}</span>
            </div>
            {check.summary ? <p className="fn-tool-check-summary">{check.summary}</p> : null}
            {check.detail ? <div className="fn-tool-check-detail">{check.detail}</div> : null}
            {check.fix ? (
              <div className="fn-tool-check-fix">
                <span>How to fix</span>
                <div>{check.fix}</div>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The worst status in a list, for the verdict above it. */
export function worstStatus(checks: CheckItem[]): 'pass' | 'warn' | 'fail' | 'pending' {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'pending')) return 'pending';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'pass';
}

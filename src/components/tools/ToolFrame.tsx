'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { RotateCw, Search } from 'lucide-react';
import AppearIn from '@/components/explore/AppearIn';
import CopyButton from '@/components/explore/CopyButton';
import LinkifiedJson from '@/components/explore/LinkifiedJson';
import ShareLinkChip from '@/components/explore/ShareLinkChip';
import { TOOL_GROUPS, toolBySlug, toolHref } from '@/lib/tools/catalog';

/**
 * The parts every tool page under /tools is built from, so sixteen tools read
 * as one section: the head card (where it is, what it is, its input), then
 * sections of results underneath.
 *
 * Built from the explorer's parts, as the hub is: the head is the detail
 * pages' card (.fn-lexhead, explore.css), the input is the explorer's search
 * field (.fn-searchbox, globals.css), examples are its try-chips (.fn-chip),
 * and results sit in its cards (.fx-card, explorer.css). What is new lives in
 * tool-pages.css under the fn-tool- prefix.
 *
 * The stream monitor is the exception. It is a dashboard that fills the
 * window and keeps its own frame (StreamMonitor.tsx).
 */

/**
 * The page frame: the head card, then whatever the tool has to show.
 *
 * Takes the tool's slug rather than its catalog entry, because the entry
 * holds an icon component and this is rendered from server pages too (as the
 * Suspense fallback), where a component cannot cross to the client as a prop.
 */
export function ToolShell({
  slug,
  share,
  wide,
  form,
  children,
}: {
  slug: string;
  /** Path and query of the view to copy, when it differs from the bare page. */
  share?: string;
  /** The hub's 1240px column rather than the reading column, for tables. */
  wide?: boolean;
  /** The tool's input, drawn inside the head card. */
  form?: ReactNode;
  children?: ReactNode;
}) {
  const tool = toolBySlug(slug);
  const group = TOOL_GROUPS.find((g) => g.id === tool.group);
  const { Icon } = tool;
  return (
    <div className="fn-tool" data-wide={wide || undefined}>
      <AppearIn rise>
        <header className="fn-lexhead fn-tool-head">
          <div className="fn-tool-head-top">
            <nav aria-label="Breadcrumb" className="fn-kicker fn-tool-crumb">
              <Link href="/tools">Tools</Link>
              {group && (
                <>
                  <span aria-hidden>/</span>
                  <span>{group.title}</span>
                </>
              )}
            </nav>
            <ShareLinkChip url={share ?? toolHref(slug)} />
          </div>
          <div className="fn-tool-title">
            <span aria-hidden className="fn-x-tile-icon">
              <Icon size={18} />
            </span>
            <h1 className="fn-lexhead-title">{tool.title}</h1>
          </div>
          <p className="fn-tool-lead">{tool.lead}</p>
          {form}
        </header>
      </AppearIn>
      {children ? (
        <AppearIn delay={0.08} className="fn-tool-body">
          {children}
        </AppearIn>
      ) : null}
    </div>
  );
}

export type ToolExample = {
  /** What the chip says. Defaults to the value. */
  label?: string;
  value: string;
};

function Examples({
  examples,
  onPick,
}: {
  examples: ToolExample[];
  onPick: (value: string) => void;
}) {
  return (
    <div className="fn-x-tries fn-tool-tries">
      <span>Try</span>
      {examples.map((example) => (
        <button
          key={example.value}
          type="button"
          className="fn-chip"
          data-label={example.label ? true : undefined}
          onClick={() => onPick(example.value)}
        >
          {example.label ?? example.value}
        </button>
      ))}
    </div>
  );
}

/**
 * A tool's one-line input: the explorer's search field with the tool's own
 * verb on the button, and examples to try underneath.
 *
 * `value` is the submitted input (the query string holds it); what is being
 * typed is kept here until Enter or the button commits it. When `value`
 * changes from outside, by an example, a link or Back, the field follows.
 */
export function ToolForm({
  value,
  onSubmit,
  label,
  placeholder,
  submitLabel = 'Check',
  busy = false,
  examples,
  mono = false,
  icon,
}: {
  value: string;
  onSubmit: (value: string) => void;
  /** The accessible name of the field. */
  label: string;
  placeholder: string;
  submitLabel?: string;
  busy?: boolean;
  examples?: ToolExample[];
  /** Set the field in the mono face, for identifiers. */
  mono?: boolean;
  icon?: ReactNode;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(draft.trim());
  }

  return (
    <div className="fn-tool-form">
      <form onSubmit={submit} className="fn-searchbox fn-tool-searchbox">
        <div className="fn-searchbox-field">
          <span aria-hidden className="fn-searchbox-icon fn-tool-searchbox-icon">
            {icon ?? <Search size={17} />}
          </span>
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="fn-searchbox-input"
            data-mono={mono || undefined}
            placeholder={placeholder}
            aria-label={label}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <button type="submit" className="fn-searchbox-submit" disabled={busy}>
          {submitLabel}
        </button>
      </form>
      {examples && examples.length > 0 && <Examples examples={examples} onPick={onSubmit} />}
    </div>
  );
}

/**
 * The same, for input that runs to many lines: a record, a list of handles.
 * Ctrl or Cmd with Enter submits, since Enter alone is a new line.
 */
export function ToolTextForm({
  value,
  onSubmit,
  label,
  placeholder,
  submitLabel = 'Check',
  busy = false,
  rows = 8,
  examples,
  actions,
}: {
  value: string;
  onSubmit: (value: string) => void;
  label: string;
  placeholder: string;
  submitLabel?: string;
  busy?: boolean;
  rows?: number;
  examples?: ToolExample[];
  /** Extra controls on the button row, to the left of the submit button. */
  actions?: ReactNode;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    onSubmit(draft.trim());
  }

  return (
    <div className="fn-tool-form">
      <form onSubmit={submit} className="fn-tool-textform">
        <textarea
          className="fn-tool-textarea"
          rows={rows}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          placeholder={placeholder}
          aria-label={label}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
          }}
        />
        <div className="fn-tool-textform-row">
          {actions}
          <span className="fn-tool-textform-hint">
            <kbd className="kbd">Ctrl</kbd> <kbd className="kbd">Enter</kbd> to run
          </span>
          <button type="submit" className="fn-searchbox-submit" disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
      {examples && examples.length > 0 && <Examples examples={examples} onPick={onSubmit} />}
    </div>
  );
}

/** A titled block of results, headed like the PDS page's "Repos on this PDS". */
export function ToolSection({
  title,
  meta,
  children,
  id,
}: {
  title: string;
  /** Quiet text on the heading's right: a count, a source. */
  meta?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="fn-tool-section" id={id}>
      <header className="fn-pds-repos-head fn-tool-section-head">
        <h2>{title}</h2>
        {meta != null && meta !== false && <span>{meta}</span>}
      </header>
      {children}
    </section>
  );
}

/** A surface for results: the explorer's card, padded unless it holds rows. */
export function ToolCard({
  children,
  flush,
  className,
}: {
  children: ReactNode;
  /** No padding, for a list or table that runs edge to edge. */
  flush?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`fx-card fn-tool-card${className ? ` ${className}` : ''}`}
      data-flush={flush || undefined}
    >
      {children}
    </div>
  );
}

export type ToolTone = 'pass' | 'warn' | 'fail' | 'info';

/** The answer in one line, above the detail that supports it. */
export function ToolVerdict({
  tone,
  title,
  children,
  icon,
}: {
  tone: ToolTone;
  title: ReactNode;
  children?: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className="fn-tool-verdict" data-tone={tone} role="status">
      <span aria-hidden className="fn-tool-verdict-mark">
        {icon}
      </span>
      <div className="fn-tool-verdict-text">
        <strong>{title}</strong>
        {children ? <p>{children}</p> : null}
      </div>
    </div>
  );
}

/** Labelled values in a grid, as the PDS page lays out a server's details. */
export function ToolFacts({ children }: { children: ReactNode }) {
  return <dl className="fn-tool-facts">{children}</dl>;
}

export function ToolFact({
  label,
  children,
  copy,
  wide,
  plain,
}: {
  label: string;
  children: ReactNode;
  /** A value to offer on a copy button beside it. */
  copy?: string;
  /** Span the whole row, for a value that will not fit a column. */
  wide?: boolean;
  /** Sans rather than mono, for prose values. */
  plain?: boolean;
}) {
  return (
    <div className="fn-tool-fact" data-wide={wide || undefined}>
      <dt className="fn-dt">{label}</dt>
      <dd data-plain={plain || undefined}>
        <span className="fn-tool-fact-value">{children}</span>
        {copy ? <CopyButton value={copy} label={`Copy ${label}`} compact variant="subtle" iconOnly /> : null}
      </dd>
    </div>
  );
}

/**
 * What a tool does, shown before it has been given anything: the page is
 * never an empty field, and the steps double as its documentation.
 */
export function ToolIntro({
  title = 'What it checks',
  items,
  children,
}: {
  title?: string;
  items?: { term: string; text: ReactNode }[];
  children?: ReactNode;
}) {
  return (
    <ToolSection title={title}>
      <ToolCard>
        {items && (
          <ol className="fn-tool-steps">
            {items.map((item, index) => (
              <li key={item.term}>
                <span aria-hidden className="fn-tool-step-n">
                  {index + 1}
                </span>
                <div>
                  <strong>{item.term}</strong>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {children}
      </ToolCard>
    </ToolSection>
  );
}

/** A failure the tool could not get past, with a way to try again. */
export function ToolError({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="fn-tool-error" role="alert">
      <p>{children}</p>
      {onRetry && (
        <button type="button" className="fx-btn fx-btn-sm" onClick={onRetry}>
          <RotateCw size={13} aria-hidden /> Try again
        </button>
      )}
    </div>
  );
}

/** Nothing to show, said plainly. */
export function ToolEmpty({ children }: { children: ReactNode }) {
  return <p className="explore-placeholder fn-tool-empty">{children}</p>;
}

/** Fixed-width evidence: a DNS answer, a header, a snippet to copy. */
export function ToolCode({
  children,
  copy,
  label = 'snippet',
}: {
  children: ReactNode;
  copy?: string;
  label?: string;
}) {
  return (
    <div className="fn-tool-code">
      <pre className="fn-tool-pre">{children}</pre>
      {copy ? <CopyButton value={copy} label={`Copy ${label}`} compact variant="subtle" iconOnly /> : null}
    </div>
  );
}

/** A JSON value, with the explorer's links on every at:// URI, DID and URL in it. */
export function ToolJson({ value, label = 'JSON' }: { value: unknown; label?: string }) {
  return (
    <div className="fn-tool-code fn-tool-json">
      <LinkifiedJson value={value} className="fn-tool-pre" />
      <CopyButton value={JSON.stringify(value, null, 2)} label={`Copy ${label}`} compact variant="subtle" iconOnly />
    </div>
  );
}

/** Placeholder rows while a tool waits on the network. */
export function ToolSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ToolCard flush>
      <ul className="fn-tool-skeleton" aria-hidden>
        {Array.from({ length: rows }, (_, index) => (
          <li key={index}>
            <span className="fn-skel" data-shape="circle" style={{ width: 22, height: 22 }} />
            <span className="fn-tool-skeleton-lines">
              <span className="fn-skel" style={{ width: `${38 - (index % 3) * 8}%`, height: 12 }} />
              <span className="fn-skel" style={{ width: `${72 - (index % 4) * 9}%`, height: 10 }} />
            </span>
          </li>
        ))}
      </ul>
      <span className="fn-sr-only" role="status">
        Loading
      </span>
    </ToolCard>
  );
}

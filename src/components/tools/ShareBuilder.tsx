'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, TriangleAlert } from 'lucide-react';
import CopyButton from '@/components/explore/CopyButton';
import { WAYPOINT_ICONS } from '@/utils/waypointIcons';
import { toolHref } from '@/lib/tools/catalog';
import {
  POST_GRAPHEME_LIMIT,
  SHARE_BUTTON_STYLE,
  anchorSnippet,
  buttonSnippet,
  composeText,
  countGraphemes,
  shareTargets,
  shareUrlProblem,
} from '@/lib/tools/share';
import { ToolCard, ToolCode, ToolIntro, ToolSection, ToolShell, ToolVerdict } from './ToolFrame';
import { useToolQuery } from './useToolQuery';

const SLUG = 'share';

/** How long typing has to pause before the link in the address bar follows. */
const WRITE_DELAY_MS = 400;

type Draft = { text: string; url: string };

const EXAMPLES: { label: string; draft: Draft }[] = [
  { label: 'A page', draft: { text: 'Touring the Atmosphere with aturi.to', url: 'https://aturi.to' } },
  { label: 'Text only', draft: { text: 'Hello from my own website!', url: '' } },
];

function same(a: Draft, b: Draft): boolean {
  return a.text === b.text && a.url === b.url;
}

/**
 * Builds the link that opens each client's composer with some text, and the
 * markup to put it on a page. The clients and their routes come from the
 * waypoint catalog (src/lib/tools/share.ts).
 *
 * The text and link live in the query string, so a set of links can be
 * shared, but they are written there with `replace` and only once typing
 * pauses: a history entry per keystroke would bury the page before this one,
 * and browsers cap how often the address bar may be rewritten.
 *
 * That makes the fields the source of truth while someone types, with the
 * address bar following behind. `written` is the last value this page put
 * there, which is how a change from outside (Back, a pasted link) is told
 * from the echo of our own write: only the former replaces what is typed.
 */
export default function ShareBuilder() {
  const [query, setQuery] = useToolQuery(['text', 'url'] as const);
  const fromQuery: Draft = { text: query.text, url: query.url };
  const [draft, setDraft] = useState<Draft>(fromQuery);
  const [seen, setSeen] = useState<Draft>(fromQuery);
  const [written, setWritten] = useState<Draft>(fromQuery);
  const [chosen, setChosen] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const textId = useId();
  const urlId = useId();
  const labelId = useId();

  if (!same(seen, fromQuery)) {
    setSeen(fromQuery);
    if (!same(written, fromQuery)) {
      setWritten(fromQuery);
      setDraft(fromQuery);
    }
  }

  useEffect(() => {
    if (same(draft, written)) return undefined;
    const timer = window.setTimeout(() => {
      setWritten(draft);
      setQuery({ text: draft.text, url: draft.url }, { replace: true });
    }, WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, written, setQuery]);

  /** An example is a deliberate change, so it goes to the address bar at once. */
  function apply(next: Draft) {
    setDraft(next);
    setWritten(next);
    setQuery({ text: next.text, url: next.url }, { replace: true });
  }

  const post = composeText(draft.text, draft.url);
  const graphemes = countGraphemes(post);
  const over = graphemes - POST_GRAPHEME_LIMIT;
  const urlProblem = shareUrlProblem(draft.url);
  const targets = shareTargets(post);
  const target = targets.find((t) => t.id === chosen) ?? targets[0];
  const buttonLabel = label ?? (target ? `Share on ${target.name}` : 'Share');
  const share =
    draft.text || draft.url
      ? `${toolHref(SLUG)}?${new URLSearchParams(
          Object.entries(draft).filter(([, value]) => value),
        ).toString()}`
      : undefined;

  return (
    <ToolShell
      slug={SLUG}
      share={share}
      form={
        <div className="fn-tool-form fn-tool-share-form">
          <div className="fn-tool-share-field">
            <div className="fn-tool-share-label">
              <label htmlFor={textId}>Text</label>
              <span data-over={over > 0 || undefined} aria-live="polite">
                {graphemes} / {POST_GRAPHEME_LIMIT}
              </span>
            </div>
            <textarea
              id={textId}
              className="fn-tool-textarea fn-tool-share-text"
              rows={3}
              placeholder="What the post should say"
              value={draft.text}
              onChange={(event) => setDraft({ ...draft, text: event.target.value })}
            />
          </div>
          <div className="fn-tool-share-field">
            <div className="fn-tool-share-label">
              <label htmlFor={urlId}>Link (optional)</label>
            </div>
            <input
              id={urlId}
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="fn-searchbox-input fn-tool-share-url"
              placeholder="https://example.com/post"
              aria-invalid={urlProblem ? true : undefined}
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            />
            {urlProblem && <p className="fn-tool-share-problem">{urlProblem}</p>}
          </div>
          <div className="fn-x-tries fn-tool-tries">
            <span>Try</span>
            {EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                className="fn-chip"
                data-label
                onClick={() => apply(example.draft)}
              >
                {example.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {over > 0 && (
        <ToolVerdict tone="warn" title="The post is too long to send as it is" icon={<TriangleAlert size={18} />}>
          It is {graphemes} characters, {over} over the limit of {POST_GRAPHEME_LIMIT}. The composer
          still opens, but the post cannot be sent until it is cut down.
        </ToolVerdict>
      )}

      {!post && (
        <ToolIntro
          title="How it works"
          items={[
            {
              term: 'One link per client',
              text: (
                <>
                  Each link opens that client’s composer with the text already in it. Nothing is
                  posted until the person presses send, and someone who is signed out is asked to
                  sign in first.
                </>
              ),
            },
            {
              term: 'The text is the post',
              text: (
                <>
                  A link, when there is one, goes on a line of its own after the text. The whole
                  thing has to fit in {POST_GRAPHEME_LIMIT} characters.
                </>
              ),
            },
            {
              term: 'Markup to paste',
              text: 'Pick a client and copy a plain link, or a button that carries its own styling.',
            },
          ]}
        />
      )}

      <ToolSection title="Links" meta={`${targets.length} clients`}>
        <ToolCard flush>
          <ul className="fn-tool-rows">
            {targets.map((item) => (
              <li key={item.id} className="fn-tool-row fn-tool-share-row">
                <span aria-hidden className="fn-tool-share-icon">
                  {WAYPOINT_ICONS[item.id] ?? null}
                </span>
                <div className="fn-tool-row-main">
                  <span className="fn-tool-row-title">{item.name}</span>
                  <span className="fn-tool-row-sub" data-mono>
                    {item.url}
                  </span>
                  {!item.prefillsText && (
                    <span className="fn-tool-row-sub fn-tool-share-caveat">
                      Opens the composer, but does not fill in the text.
                    </span>
                  )}
                  {item.appUrl && (
                    <span className="fn-tool-row-sub fn-tool-share-app">
                      <span>In the app</span>
                      <CopyButton value={item.appUrl} label="Copy app link" compact variant="subtle" />
                    </span>
                  )}
                </div>
                <div className="fn-tool-row-end">
                  <CopyButton value={item.url} label="Copy link" compact />
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fx-btn fx-btn-sm"
                    aria-label={`Open the ${item.name} composer`}
                  >
                    <ExternalLink size={13} aria-hidden /> Open
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </ToolCard>
        <p className="fn-tool-note fn-tool-share-source">
          These are the clients in the{' '}
          <Link href="/links">universal links</Link> catalog with a confirmed compose route. The route is
          Bluesky’s{' '}
          <a href="https://docs.bsky.app/docs/advanced-guides/intent-links" target="_blank" rel="noreferrer">
            action intent link
          </a>
          .
        </p>
      </ToolSection>

      {target && (
        <ToolSection title="Markup">
          <ToolCard className="fn-tool-share-markup">
            <div className="fn-tool-share-pick">
              <span className="fn-tool-share-pick-label">For</span>
              <div className="fn-tool-choices" role="group" aria-label="Client the markup links to">
                {targets.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`fn-chip${item.id === target.id ? ' fn-chip-mine' : ''}`}
                    aria-pressed={item.id === target.id}
                    onClick={() => setChosen(item.id)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="fn-tool-share-field">
              <div className="fn-tool-share-label">
                <label htmlFor={labelId}>Label</label>
              </div>
              <span className="fx-field fn-tool-share-labelfield">
                <input
                  id={labelId}
                  type="text"
                  autoComplete="off"
                  value={buttonLabel}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </span>
            </div>

            <div className="fn-tool-share-snippet">
              <h3>A plain link</h3>
              <ToolCode copy={anchorSnippet(target, buttonLabel)} label="link markup">
                {anchorSnippet(target, buttonLabel)}
              </ToolCode>
            </div>

            <div className="fn-tool-share-snippet">
              <h3>A button with its own styling</h3>
              <div className="fn-tool-share-preview">
                <a href={target.url} target="_blank" rel="noopener noreferrer" style={SHARE_BUTTON_STYLE}>
                  {buttonLabel}
                </a>
              </div>
              <ToolCode copy={buttonSnippet(target, buttonLabel)} label="button markup">
                {buttonSnippet(target, buttonLabel)}
              </ToolCode>
            </div>
          </ToolCard>
        </ToolSection>
      )}
    </ToolShell>
  );
}

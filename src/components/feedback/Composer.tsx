'use client';

import { useState } from 'react';
import type { Agent } from '@atproto/api';
import { Loader2, Send } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import type { SpaceTag, StrongRef } from '@/utils/userinput/lexicons';
import { createDiscussion } from '@/utils/userinput/writes';

const TITLE_MAX = 300;
const BODY_MAX = 10_000;

/**
 * Post a new discussion into the space.
 *
 * The record lands in the poster's own repo, so there's nothing to moderate
 * before it appears — but Constellation needs a moment to index it off the
 * firehose, which is why `onPosted` refreshes the board rather than splicing
 * the new discussion in locally. A row that appeared instantly and then
 * vanished on the next load would be worse than a short wait.
 */
export default function Composer({
  space,
  tags,
  onPosted,
}: {
  space: StrongRef;
  tags: SpaceTag[];
  onPosted: () => void;
}) {
  const { agent } = useAtprotoSession();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  const trimmed = title.trim();
  const canSubmit = Boolean(agent) && trimmed.length > 0 && !busy;

  const toggleTag = (value: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      // The lexicon caps a discussion at 8 tags.
      else if (next.size < 8) next.add(value);
      return next;
    });
  };

  const submit = async () => {
    if (!agent || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await createDiscussion(agent as unknown as Agent & { assertDid: string }, {
        space,
        title: trimmed,
        body,
        tags: Array.from(selected),
      });
      setTitle('');
      setBody('');
      setSelected(new Set());
      setPosted(true);
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="fn-fb-card"
    >
      <div className="fn-fb-field">
        <label className="explore-small-caps" htmlFor="feedback-title">
          What&rsquo;s on your mind?
        </label>
        <input
          id="feedback-title"
          className="explore-input"
          value={title}
          maxLength={TITLE_MAX}
          placeholder="A short, specific title"
          onChange={(e) => {
            setTitle(e.target.value);
            setPosted(false);
          }}
        />
      </div>

      <div className="fn-fb-field">
        <label className="explore-small-caps" htmlFor="feedback-body">
          Details <span className="fn-fb-label-aside">(optional)</span>
        </label>
        <textarea
          id="feedback-body"
          className="explore-input explore-textarea"
          value={body}
          rows={4}
          maxLength={BODY_MAX}
          placeholder="What happened, what you expected, or what you'd like to see."
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      {tags.length ? (
        <div className="fn-fb-field">
          <span className="explore-small-caps">Category</span>
          <div className="fn-fb-chips">
            {tags.map((tag) => {
              const active = selected.has(tag.value);
              return (
                <button
                  key={tag.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleTag(tag.value)}
                  className="fn-fb-tagpick"
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? <p className="explore-error">{error}</p> : null}

      <div className="fn-fb-form-foot">
        <span className="fn-fb-hint">
          {posted
            ? 'Posted to your repo. It appears here once the index catches up.'
            : 'Posts as a record in your own repo.'}
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          className="fn-c-btn fn-c-btn-primary"
        >
          {busy ? <Loader2 size={14} className="explore-spin" /> : <Send size={14} />}
          Post feedback
        </button>
      </div>
    </form>
  );
}

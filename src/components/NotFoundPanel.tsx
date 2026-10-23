'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, Leaf, Telescope } from 'lucide-react';
import SearchBox from '@/components/explore/SearchBox';

type Props = {
  /** Small uppercase chip text. Defaults to "404 · NOT FOUND". */
  eyebrow?: string;
  /** Headline. */
  headline?: string;
  /** Body copy under the headline. */
  body?: string;
  /**
   * Optional pre-filled value for the inline explorer SearchBox — useful
   * on resolve-error pages where the visitor is likely about to retry
   * what they just typed.
   */
  initialQuery?: string;
  /**
   * The raw error behind a resolve failure, shown collapsed under
   * "Technical details" (as the record-not-found card does) so the body can
   * say what happened in plain words.
   */
  details?: string | null;
};

/**
 * Shared "we couldn't find what you asked for" panel. Used by the global
 * Next.js not-found route AND by client-side resolve-error states inside
 * the explorer (handle didn't resolve, record didn't load, etc.) so every
 * dead end gets the same recovery affordance: the explorer SearchBox
 * inline, plus Home + Explore buttons.
 */
export default function NotFoundPanel({
  eyebrow = '404 · Not found',
  headline = 'Lost in the Atmosphere.',
  body = 'The path you tried didn’t resolve. Search for a handle, DID, or AT URI to keep looking, or head home.',
  initialQuery,
  details,
}: Props) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      // Constrains text width but lets the parent layout handle the
      // horizontal gutter — the explore routes are already inside a
      // container-narrow with its own side padding, and adding more here
      // doubled the inset. The standalone /not-found route wraps this in its
      // own padded container.
      className="fn-lp-notfound"
    >
      <div className="fn-lp-notfound-eyebrow">
        <Leaf size={12} aria-hidden />
        {eyebrow}
      </div>

      <h1 className="fn-lp-notfound-title">{headline}</h1>

      <p className="fn-lp-notfound-body">{body}</p>

      {details && (
        <details className="explore-section fn-lp-notfound-details">
          <summary>Technical details</summary>
          <p className="explore-error" style={{ marginTop: '0.5rem' }}>
            {details}
          </p>
        </details>
      )}

      <div className="fn-lp-notfound-search">
        <SearchBox initial={initialQuery} />
      </div>

      <div className="fn-lp-notfound-actions">
        <Link href="/" className="fn-lp-btn is-primary">
          <ArrowLeft size={15} aria-hidden /> Home
        </Link>
        <Link href="/explore" className="fn-lp-btn">
          <Telescope size={15} aria-hidden /> Explore
        </Link>
      </div>
    </motion.section>
  );
}

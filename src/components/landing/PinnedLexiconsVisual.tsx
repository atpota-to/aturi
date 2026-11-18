'use client';

import {
  ChevronDown,
  ChevronRight,
  Pin,
} from 'lucide-react';

/**
 * Static mock of the Lexicons tab on /explore/<repo> with the "Pinned"
 * section bubbled up to the top. Shows that the user can drag any
 * lexicon out of the hierarchy so the records they care about (their
 * own custom NSIDs, the lexicon they keep auditing) sit at eye-level.
 */
export default function PinnedLexiconsVisual() {
  return (
    <div className="fl-mock" data-size="s">
      {/* Header: anchors the mock as the Lexicons tab inside a repo page. */}
      <div className="fl-mock-head">
        <span className="fl-mock-head-stack">
          <span className="fl-mock-label">Explore · @aturi.to</span>
          <span className="fl-mock-head-title">Lexicons</span>
        </span>
      </div>

      <div className="fl-mock-body">
        {/* Pinned section, set apart in the accent tint as in the explorer. */}
        <section className="fl-pinned">
          <div className="fl-pinned-head">
            <span className="fl-mock-label" data-accent="">
              <Pin size={11} aria-hidden />
              Pinned
            </span>
            <span className="fl-count">3</span>
          </div>
          <ul>
            <PinnedRow nsid="app.bsky.feed.post" />
            <PinnedRow nsid="net.anisota.identity" />
            <PinnedRow nsid="is.dame.now" />
          </ul>
        </section>

        {/* Regular hierarchical lexicon tree below the pinned section. */}
        <div className="fl-tree">
          <GroupRow prefix="app.bsky" count={14} open />
          <GroupRow prefix="net.anisota" count={5} />
          <GroupRow prefix="is.dame" count={2} />
          <GroupRow prefix="sh.tangled" count={6} />
        </div>
      </div>
    </div>
  );
}

function PinnedRow({ nsid }: { nsid: string }) {
  return (
    <li>
      <Pin size={11} aria-hidden className="fl-pin-icon" />
      <span className="fl-ellipsis">{nsid}</span>
    </li>
  );
}

function GroupRow({
  prefix,
  count,
  open,
}: {
  prefix: string;
  count: number;
  open?: boolean;
}) {
  return (
    <>
      <div className="fl-tree-row" data-open={open ? '' : undefined}>
        <span className="fl-tree-chev" aria-hidden>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="fl-grow">{prefix}</span>
        <span className="fl-tree-count">{count}</span>
      </div>
      {open &&
        ['feed.post', 'feed.like', 'graph.follow'].map((leaf, i) => (
          <div key={leaf} className="fl-tree-row" data-child="" data-active={i === 0 ? '' : undefined}>
            {/* One flex item, so the row's gap doesn't split the NSID. */}
            <span>
              <span className="fl-faint">{prefix}.</span>
              {leaf}
            </span>
          </div>
        ))}
    </>
  );
}

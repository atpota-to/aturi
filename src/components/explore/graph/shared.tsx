'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Minus, Plus, Scan } from 'lucide-react';
import { encodeRepo } from '@/utils/atproto/urls';
import {
  RELATION_ORDER,
  relationOf,
  type GraphPerson,
  type Relation,
  type ThreadPost,
} from '@/lib/socialGraph';
import type { GraphAccount, LinkRecord } from '@/utils/atproto/graphData';

/** What the detail panel beside a drawing is describing. */
export type GraphFocus =
  | { kind: 'subject' }
  | { kind: 'person'; person: GraphPerson | GraphAccount; note?: string }
  | { kind: 'post'; post: ThreadPost }
  | { kind: 'record'; record: LinkRecord; label: string }
  | { kind: 'group'; label: string; count: number | null; note?: string };

export type FocusProps = {
  focus: GraphFocus | null;
  onFocus: (f: GraphFocus) => void;
};

export const isPerson = (p: GraphPerson | GraphAccount): p is GraphPerson => 'following' in p;

export const nameOf = (p: { displayName?: string; handle?: string; did: string }) =>
  p.displayName?.trim() || p.handle || p.did;

export const handleOf = (p: { handle?: string; did: string }) => (p.handle ? `@${p.handle}` : p.did);

/** The account's own handle, as the labels name it. */
export const atName = (p: { handle?: string; did: string }) => (p.handle ? `@${p.handle}` : 'this account');

export function relationColor(r: Relation | 'op'): string {
  return r === 'op' ? 'var(--g-op)' : `var(--g-${r})`;
}

/** The key's short labels, relative to the account at the centre. */
export function relationLabel(r: Relation, subject: string): string {
  switch (r) {
    case 'mutual':
      return 'Mutuals';
    case 'following':
      return `${subject} follows`;
    case 'follower':
      return `Follows ${subject}`;
    case 'second':
      return '2nd degree';
    default:
      return 'No measured link';
  }
}

/** One sentence on where an account sits, relative to the account at the centre. */
export function relationSentence(p: GraphPerson, subject: string): string {
  switch (relationOf(p)) {
    case 'mutual':
      return `Mutual with ${subject}`;
    case 'following':
      return `${subject} follows them; they don’t follow back`;
    case 'follower':
      return `Follows ${subject}; not followed back`;
    case 'second':
      return `2nd degree: ${p.inCommon!.toLocaleString('en-US')} of ${subject}’s follows follow them`;
    default:
      return p.inCommon === 0
        ? `Neither follows the other, and none of ${subject}’s follows do`
        : 'Neither follows the other';
  }
}

export const fmt = (n: number) => n.toLocaleString('en-US');

export function truncate(s: string, max: number): string {
  const flat = String(s || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, Math.max(1, max - 1))}…` : flat;
}

/** Up to `lines` lines of about `perLine` characters, the last one cut short. */
export function wrapLines(s: string, perLine: number, lines: number): string[] {
  const words = String(s || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out: string[] = [];
  let cur = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i];
    if (next.length > perLine && cur) {
      out.push(cur);
      cur = words[i];
      if (out.length === lines) break;
    } else {
      cur = next;
    }
  }
  if (out.length < lines && cur) {
    out.push(cur);
    i = words.length;
  }
  if (i < words.length || out[out.length - 1]?.length > perLine) {
    out[out.length - 1] = truncate(`${out[out.length - 1]} …`, perLine);
  }
  return out;
}

export function thumb(url?: string): string | undefined {
  return url?.replace('/img/avatar/', '/img/avatar_thumbnail/');
}

/** An avatar in an SVG drawing: a clipped image, or the first letter. */
export function Face({
  x,
  y,
  r,
  avatar,
  name,
  ring,
}: {
  x: number;
  y: number;
  r: number;
  avatar?: string;
  name: string;
  ring?: string;
}) {
  return (
    <>
      {avatar ? (
        <image
          href={thumb(avatar)}
          x={x - r}
          y={y - r}
          width={2 * r}
          height={2 * r}
          clipPath="url(#fx-graph-circle)"
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <>
          <circle cx={x} cy={y} r={r} className="fx-graph-face-blank" />
          <text x={x} y={y + r * 0.36} textAnchor="middle" className="fx-graph-face-letter" fontSize={r}>
            {name.replace(/^@/, '').slice(0, 1).toUpperCase()}
          </text>
        </>
      )}
      {ring && <circle cx={x} cy={y} r={r + 1.5} fill="none" stroke={ring} strokeWidth={2.5} />}
    </>
  );
}

/** The circle every avatar in a drawing is clipped to. Once per <svg>. */
export function GraphDefs() {
  return (
    <defs>
      <clipPath id="fx-graph-circle" clipPathUnits="objectBoundingBox">
        <circle cx={0.5} cy={0.5} r={0.5} />
      </clipPath>
    </defs>
  );
}

/**
 * Props that make a mark in a drawing describe itself in the detail panel
 * when pointed at, focused or clicked, and act on click or Enter.
 */
export function markProps(onShow: () => void, onActivate?: () => void, tabbable = true) {
  return {
    tabIndex: tabbable ? 0 : -1,
    onMouseEnter: onShow,
    onFocus: onShow,
    onClick: () => {
      onShow();
      onActivate?.();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onShow();
        onActivate?.();
      }
    },
  };
}

/** The element's content width, kept current. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const ZOOMS = [1, 1.5, 2, 3, 4];

/**
 * A drawing drawn to fit, with zoom buttons. Zooming widens the drawing and
 * the box scrolls natively, so a phone pans with a finger and a trackpad with
 * two, with no pan code of our own, and the page around it still scrolls.
 */
export function ZoomBox({
  label,
  maxWidth,
  aspect,
  children,
  tools,
}: {
  label: string;
  /** The drawing's widest at 1×, in CSS pixels. */
  maxWidth: number;
  /** Height over width. */
  aspect: number;
  children: ReactNode;
  tools?: ReactNode;
}) {
  const [level, setLevel] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const zoom = ZOOMS[level];
  const go = (next: number) => {
    const box = boxRef.current;
    const clamped = Math.max(0, Math.min(ZOOMS.length - 1, next));
    if (box) {
      // Keep the middle of what's on screen in the middle.
      const k = ZOOMS[clamped] / zoom;
      const cx = box.scrollLeft + box.clientWidth / 2;
      const cy = box.scrollTop + box.clientHeight / 2;
      requestAnimationFrame(() => {
        box.scrollLeft = cx * k - box.clientWidth / 2;
        box.scrollTop = cy * k - box.clientHeight / 2;
      });
    }
    setLevel(clamped);
  };
  return (
    <div className="fx-graph-zoom">
      <div className="fx-graph-tools">
        {tools}
        <span className="fx-graph-tools-zoom">
          <button type="button" className="fx-graph-tool" onClick={() => go(level - 1)} disabled={level === 0} aria-label="Zoom out">
            <Minus size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="fx-graph-tool"
            onClick={() => go(level + 1)}
            disabled={level === ZOOMS.length - 1}
            aria-label="Zoom in"
          >
            <Plus size={14} aria-hidden />
          </button>
          <button type="button" className="fx-graph-tool" onClick={() => go(0)} disabled={level === 0}>
            <Scan size={14} aria-hidden />
            Fit
          </button>
        </span>
      </div>
      <div ref={boxRef} className="fx-graph-scroll" role="group" aria-label={label}>
        <div className="fx-graph-sheet" style={{ width: `calc(min(100%, ${maxWidth}px) * ${zoom})`, aspectRatio: `1 / ${aspect}` }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Legend({ keys, subject, op }: { keys?: readonly Relation[]; subject: string; op?: boolean }) {
  return (
    <ul className="fx-graph-legend" aria-label="Key">
      {op && (
        <li>
          <span className="fx-graph-swatch" style={{ background: relationColor('op') }} aria-hidden />
          {subject}
        </li>
      )}
      {(keys ?? RELATION_ORDER).map((r) => (
        <li key={r}>
          <span className="fx-graph-swatch" style={{ background: relationColor(r) }} aria-hidden />
          {relationLabel(r, subject)}
        </li>
      ))}
    </ul>
  );
}

function explorePath(p: { handle?: string; did: string }) {
  return `/explore/${encodeRepo(p.handle || p.did)}`;
}

export function postPath(post: { uri: string }) {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(post.uri);
  return m ? `/explore/${encodeRepo(m[1])}/${m[2]}/${m[3]}` : null;
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Avatar({ src, name }: { src?: string; name: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="fx-graph-avatar" src={thumb(src)} alt="" loading="lazy" />
  ) : (
    <span className="fx-graph-avatar fx-graph-avatar-blank" aria-hidden>
      {name.replace(/^@/, '').slice(0, 1).toUpperCase()}
    </span>
  );
}

function kindsText(kinds: GraphPerson['inKinds']): string {
  return Object.entries(kinds)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([k, n]) => `${n} ${k === 'reply' ? (n === 1 ? 'reply' : 'replies') : n === 1 ? k : `${k}s`}`)
    .join(', ');
}

/**
 * The detail panel: who or what the pointer, finger or focus is on, in
 * words, with the ways onward from it. A drawing says where things sit; this
 * says what they are, for anyone the drawing alone doesn't serve.
 */
export function GraphDetail({
  focus,
  subject,
  subjectName,
  relationFor,
  emptyText,
}: {
  focus: GraphFocus | null;
  subject: { did: string; handle?: string; displayName?: string; avatar?: string; followsCount?: number; followersCount?: number };
  subjectName: string;
  /** The relation sentence for an account that isn't a full GraphPerson (thread authors, flow cards). */
  relationFor?: (did: string) => string | null;
  emptyText: string;
}) {
  let body: ReactNode;
  if (!focus) {
    body = <p className="fx-graph-detail-empty">{emptyText}</p>;
  } else if (focus.kind === 'subject') {
    body = (
      <>
        <div className="fx-graph-who">
          <Avatar src={subject.avatar} name={nameOf(subject)} />
          <div className="fx-graph-names">
            <span className="fx-graph-dn">{nameOf(subject)}</span>
            <span className="fx-graph-hd">{handleOf(subject)}</span>
          </div>
        </div>
        {(subject.followsCount != null || subject.followersCount != null) && (
          <dl className="fx-graph-facts">
            <Fact k="Follows" v={fmt(subject.followsCount ?? 0)} />
            <Fact k="Followers" v={fmt(subject.followersCount ?? 0)} />
          </dl>
        )}
      </>
    );
  } else if (focus.kind === 'group') {
    body = (
      <>
        <span className="fx-graph-dn">{focus.label}</span>
        <p className="fx-graph-detail-text">
          {focus.count == null ? 'Loads when opened.' : `${fmt(focus.count)} ${focus.count === 1 ? 'account' : 'accounts'}.`}
          {focus.note ? ` ${focus.note}` : ''}
        </p>
      </>
    );
  } else if (focus.kind === 'person') {
    const p = focus.person;
    const full = isPerson(p) ? p : null;
    const sentence = full ? relationSentence(full, subjectName) : (relationFor?.(p.did) ?? null);
    body = (
      <>
        <div className="fx-graph-who">
          <Avatar src={p.avatar} name={nameOf(p)} />
          <div className="fx-graph-names">
            <span className="fx-graph-dn">{nameOf(p)}</span>
            <span className="fx-graph-hd">{handleOf(p)}</span>
          </div>
        </div>
        {sentence && (
          <p className="fx-graph-rel">
            {full && <span className="fx-graph-swatch" style={{ background: relationColor(relationOf(full)) }} aria-hidden />}
            {sentence}
          </p>
        )}
        {focus.note && <p className="fx-graph-detail-text">{focus.note}</p>}
        {full && (
          <>
            <dl className="fx-graph-facts">
              <Fact k="To them" v={fmt(full.in)} />
              <Fact k="From them" v={fmt(full.out)} />
            </dl>
            {(full.in > 0 || full.out > 0) && (
              <p className="fx-graph-detail-text">
                {[
                  full.in ? `${nameOf(full)} gave ${kindsText(full.inKinds)}.` : '',
                  full.out ? `${subjectName} gave ${kindsText(full.outKinds)}.` : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              </p>
            )}
          </>
        )}
        <p className="fx-graph-links">
          <Link href={`${explorePath(p)}?tab=graph`} prefetch={false}>
            Their graph
          </Link>
          <Link href={explorePath(p)} prefetch={false}>
            Their repo
          </Link>
        </p>
      </>
    );
  } else if (focus.kind === 'record') {
    const { record, label } = focus;
    const who = record.author ?? { did: record.did };
    body = (
      <>
        <div className="fx-graph-who">
          <Avatar src={who.avatar} name={nameOf(who)} />
          <div className="fx-graph-names">
            <span className="fx-graph-dn">{nameOf(who)}</span>
            <span className="fx-graph-hd">{handleOf(who)}</span>
          </div>
        </div>
        <p className="fx-graph-detail-text">A {label} record linking here.</p>
        <p className="fx-graph-hd">{record.collection}</p>
        <p className="fx-graph-links">
          <Link href={`/explore/${encodeRepo(record.did)}/${record.collection}/${encodeURIComponent(record.rkey)}`} prefetch={false}>
            Open this record
          </Link>
        </p>
      </>
    );
  } else {
    const post = focus.post;
    const href = postPath(post);
    const sentence = relationFor?.(post.did) ?? null;
    body = (
      <>
        <div className="fx-graph-who">
          <Avatar src={post.avatar} name={post.displayName || post.handle || post.did} />
          <div className="fx-graph-names">
            <span className="fx-graph-dn">{post.displayName || post.handle || post.did}</span>
            <span className="fx-graph-hd">{post.handle ? `@${post.handle}` : post.did}</span>
          </div>
        </div>
        <p className="fx-graph-post-text">{post.text || (post.hasMedia ? 'An image or video, no text.' : 'No text.')}</p>
        {sentence && <p className="fx-graph-rel">{sentence}</p>}
        <dl className="fx-graph-facts">
          <Fact k="Likes" v={fmt(post.likes)} />
          <Fact k="Reposts" v={fmt(post.reposts)} />
          <Fact k="Under it" v={fmt(post.size - 1)} />
        </dl>
        {href && (
          <p className="fx-graph-links">
            <Link href={href} prefetch={false}>
              Open this post
            </Link>
          </p>
        )}
      </>
    );
  }
  return (
    <aside className="fx-graph-detail" aria-live="polite" aria-label="Details">
      {body}
    </aside>
  );
}

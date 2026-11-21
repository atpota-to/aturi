'use client';

import { useMemo } from 'react';
import {
  GOLDEN_ANGLE,
  ORBIT_RINGS,
  engagementOf,
  flattenThread,
  hashUnit,
  orbitRadius,
  radialLayout,
  relationOf,
  type GraphPerson,
  type ThreadPost,
} from '@/lib/socialGraph';
import type { Neighbourhood } from '@/utils/atproto/graphData';
import { Face, GraphDefs, ZoomBox, atName, fmt, markProps, nameOf, relationColor, truncate, type FocusProps } from './shared';

const R = 480;

/**
 * Accounts on the rim with less engagement than this aren't drawn. A popular
 * post's likers would otherwise put a thousand single-like dots on one ring,
 * where they hide each other and say nothing anyone could act on.
 */
const RIM_MIN_ENGAGEMENT = 2;

/** Dots past this many, by engagement, are reachable by pointer but not by Tab. */
const TABBABLE = 60;

/** A thread draws itself outward from its first post, a level at a time. */
const depthDelay = (depth: number) => Math.min(900, depth * 110);

const dotSize = (p: GraphPerson) => {
  const w = engagementOf(p);
  return w ? Math.min(24, 5 + Math.sqrt(w) * 2.2) : 4;
};

/**
 * The orbit from the dame.is Graph tab: the account at the centre, mutuals on
 * the inner ring, one-way follows outside it, 2nd degree across the middle
 * (more follows in common, closer) and the rest on the rim. Dot size is
 * engagement either way over the window.
 *
 * The loader hands accounts over only once their relation is known, in an
 * order that only grows at the end, so each dot is given its angle by its
 * place in that order (the golden-angle step, which spreads any run of them
 * evenly) and its ring by its relation, and arrives where it stays. Nothing
 * re-spreads when the read finishes. The 2nd-degree scale is fixed by the
 * number of follows rather than the largest count so far, so a new count
 * never moves the others. Dots stay in arrival order in the DOM, never
 * re-sorted: moving an element would restart its arrival.
 */
export function OrbitAccount({ data, focus, onFocus, onSelect }: { data: Neighbourhood } & FocusProps) {
  const { placed, hidden } = useMemo(() => {
    const angle = new Map(data.people.map((p, i) => [p.did, (i * GOLDEN_ANGLE) % (Math.PI * 2)]));
    const drawn = data.people.filter((p) => relationOf(p) !== 'further' || engagementOf(p) >= RIM_MIN_ENGAGEMENT);
    const maxInCommon = Math.max(2, data.follows.length);
    const tabbable = new Set(
      [...drawn]
        .sort((a, b) => engagementOf(b) - engagementOf(a))
        .slice(0, TABBABLE)
        .map((p) => p.did),
    );
    return {
      hidden: data.people.length - drawn.length,
      placed: drawn
        .map((p) => {
          const r = orbitRadius(p, maxInCommon) * R;
          const a = angle.get(p.did) ?? 0;
          return { p, x: Math.cos(a) * r, y: Math.sin(a) * r, size: dotSize(p), tab: tabbable.has(p.did) };
        }),
    };
  }, [data.people, data.follows.length]);

  const focused = focus?.kind === 'person' ? focus.person.did : null;
  const subject = data.subject;

  return (
    <>
      <ZoomBox label="Orbit of the accounts around this one" maxWidth={680} aspect={1}>
        <svg viewBox={`${-R - 30} ${-R - 30} ${2 * R + 60} ${2 * R + 60}`} className="fx-graph-svg">
          <GraphDefs />
          {[ORBIT_RINGS.mutual, ORBIT_RINGS.following, ORBIT_RINGS.follower, 0.7, ORBIT_RINGS.further].map((f) => (
            <circle key={f} r={f * R} className="fx-graph-ring" />
          ))}
          {placed.map(({ p, x, y, size, tab }) => (
            // Placed by a CSS transform rather than cx/cy, so a ring change
            // animates in every browser; the circle inside does the arrival.
            <g key={p.did} className="fx-graph-place" style={{ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` }}>
              <circle
                r={size}
                className="fx-graph-dot fx-graph-arrive"
                style={{ animationDelay: `${Math.round(hashUnit(`${p.did}:in`) * 240)}ms` }}
                data-focus={focused === p.did || undefined}
                fill={relationColor(relationOf(p))}
                fillOpacity={engagementOf(p) ? 0.9 : 0.5}
                role="img"
                aria-label={`${nameOf(p)}: ${fmt(p.in)} to ${atName(subject)}, ${fmt(p.out)} from ${atName(subject)}`}
                {...markProps(
                  () => onFocus({ kind: 'person', person: p }),
                  onSelect && (() => onSelect({ kind: 'person', person: p })),
                  tab,
                )}
              />
            </g>
          ))}
          <g
            className="fx-graph-mark"
            role="img"
            aria-label={nameOf(subject)}
            {...markProps(() => onFocus(null), onSelect && (() => onSelect(null)))}
          >
            <Face x={0} y={0} r={28} avatar={subject.avatar} name={nameOf(subject)} ring="var(--text-primary)" />
          </g>
          <text x={0} y={-0.7 * R - 10} textAnchor="middle" className="fx-graph-ring-label">
            2nd degree
          </text>
          <text x={0} y={-ORBIT_RINGS.further * R - 10} textAnchor="middle" className="fx-graph-ring-label">
            no measured link
          </text>
        </svg>
      </ZoomBox>
      <p className="fx-graph-caption">
        Mutuals on the inner ring, then accounts followed one way, then followers one way. 2nd degree sits across
        the middle, closer the more follows in common, and the rest on the rim. Dot size is engagement either way
        over 30 days.
        {hidden > 0 &&
          ` ${fmt(hidden)} ${hidden === 1 ? 'account' : 'accounts'} with no link and a single interaction aren’t drawn.`}
      </p>
    </>
  );
}

/**
 * A thread as a radial tree: the first post at the centre, one ring per reply
 * depth, branches given room by how many posts they end in. Dot size is
 * likes; colour is each author's relation to the first poster.
 */
export function OrbitThread({
  root,
  current,
  relationOfAuthor,
  focus,
  onFocus,
  onSelect,
}: {
  root: ThreadPost;
  current: string;
  relationOfAuthor: (did: string) => ReturnType<typeof relationOf> | 'op';
} & FocusProps) {
  const radius = 460;
  const { pos, maxDepth, posts } = useMemo(() => {
    const layout = radialLayout(root, radius);
    return { ...layout, posts: flattenThread(root).sort((a, b) => b.likes - a.likes) };
  }, [root]);
  const focused = focus?.kind === 'post' ? focus.post.uri : null;
  return (
    <>
      <ZoomBox label="Radial tree of the thread" maxWidth={680} aspect={1}>
        <svg viewBox={`${-radius - 40} ${-radius - 40} ${2 * radius + 80} ${2 * radius + 80}`} className="fx-graph-svg">
          <GraphDefs />
          {Array.from({ length: maxDepth }, (_, i) => (
            <circle key={i} r={((i + 1) / maxDepth) * radius} className="fx-graph-ring" />
          ))}
          {posts.map((p) => {
            if (!p.parent) return null;
            const a = pos.get(p.parent);
            const b = pos.get(p.uri);
            return a && b ? (
              <line
                key={`l${p.uri}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className="fx-graph-edge fx-graph-fade"
                style={{ animationDelay: `${depthDelay(p.depth)}ms` }}
              />
            ) : null;
          })}
          {posts.map((p, i) => {
            const q = pos.get(p.uri)!;
            const isRoot = p === root;
            const r = isRoot ? 24 : Math.min(18, 4 + Math.sqrt(p.likes) * 1.6);
            const show = () => onFocus({ kind: 'post', post: p });
            const pick = onSelect && (() => onSelect({ kind: 'post', post: p }));
            const label = `${p.displayName || p.handle}: ${truncate(p.text, 80) || 'no text'}`;
            return isRoot ? (
              <g key={p.uri} className="fx-graph-mark fx-graph-arrive" role="img" aria-label={label} {...markProps(show, pick)}>
                <Face x={q.x} y={q.y} r={r} avatar={p.avatar} name={p.handle || p.did} ring={relationColor('op')} />
              </g>
            ) : (
              <circle
                key={p.uri}
                cx={q.x}
                cy={q.y}
                r={r}
                className="fx-graph-dot fx-graph-arrive"
                style={{ animationDelay: `${depthDelay(p.depth)}ms` }}
                data-focus={focused === p.uri || undefined}
                data-current={current === p.uri || undefined}
                fill={relationColor(relationOfAuthor(p.did))}
                role="img"
                aria-label={label}
                {...markProps(show, pick, i < TABBABLE)}
              />
            );
          })}
          <text x={0} y={-radius - 14} textAnchor="middle" className="fx-graph-ring-label">
            each ring one reply deeper
          </text>
        </svg>
      </ZoomBox>
      <p className="fx-graph-caption">
        The first post at the centre, each ring one reply deeper, {maxDepth} deep at most. Dot size is likes.
      </p>
    </>
  );
}

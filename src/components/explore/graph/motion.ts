'use client';

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/* ------------------------------------------------------------------ */
/* Motion for the tree drawings                                         */
/* ------------------------------------------------------------------ */

/**
 * The thread explorer and both flow charts draw a tree of cards that grows
 * and shrinks as branches open and close. Without help every change is a
 * jump: new cards appear in place, closed ones vanish, and everything below
 * an opened branch snaps down to make room.
 *
 * `useTreeMotion` takes the cards where the layout wants them and gives
 * back what to draw:
 *
 * - a card that arrives grows out of the card it hangs off, sliding out
 *   from that card's middle and fading in, a few milliseconds after the
 *   sibling above it;
 * - a card that goes is kept on screen a moment longer while it folds back
 *   into the nearest card that stays, then dropped;
 * - a card that moves glides there, and its edges bend to follow.
 *
 * It also lets a mouse or pen drag a card a little out of the way. A card
 * carries everything that hangs off it, so a branch opened later grows out
 * of wherever its parent was put. Touch keeps scrolling the canvas, since
 * cards cover most of it.
 *
 * The tweening runs outside React: an engine writes each card's
 * `transform` and each edge's `d` straight to the DOM a frame at a time,
 * then leaves them at the values React rendered. That works the same in
 * every browser, where CSS can transition a `transform` but Safari can't
 * transition an SVG path's `d`. Anyone who asked for less motion gets the
 * end state at once.
 */

export type MotionNode<T> = {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * The card this one hangs off, if that card is drawn: where it grows out
   * of and folds back into, where its edge starts, and what drags it along.
   */
  parent: string | null;
  /** False for a card drawn without an edge to its parent. */
  edge?: boolean;
  /** Whatever the caller needs to draw the card, kept while it folds away. */
  data: T;
};

export type MotionItem<T> = MotionNode<T> & {
  /** On its way out: drawn, but not to be pointed at or read aloud. */
  leaving: boolean;
};

type Offset = { dx: number; dy: number };
type Leaving<T> = MotionNode<T> & { last: { x: number; y: number }; gen: number };
type Mem<T> = {
  sig: string;
  nodes: Map<string, MotionNode<T>>;
  leaving: Map<string, Leaving<T>>;
  /** The order cards were last drawn in, leaving ones included. */
  order: string[];
  gen: number;
};

/** How far a card slides sideways as it grows out of its parent or folds back in. */
const SLIDE = 24;
const ENTER_MS = 380;
const MOVE_MS = 380;
const LEAVE_MS = 240;
/** A press travels this far, in screen pixels, before it drags rather than clicks. */
const DRAG_FROM = 4;
const ZERO: Offset = { dx: 0, dy: 0 };

const round = (n: number) => Math.round(n * 10) / 10;
const ease = (t: number) => 1 - (1 - t) ** 3;
const translate = (x: number, y: number) => `translate(${round(x)} ${round(y)})`;

/** A tree edge: out of the right of one card, into the left of the next. */
export function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = round((x1 + x2) / 2);
  return `M${round(x1)},${round(y1)} C${mx},${round(y1)} ${mx},${round(y2)} ${round(x2)},${round(y2)}`;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Each card moved by its own drag plus every drag above it. */
function applyOffsets<T>(input: readonly MotionNode<T>[], offsets: ReadonlyMap<string, Offset>): readonly MotionNode<T>[] {
  if (!offsets.size) return input;
  const byKey = new Map(input.map((n) => [n.key, n]));
  const totals = new Map<string, Offset>();
  const totalOf = (key: string, depth: number): Offset => {
    const done = totals.get(key);
    if (done) return done;
    const parent = byKey.get(key)?.parent;
    const up = parent && byKey.has(parent) && depth < 500 ? totalOf(parent, depth + 1) : ZERO;
    const own = offsets.get(key);
    const total = own ? { dx: up.dx + own.dx, dy: up.dy + own.dy } : up;
    totals.set(key, total);
    return total;
  };
  return input.map((n) => {
    const t = totalOf(n.key, 0);
    return t.dx || t.dy ? { ...n, x: n.x + t.dx, y: n.y + t.dy } : n;
  });
}

function startMem<T>(nodes: readonly MotionNode<T>[], sig: string): Mem<T> {
  return { sig, nodes: new Map(nodes.map((n) => [n.key, n])), leaving: new Map(), order: nodes.map((n) => n.key), gen: 0 };
}

/**
 * The next set of cards to draw: the new layout, plus every card that just
 * went (and those still going), each aimed at the nearest card that stays.
 */
function advance<T>(mem: Mem<T>, nodes: readonly MotionNode<T>[], sig: string): Mem<T> {
  const now = new Map(nodes.map((n) => [n.key, n]));
  const gen = mem.gen + 1;
  const leaving = new Map<string, Leaving<T>>();
  for (const [k, l] of mem.leaving) if (!now.has(k)) leaving.set(k, l);
  const anchorOf = (key: string | null): MotionNode<T> | null => {
    for (let k = key, guard = 0; k && guard < 500; guard++) {
      const hit = now.get(k);
      if (hit) return hit;
      k = (mem.nodes.get(k) ?? mem.leaving.get(k))?.parent ?? null;
    }
    return null;
  };
  for (const [k, n] of mem.nodes) {
    if (now.has(k)) continue;
    const a = anchorOf(n.parent);
    leaving.set(k, {
      ...n,
      x: n.x - SLIDE,
      y: a ? a.y + a.h / 2 - n.h / 2 : n.y,
      last: { x: n.x, y: n.y },
      gen,
    });
  }
  // Keep every card that was already drawn in the same order relative to
  // the others, so none jumps in front of or behind its neighbours and React
  // doesn't move elements (which drops focus), with each leaving card just
  // after the last staying card before it.
  const after = new Map<string | null, string[]>();
  let lastKept: string | null = null;
  for (const k of mem.order) {
    if (now.has(k)) lastKept = k;
    else if (leaving.has(k)) after.set(lastKept, [...(after.get(lastKept) ?? []), k]);
  }
  const order = [...(after.get(null) ?? [])];
  for (const n of nodes) order.push(n.key, ...(after.get(n.key) ?? []));
  return { sig, nodes: now, leaving, order, gen };
}

function dropLeaving<T>(mem: Mem<T>, upTo: number): Mem<T> {
  const leaving = new Map([...mem.leaving].filter(([, l]) => l.gen > upTo));
  if (leaving.size === mem.leaving.size) return mem;
  return { ...mem, leaving, order: mem.order.filter((k) => mem.nodes.has(k) || leaving.has(k)) };
}

/* ---------------- the engine: frames, outside React ---------------- */

type Pose = { x: number; y: number; o: number };
type Track = {
  cur: Pose;
  to: Pose;
  w: number;
  h: number;
  parent: string | null;
  tween: { from: Pose; start: number; dur: number } | null;
};

class Engine {
  private tracks = new Map<string, Track>();
  private nodeEls = new Map<string, SVGGElement>();
  private edgeEls = new Map<string, SVGPathElement>();
  private raf = 0;

  /** After each render: aim every card at where React just drew it. */
  sync(root: SVGGElement, items: readonly MotionItem<unknown>[], instant: boolean) {
    this.nodeEls.clear();
    this.edgeEls.clear();
    root.querySelectorAll<SVGGElement>('[data-mnode]').forEach((el) => this.nodeEls.set(el.dataset.mnode!, el));
    root.querySelectorAll<SVGPathElement>('[data-medge]').forEach((el) => this.edgeEls.set(el.dataset.medge!, el));

    const now = performance.now();
    const byKey = new Map(items.map((it) => [it.key, it]));
    const known = new Set(this.tracks.keys());
    const firstPaint = known.size === 0;
    const fanned = new Map<string, number>();
    const touched = new Set<string>();

    for (const it of items) {
      const to: Pose = { x: it.x, y: it.y, o: it.leaving ? 0 : 1 };
      const t = this.tracks.get(it.key);
      if (t) {
        t.w = it.w;
        t.h = it.h;
        t.parent = it.parent;
        if (t.to.x === to.x && t.to.y === to.y && t.to.o === to.o) continue;
        t.to = to;
        t.tween = instant ? null : { from: t.cur, start: now, dur: it.leaving ? LEAVE_MS : MOVE_MS };
        if (instant) t.cur = to;
        touched.add(it.key);
        continue;
      }
      touched.add(it.key);
      if (instant || it.leaving) {
        this.tracks.set(it.key, { cur: to, to, w: it.w, h: it.h, parent: it.parent, tween: null });
        continue;
      }
      // Grow out of the nearest card that was already there.
      let anchorKey: string | null = null;
      let depth = 0;
      for (let k = it.parent; k; k = byKey.get(k)?.parent ?? null) {
        depth += 1;
        if (known.has(k)) {
          anchorKey = k;
          break;
        }
        if (depth > 500) break;
      }
      const anchor = anchorKey ? this.tracks.get(anchorKey) : undefined;
      let from: Pose;
      let delay: number;
      if (anchor && anchorKey) {
        const i = fanned.get(anchorKey) ?? 0;
        fanned.set(anchorKey, i + 1);
        from = { x: it.x - SLIDE, y: anchor.to.y + anchor.h / 2 - it.h / 2, o: 0 };
        delay = Math.min(i, 10) * 16 + (depth - 1) * 40;
      } else {
        // The first drawing fills in a column at a time.
        from = { x: it.x - SLIDE / 2, y: it.y, o: 0 };
        delay = firstPaint ? Math.min(depth, 12) * 45 : 0;
      }
      this.tracks.set(it.key, {
        cur: from,
        to,
        w: it.w,
        h: it.h,
        parent: it.parent,
        tween: { from, start: now + delay, dur: ENTER_MS },
      });
    }
    for (const k of known) if (!byKey.has(k)) this.tracks.delete(k);

    const live = this.frame(now, touched);
    if (live && !this.raf) this.raf = requestAnimationFrame(this.step);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private step = (now: number) => {
    this.raf = 0;
    if (this.frame(now, new Set())) this.raf = requestAnimationFrame(this.step);
  };

  /** Writes every card in flight, and the edges at either end of one. Returns whether any are still moving. */
  private frame(now: number, touched: Set<string>): boolean {
    let live = false;
    for (const [key, t] of this.tracks) {
      if (!t.tween) continue;
      touched.add(key);
      const { from, start, dur } = t.tween;
      const p = (now - start) / dur;
      if (p >= 1) {
        t.cur = t.to;
        t.tween = null;
      } else {
        const e = ease(Math.max(0, p));
        t.cur = {
          x: from.x + (t.to.x - from.x) * e,
          y: from.y + (t.to.y - from.y) * e,
          o: from.o + (t.to.o - from.o) * e,
        };
        live = true;
      }
      const el = this.nodeEls.get(key);
      if (el) {
        el.setAttribute('transform', translate(t.cur.x, t.cur.y));
        el.style.opacity = t.cur.o < 1 ? String(Math.round(t.cur.o * 100) / 100) : '';
      }
    }
    if (touched.size) {
      for (const [key, el] of this.edgeEls) {
        const c = this.tracks.get(key);
        if (!c?.parent || (!touched.has(key) && !touched.has(c.parent))) continue;
        const p = this.tracks.get(c.parent);
        if (!p) continue;
        el.setAttribute('d', edgePath(p.cur.x + p.w, p.cur.y + p.h / 2, c.cur.x, c.cur.y + c.h / 2));
        el.style.opacity = c.cur.o < 1 ? String(Math.round(c.cur.o * 100) / 100) : '';
      }
    }
    return live;
  }
}

/* ---------------- the hook ---------------- */

/**
 * `scale` is the drawing's zoom, so a drag moves a card as far as the
 * pointer went on screen.
 */
export function useTreeMotion<T>(input: readonly MotionNode<T>[], scale = 1) {
  const [offsets, setOffsets] = useState<ReadonlyMap<string, Offset>>(() => new Map());
  const [dragging, setDragging] = useState<string | null>(null);
  /** The card dragged last: it and its branch draw over the rest, so it never drops behind a card it was put on. */
  const [lifted, setLifted] = useState<string | null>(null);

  const nodes = applyOffsets(input, offsets);
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const sig = nodes.map((n) => `${n.key}@${round(n.x)},${round(n.y)},${n.w},${n.h}`).join('|');

  // When the cards change, work out which just went, in this render.
  const [mem, setMem] = useState<Mem<T>>(() => startMem(nodes, sig));
  let shown = mem;
  if (mem.sig !== sig) {
    shown = advance(mem, nodes, sig);
    setMem(shown);
  }

  // Cards that went are dropped once they've folded away.
  useEffect(() => {
    if (!mem.leaving.size) return undefined;
    const upTo = mem.gen;
    const t = window.setTimeout(() => setMem((m) => dropLeaving(m, upTo)), reducedMotion() ? 0 : LEAVE_MS + 40);
    return () => window.clearTimeout(t);
  }, [mem]);

  const kids = new Map<string, string[]>();
  for (const n of nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.key]);
  const branchOf = (key: string): string[] => {
    const out = [key];
    for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) ?? []));
    return out;
  };

  const items: MotionItem<T>[] = [];
  for (const k of shown.order) {
    const n = byKey.get(k);
    if (n) items.push({ ...n, leaving: false });
    else {
      const l = shown.leaving.get(k);
      if (l) items.push({ ...l, leaving: true });
    }
  }
  if (lifted && byKey.has(lifted)) {
    const top = new Set(branchOf(lifted));
    items.sort((a, b) => Number(top.has(a.key)) - Number(top.has(b.key)));
  }

  const rootRef = useRef<SVGGElement>(null);
  const engine = useRef<Engine | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    engine.current ??= new Engine();
    engine.current.sync(root, items, dragging != null || reducedMotion());
  });
  useEffect(() => () => engine.current?.stop(), []);

  let right = 0;
  let bottom = 0;
  for (const n of nodes) {
    right = Math.max(right, n.x + n.w);
    bottom = Math.max(bottom, n.y + n.h);
  }
  // Until a closed branch has folded away, the drawing keeps room for it.
  for (const l of shown.leaving.values()) {
    right = Math.max(right, l.last.x + l.w);
    bottom = Math.max(bottom, l.last.y + l.h);
  }

  const grab = (e: ReactPointerEvent<SVGGElement>) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const key = e.currentTarget.dataset.mnode;
    const me = key ? byKey.get(key) : undefined;
    if (!key || !me) return;
    // The branch moves as one, and stops at the drawing's top and left edges.
    const branch = branchOf(key);
    let minX = me.x;
    let minY = me.y;
    for (const k of branch) {
      const n = byKey.get(k);
      if (n) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
      }
    }
    const base = offsets.get(key) ?? ZERO;
    const { pointerId, clientX: x0, clientY: y0 } = e;
    let live = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const sx = ev.clientX - x0;
      const sy = ev.clientY - y0;
      if (!live) {
        if (Math.hypot(sx, sy) < DRAG_FROM) return;
        live = true;
        setDragging(key);
        setLifted(key);
      }
      const dx = Math.max(sx / scale, Math.min(0, -minX));
      const dy = Math.max(sy / scale, Math.min(0, -minY));
      setOffsets((m) => new Map(m).set(key, { dx: base.dx + dx, dy: base.dy + dy }));
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!live) return;
      setDragging(null);
      // The press that ended a drag isn't also a click on the card.
      const swallow = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const posOf = (k: string): MotionNode<T> | undefined => byKey.get(k) ?? shown.leaving.get(k);

  return {
    items,
    /** Where a card is now, after any drags. */
    place: (key: string): MotionNode<T> | undefined => byKey.get(key),
    /** The drawing's right and bottom edges, after drags and while a branch folds. */
    bounds: { right, bottom },
    /** Some card has been dragged. */
    moved: offsets.size > 0,
    /** Puts every dragged card back. */
    tidy: () => {
      setOffsets(new Map());
      setLifted(null);
    },
    /** Props for the `<g>` holding every edge and card. */
    rootProps: { ref: rootRef, 'data-moving': dragging ? '' : undefined },
    /** Props for a card's `<g>`; draw the card at 0,0 inside it. */
    nodeProps: (it: MotionItem<T>) => ({
      'data-mnode': it.key,
      'data-lifted': dragging === it.key ? '' : undefined,
      'data-leaving': it.leaving ? '' : undefined,
      'aria-hidden': it.leaving || undefined,
      transform: translate(it.x, it.y),
      onPointerDown: it.leaving ? undefined : grab,
    }),
    /** Props for the `<path>` from a card's parent to it, or null when it has none. */
    edgeProps: (it: MotionItem<T>) => {
      if (!it.parent || it.edge === false) return null;
      const p = posOf(it.parent);
      if (!p) return null;
      return { 'data-medge': it.key, d: edgePath(p.x + p.w, p.y + p.h / 2, it.x, it.y + it.h / 2) };
    },
  };
}

'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link2 } from 'lucide-react';
import { getWaypointsForType, getWaypointCount, type Waypoint } from '@/utils/waypoints';
import {
  getReduceMotionServerSnapshot,
  getReduceMotionSnapshot,
  subscribeReduceMotion,
} from '@/lib/a11y';

type Props = {
  handle: string;
  did?: string;
};

// The chip row's highlight hops every HIGHLIGHT_INTERVAL_MS; one of the
// three rows below swaps for the next waypoint every ROTATE_INTERVAL_MS.
const CHIP_IDS = ['anisota', 'bluesky', 'leaflet', 'deer', 'tangled', 'grain'];
const HIGHLIGHT_INTERVAL_MS = 1100;
const ROTATE_INTERVAL_MS = 2400;
const VISIBLE_SLOTS = 3;

/**
 * Hero visual for /links: an aturi.to link and the picker it opens.
 * Decorative and non-interactive (the real picker is one CTA away): a
 * highlight hops along a row of clients, and the three rows below
 * quietly rotate through the catalog so the breadth of supported
 * clients shows without rendering all of them.
 */
export default function LinksHeroVisual({ handle, did }: Props) {
  const allWaypoints = useMemo(
    () =>
      getWaypointsForType('profile').filter(
        (w) => w.getUrl(handle, undefined, undefined, did) !== null,
      ),
    [handle, did],
  );
  const chips = useMemo(
    () =>
      CHIP_IDS.map((id) => allWaypoints.find((w) => w.id === id)).filter(
        (w): w is Waypoint => Boolean(w),
      ),
    [allWaypoints],
  );

  // Reduce motion holds the picture still: no hopping highlight, no
  // rotating rows. Same source PageTransition reads.
  const reduceMotion = useSyncExternalStore(
    subscribeReduceMotion,
    getReduceMotionSnapshot,
    getReduceMotionServerSnapshot,
  );

  const [active, setActive] = useState(0);
  useEffect(() => {
    if (reduceMotion || chips.length === 0) return undefined;
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % chips.length);
    }, HIGHLIGHT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [chips.length, reduceMotion]);

  const [slots, setSlots] = useState<Waypoint[]>(() => allWaypoints.slice(0, VISIBLE_SLOTS));
  const nextIndexRef = useRef(VISIBLE_SLOTS);
  const nextSlotRef = useRef(0);
  useEffect(() => {
    if (reduceMotion || allWaypoints.length <= VISIBLE_SLOTS) return undefined;
    const id = window.setInterval(() => {
      setSlots((prev) => {
        const next = [...prev];
        // Skip waypoints already on screen so each frame's rows stay unique.
        for (let safety = 0; safety < allWaypoints.length; safety += 1) {
          const candidate = allWaypoints[nextIndexRef.current % allWaypoints.length];
          nextIndexRef.current += 1;
          if (!next.some((w) => w.id === candidate.id)) {
            next[nextSlotRef.current] = candidate;
            break;
          }
        }
        nextSlotRef.current = (nextSlotRef.current + 1) % VISIBLE_SLOTS;
        return next;
      });
    }, ROTATE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [allWaypoints, reduceMotion]);

  return (
    <div className="fl-mock fl-linkhero" aria-hidden>
      <div className="fl-mock-body fl-linkhero-top">
        <span className="fl-linkhero-url">
          <Link2 size={13} />
          aturi.to/profile/{handle}
        </span>
        <span className="fl-linkhero-title">Open {handle}&rsquo;s profile in…</span>
        <span className="fl-chips">
          {chips.map((w, i) => (
            <span key={w.id} className="fl-chip" data-solid={i === active ? '' : undefined}>
              <span className="fl-mock-icon" data-size="s">
                {w.icon}
              </span>
              {w.name}
            </span>
          ))}
        </span>
      </div>
      <div className="fl-mock-body">
        <span className="fl-mock-label">
          Open in any of {getWaypointCount()} Atmosphere clients
        </span>
        {slots.map((w, slotIndex) => (
          <div key={`slot-${slotIndex}`} className="fl-linkhero-slot">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={w.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className="fl-mock-row"
              >
                <span className="fl-mock-icon">{w.icon}</span>
                <span className="fl-mock-row-text">
                  <span className="fl-mock-name">{w.name}</span>
                  <span className="fl-mock-sub">
                    {typeof w.description === 'function'
                      ? w.description(undefined, 'profile')
                      : w.description}
                  </span>
                </span>
              </motion.div>
            </AnimatePresence>
          </div>
        ))}
      </div>
      <div className="fl-mock-foot">Every universal link page shows the full picker.</div>
    </div>
  );
}

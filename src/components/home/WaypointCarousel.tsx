'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getWaypointsForType, type Waypoint } from '@/utils/waypoints';

type Props = {
  handle: string;
  did?: string;
};

// How often to swap one slot for a different waypoint, in ms. Slow enough
// that visitors can read each chip; fast enough that the catalog cycles
// through in a reasonable window.
const ROTATE_INTERVAL_MS = 2400;
const VISIBLE_SLOTS = 3;

/**
 * Compact, animated abstraction of the WaypointPicker. Shows three
 * waypoint chips at a time and quietly rotates one of them every
 * couple of seconds with the next waypoint in the catalog — visitors
 * see the breadth of supported Atmosphere clients without the demo
 * eating 800px of vertical space rendering all 25+ of them.
 *
 * Each chip is still a real link to the waypoint's URL for the given
 * handle, so the demo is functional, not just decorative.
 */
export default function WaypointCarousel({ handle, did }: Props) {
  const allWaypoints = useMemo(() => getWaypointsForType('profile'), []);
  const [slots, setSlots] = useState<Waypoint[]>(() =>
    allWaypoints.slice(0, VISIBLE_SLOTS),
  );
  // Index into the catalog we'll surface next when rotating a slot.
  const nextIndexRef = useRef(VISIBLE_SLOTS);
  // Which slot we'll replace next — cycles 0 → 1 → 2 → 0 so the
  // animation doesn't bunch up on one row.
  const nextSlotRef = useRef(0);

  useEffect(() => {
    if (allWaypoints.length <= VISIBLE_SLOTS) return undefined;
    const id = window.setInterval(() => {
      setSlots((prev) => {
        const next = [...prev];
        const incoming = allWaypoints[nextIndexRef.current % allWaypoints.length];
        // Skip if the incoming waypoint is already on screen — keeps
        // each frame's three chips unique.
        let safety = 0;
        while (
          next.some((w) => w.id === incoming.id) &&
          safety < allWaypoints.length
        ) {
          nextIndexRef.current += 1;
          const candidate =
            allWaypoints[nextIndexRef.current % allWaypoints.length];
          if (!next.some((w) => w.id === candidate.id)) {
            next[nextSlotRef.current] = candidate;
            break;
          }
          safety += 1;
        }
        if (safety === 0) {
          next[nextSlotRef.current] = incoming;
        }
        nextIndexRef.current += 1;
        nextSlotRef.current = (nextSlotRef.current + 1) % VISIBLE_SLOTS;
        return next;
      });
    }, ROTATE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [allWaypoints]);

  return (
    <div>
      <h3
        className="explore-small-caps"
        style={{
          marginBottom: '0.625rem',
          color: 'var(--text-secondary)',
        }}
      >
        Open in any of 25+ Atmosphere clients
      </h3>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        {slots.map((waypoint, slotIndex) => (
          <div
            key={`slot-${slotIndex}`}
            style={{
              position: 'relative',
              // Stable per-slot height so the rotation in/out doesn't
              // reflow the strip every couple of seconds. `overflow-y`
              // clips the vertical slide-in/out from AnimatePresence;
              // `overflow-x` stays visible so the chip's hover
              // translateX(2px) and accent border aren't clipped at
              // the slot edges.
              height: '60px',
              overflowX: 'visible',
              overflowY: 'clip',
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={waypoint.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                style={{ position: 'absolute', inset: 0 }}
              >
                <WaypointChip waypoint={waypoint} handle={handle} did={did} />
              </motion.div>
            </AnimatePresence>
          </div>
        ))}
      </div>
      <p
        style={{
          marginTop: '0.5rem',
          fontSize: '0.75rem',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}
      >
        Tap any to open this profile there. View the full picker on a real
        universal link page.
      </p>
    </div>
  );
}

function WaypointChip({
  waypoint,
  handle,
  did,
}: {
  waypoint: Waypoint;
  handle: string;
  did?: string;
}) {
  const url = waypoint.getUrl(handle, undefined, undefined, did);
  if (!url) return null;
  const description =
    typeof waypoint.description === 'function'
      ? waypoint.description(undefined, 'profile')
      : waypoint.description;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.875rem',
        height: '100%',
        padding: '0 1rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        textDecoration: 'none',
        color: 'var(--text-primary)',
        transition: 'border-color 0.2s ease, transform 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--text-accent)';
        e.currentTarget.style.transform = 'translateX(2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-medium)';
        e.currentTarget.style.transform = 'translateX(0)';
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          color: 'var(--text-accent)',
          flexShrink: 0,
        }}
      >
        {waypoint.icon}
      </span>
      <div style={{ minWidth: 0, lineHeight: 1.25 }}>
        <div
          style={{
            fontSize: '0.95rem',
            fontFamily: 'var(--font-serif)',
            color: 'var(--text-primary)',
          }}
        >
          {waypoint.name}
        </div>
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {description}
        </div>
      </div>
    </a>
  );
}

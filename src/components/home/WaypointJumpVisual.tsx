'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link2 } from 'lucide-react';
import { WAYPOINT_ICONS } from '@/utils/waypointIcons';

// A handful of recognisable Atmosphere clients to populate the row. Order
// + selection are tuned so the animated highlight visits a varied set of
// icons (not just Bluesky forks back-to-back).
const DEFAULT_ROW_ICON_IDS = [
  'bluesky',
  'leaflet',
  'tangled',
  'margin',
  'deer',
  'pinksky',
  'grain',
  'witchsky',
] as const;

const HIGHLIGHT_INTERVAL_MS = 1100;

const DEFAULT_ICON_SIZE = 38;

/**
 * Animated visual for the homepage's Universal Links strip. Shows a
 * stylized aturi.to URL chip flowing into a row of waypoint icons,
 * with a moving highlight that hops between them — communicates the
 * \"one link, many clients\" idea in a way the carousel below can't on
 * its own.
 */
type Props = {
  handle?: string;
  /**
   * Which icon ids to render across the row. Callers in narrower
   * containers (e.g. the /universal-links landing page, which lives
   * in container-narrow at 800px) should pass a shorter list so the
   * row doesn't get squeezed.
   */
  iconIds?: readonly string[];
  /** Pixel size of each icon cell. Defaults to 38. */
  iconSize?: number;
};

export default function WaypointJumpVisual({
  handle = 'aturi.to',
  iconIds = DEFAULT_ROW_ICON_IDS,
  iconSize = DEFAULT_ICON_SIZE,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setActiveIndex((i) => (i + 1) % iconIds.length);
    }, HIGHLIGHT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [iconIds.length]);

  return (
    <div
      style={{
        padding: '1.25rem 1.25rem 1.5rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
      }}
    >
      {/* aturi.to URL pill */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          alignSelf: 'flex-start',
          padding: '0.4rem 0.75rem',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8rem',
          color: 'var(--text-primary)',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1,
        }}
        aria-hidden
      >
        <Link2 size={12} style={{ color: 'var(--text-accent)' }} />
        <span>
          aturi.to/profile/
          <strong style={{ color: 'var(--text-accent)', fontWeight: 500 }}>
            {handle}
          </strong>
        </span>
      </div>

      {/* Travelling-highlight chevron arrow that sits between the URL
          and the icon row. */}
      <div
        style={{
          position: 'relative',
          height: '0.75rem',
        }}
        aria-hidden
      >
        <motion.div
          animate={{
            left: `${(activeIndex / Math.max(iconIds.length - 1, 1)) * 100}%`,
          }}
          transition={{ type: 'spring', stiffness: 240, damping: 26 }}
          style={{
            position: 'absolute',
            top: 0,
            transform: 'translateX(-50%)',
            color: 'var(--text-accent)',
            fontSize: '0.85rem',
            lineHeight: 1,
          }}
        >
          ▾
        </motion.div>
      </div>

      {/* Icon row with the active one highlighted. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.4rem',
        }}
      >
        {iconIds.map((id, i) => {
          const isActive = i === activeIndex;
          return (
            <motion.div
              key={id}
              animate={{
                scale: isActive ? 1.12 : 1,
                opacity: isActive ? 1 : 0.55,
              }}
              transition={{ duration: 0.32, ease: 'easeOut' }}
              style={{
                width: iconSize,
                height: iconSize,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isActive ? 'var(--text-accent)' : 'var(--text-secondary)',
                background: isActive ? 'var(--bg-tertiary)' : 'transparent',
                border: `1px solid ${isActive ? 'var(--text-accent)' : 'var(--border-subtle)'}`,
                boxShadow: isActive ? '0 0 18px var(--glow-subtle)' : undefined,
                flexShrink: 0,
              }}
              aria-hidden
            >
              {WAYPOINT_ICONS[id] || null}
            </motion.div>
          );
        })}
      </div>

      <p
        style={{
          margin: 0,
          marginTop: '0.25rem',
          fontSize: '0.75rem',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}
      >
        Anyone you share an aturi.to link with picks where it opens.
      </p>
    </div>
  );
}

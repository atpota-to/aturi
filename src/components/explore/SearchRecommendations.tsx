'use client';

import { useEffect, useMemo } from 'react';
import { Clock, Server, TrendingUp, User } from 'lucide-react';
import { actorFromPath, type SearchHistoryEntry } from '@/utils/searchHistory';
import { enrichRecommendationAvatars } from '@/utils/searchHistoryEnrich';

/**
 * Shared rendering for the "recent" / "frequent" recommendations surfaced
 * under an empty search input. Used by both the explorer SearchBox and the
 * compact header search panel. Renders the section blocks only — each caller
 * supplies its own positioned/styled container so the dropdown can sit inline
 * (header) or as an absolute overlay (explorer).
 *
 * Free-text searches don't capture an avatar at record time, so on display we
 * resolve those actor entries against the AppView and call `onEnriched` once
 * any avatars/display-names have been written back to local history.
 */
export default function SearchRecommendations({
  recents,
  frequent,
  onPick,
  onEnriched,
}: {
  recents: SearchHistoryEntry[];
  frequent: SearchHistoryEntry[];
  onPick: (entry: SearchHistoryEntry) => void;
  onEnriched?: () => void;
}) {
  // Key off the actor entries still missing an avatar so the effect only runs
  // when there's something to backfill (not on every render).
  const pendingKey = useMemo(
    () =>
      [...recents, ...frequent]
        .filter((e) => !e.avatar && actorFromPath(e.path))
        .map((e) => e.path)
        .join('|'),
    [recents, frequent],
  );

  useEffect(() => {
    if (!pendingKey) return;
    let cancelled = false;
    enrichRecommendationAvatars([...recents, ...frequent]).then((changed) => {
      if (changed && !cancelled) onEnriched?.();
    });
    return () => {
      cancelled = true;
    };
    // recents/frequent are captured via pendingKey; re-running only when the
    // set of un-enriched actor paths changes is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, onEnriched]);

  return (
    <>
      {recents.length > 0 && (
        <RecommendationSection
          icon={<Clock size={12} />}
          label="recent"
          entries={recents}
          onPick={onPick}
        />
      )}
      {frequent.length > 0 && (
        <RecommendationSection
          icon={<TrendingUp size={12} />}
          label="frequent"
          entries={frequent}
          onPick={onPick}
          topBorder={recents.length > 0}
        />
      )}
    </>
  );
}

function RecommendationSection({
  icon,
  label,
  entries,
  onPick,
  topBorder = false,
}: {
  icon: React.ReactNode;
  label: string;
  entries: SearchHistoryEntry[];
  onPick: (entry: SearchHistoryEntry) => void;
  topBorder?: boolean;
}) {
  return (
    <div style={topBorder ? { borderTop: '1px solid var(--border-subtle)' } : undefined}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.45rem 0.6rem 0.3rem',
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.62rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {icon}
        <span>{label}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {entries.map((entry, i) => (
          <li
            key={entry.path}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(entry);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.4rem 0.6rem',
              borderBottom:
                i < entries.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              cursor: 'pointer',
              transition: 'background 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-elevated)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {entry.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={entry.avatar}
                alt=""
                width={24}
                height={24}
                style={{
                  width: 24,
                  height: 24,
                  objectFit: 'cover',
                  background: 'var(--bg-secondary)',
                  flexShrink: 0,
                }}
              />
            ) : (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-tertiary)',
                  flexShrink: 0,
                }}
              >
                {entry.path.startsWith('/explore/pds/') ? (
                  <Server size={13} />
                ) : (
                  <User size={13} />
                )}
              </span>
            )}
            <div style={{ minWidth: 0, lineHeight: 1.2 }}>
              <div
                style={{
                  fontSize: '0.8125rem',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-serif)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {entry.label}
              </div>
              {entry.sublabel && entry.sublabel !== entry.label && (
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {entry.sublabel}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

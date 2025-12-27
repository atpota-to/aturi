'use client';

import { useState } from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';
import { getWaypointsForType, type WaypointType } from '@/utils/waypoints';
import ShareButton from './ShareButton';

type WaypointPickerProps = {
  type: WaypointType;
  handle: string;
  collection?: string;
  rkey?: string;
  displayName?: string;
};

export default function WaypointPicker({
  type,
  handle,
  collection,
  rkey,
  displayName,
}: WaypointPickerProps) {
  const waypoints = getWaypointsForType(type);
  const display = displayName || `@${handle}`;
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (url: string, waypointId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(waypointId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleWaypointClick = (url: string, e: React.MouseEvent) => {
    // Don't navigate if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('a') ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'A'
    ) {
      return;
    }
    // Open in new tab
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const getContextText = () => {
    switch (type) {
      case 'post':
        return `Opening post by ${display}`;
      case 'profile':
        return `Open profile for ${display} on...`;
      case 'list':
        return `Opening list by ${display}`;
      default:
        return `Opening content from ${display}`;
    }
  };

  return (
    <>
      {/* Header */}
      <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
          Choose where to view
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem' }}>
          {getContextText()}
        </p>
      </header>

      {/* Waypoint Options */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        {waypoints.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
            <p style={{ color: 'var(--text-secondary)' }}>
              No waypoints available for this content type yet.
            </p>
          </div>
        ) : (
          waypoints.map((waypoint) => {
            const url = waypoint.getUrl(handle, collection, rkey);
            if (!url) return null;
            const isCopied = copiedId === waypoint.id;

            return (
              <div
                key={waypoint.id}
                className="waypoint-button"
                onClick={(e) => handleWaypointClick(url, e)}
                style={{ cursor: 'pointer' }}
              >
                <div className="waypoint-icon">{waypoint.icon}</div>
                <div className="waypoint-content">
                  <div className="waypoint-name">{waypoint.name}</div>
                  <div className="waypoint-description">
                    {waypoint.description}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <button
                    onClick={(e) => handleCopy(url, waypoint.id, e)}
                    aria-label="Copy link"
                    className="copy-button"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '0.25rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      color: 'var(--text-tertiary)',
                      transition: 'color 0.2s ease',
                    }}
                  >
                    {isCopied ? (
                      <Check size={20} style={{ color: 'var(--text-accent)' }} />
                    ) : (
                      <Copy size={20} />
                    )}
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open in ${waypoint.name}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      color: 'var(--text-tertiary)',
                      transition: 'color 0.2s ease',
                    }}
                  >
                    <ExternalLink size={20} />
                  </a>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* About aturi.to */}
      <div
        className="card"
        style={{
          marginTop: '3rem',
          textAlign: 'center',
        }}
      >
        <h3 style={{ marginBottom: '1rem', color: 'var(--text-accent)' }}>
          What is aturi.to?
        </h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Universal links for the ATmosphere. Share ATProto content with anyone,
          let them choose where to view it.
        </p>
        <ShareButton
          url={typeof window !== 'undefined' ? window.location.href : ''}
          label="Share this waypoint page"
        />
      </div>
    </>
  );
}


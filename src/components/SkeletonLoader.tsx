/**
 * SkeletonLoader Component
 * Reusable skeleton loading primitives that match the app's organic aesthetic
 */

import React from 'react';

interface SkeletonProps {
  width?: string;
  height?: string;
  style?: React.CSSProperties;
  animate?: boolean;
}

/**
 * Base skeleton primitive - a shimmering organic block
 */
export function Skeleton({ 
  width = '100%', 
  height = '1rem', 
  style = {},
  animate = true 
}: SkeletonProps) {
  return (
    <div
      className={animate ? 'skeleton-shimmer' : ''}
      style={{
        width,
        height,
        background: 'var(--bg-tertiary)',
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    />
  );
}

/**
 * Skeleton for circular elements (avatars)
 */
export function SkeletonCircle({ 
  size = '48px',
  style = {},
}: { size?: string; style?: React.CSSProperties }) {
  return (
    <Skeleton
      width={size}
      height={size}
      style={{
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

/**
 * Skeleton for text lines
 */
export function SkeletonText({ 
  lines = 1,
  lastLineWidth = '60%',
  gap = '0.5rem',
  lineHeight = '1rem',
}: { 
  lines?: number; 
  lastLineWidth?: string;
  gap?: string;
  lineHeight?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={lineHeight}
          width={i === lines - 1 ? lastLineWidth : '100%'}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton for image/media blocks
 */
export function SkeletonImage({ 
  aspectRatio = '16/9',
  height,
  style = {},
}: { 
  aspectRatio?: string;
  height?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Skeleton
      height={height}
      style={{
        aspectRatio: height ? undefined : aspectRatio,
        ...style,
      }}
    />
  );
}

/**
 * CSS for skeleton shimmer animation
 * Add to globals.css
 */



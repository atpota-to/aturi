/**
 * SkeletonLoader Component
 * Reusable skeleton loading primitives in the Field Notes style. The look
 * lives in one class, `.fn-skel` (account.css), so every placeholder on the
 * site shares its tone, corners and pulse.
 */

import React from 'react';

/**
 * What a bar stands in for, which decides its corners: a line of text is a
 * pill, a control (field, button, chip) takes --radius-control, a block of
 * media takes the 10px of embeds and tiles, and an avatar is round.
 */
export type SkeletonShape = 'line' | 'control' | 'block' | 'circle';

interface SkeletonProps {
  width?: string;
  height?: string;
  shape?: SkeletonShape;
  style?: React.CSSProperties;
  animate?: boolean;
}

/**
 * Base skeleton primitive - one pulsing placeholder bar
 */
export function Skeleton({
  width = '100%',
  height = '1rem',
  shape = 'line',
  style = {},
  animate = true,
}: SkeletonProps) {
  return (
    <div
      className="fn-skel"
      data-shape={shape === 'line' ? undefined : shape}
      data-still={animate ? undefined : ''}
      aria-hidden
      style={{ width, height, ...style }}
    />
  );
}

/**
 * One line of text as a bar: a box one line of that text tall (`1lh`, from
 * `className`'s type or else the parent's) with the bar centred in it, so
 * the placeholder takes the height the words will. Give it the class of the
 * text it stands in for and the line height follows that text everywhere,
 * phone sizes included.
 */
export function SkeletonLine({
  width,
  height = '0.6rem',
  className,
  style,
}: {
  width: string;
  height?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={className}
      style={{ display: 'flex', alignItems: 'center', height: '1lh', minWidth: 0, ...style }}
    >
      <Skeleton width={width} height={height} />
    </span>
  );
}

/**
 * Skeleton for circular elements (avatars)
 */
export function SkeletonCircle({
  size = '48px',
  style = {},
}: { size?: string; style?: React.CSSProperties }) {
  return <Skeleton width={size} height={size} shape="circle" style={{ flexShrink: 0, ...style }} />;
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
      height={height ?? 'auto'}
      shape="block"
      style={{
        aspectRatio: height ? undefined : aspectRatio,
        ...style,
      }}
    />
  );
}

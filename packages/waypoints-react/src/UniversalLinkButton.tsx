import type { ReactNode } from 'react';
import { Check, Link2, Share2 } from 'lucide-react';
import type { UniversalLink } from '@aturi.to/waypoints';
import {
  useUniversalLink,
  type ShareOutcome,
  type UseUniversalLinkParams,
} from './useUniversalLink';
import { cx, slotClass, type WaypointClassNames } from './styling';

export type UniversalLinkButtonProps = UseUniversalLinkParams & {
  /**
   * `auto` (default) opens the native share sheet where there is one and
   * copies where there isn't — the right behavior on phone and desktop from
   * one control. `copy` and `share` pin it either way.
   */
  mode?: 'auto' | 'copy' | 'share';
  label?: ReactNode;
  copiedLabel?: ReactNode;
  /** Hide the text and keep the icon. The label still names the button for AT. */
  iconOnly?: boolean;
  onAction?: (outcome: ShareOutcome | 'copy-failed', link: UniversalLink) => void;
  /** Drop the built-in class names; keep only the `data-aturi-wp` hooks. */
  unstyled?: boolean;
  classNames?: WaypointClassNames;
  /** Extra class on the button (always applied). */
  className?: string;
};

/**
 * A one-control "share this record" button: copies the aturi.to universal link,
 * or hands it to the native share sheet where the browser has one.
 *
 * Renders nothing when the target doesn't name a record or an identity, so it
 * can be dropped into a row whose data may still be loading.
 */
export function UniversalLinkButton({
  mode = 'auto',
  label = 'Copy link',
  copiedLabel = 'Copied',
  iconOnly,
  onAction,
  unstyled,
  classNames,
  className,
  ...params
}: UniversalLinkButtonProps) {
  const { link, copied, copy, share, canShare } = useUniversalLink(params);
  if (!link) return null;

  const willShare = mode === 'share' || (mode === 'auto' && canShare);
  const activeLabel = copied ? copiedLabel : willShare ? 'Share' : label;

  const handleClick = async () => {
    if (willShare) {
      onAction?.(await share(), link);
      return;
    }
    const ok = await copy();
    onAction?.(ok ? 'copied' : 'copy-failed', link);
  };

  return (
    <button
      type="button"
      data-aturi-wp="universal-link"
      data-copied={copied || undefined}
      title={link.url}
      aria-label={typeof activeLabel === 'string' ? activeLabel : undefined}
      className={cx(
        slotClass('universalLink', unstyled, classNames),
        className,
      )}
      onClick={handleClick}
    >
      <span
        data-aturi-wp="universal-link-icon"
        className={slotClass('universalLinkIcon', unstyled, classNames)}
        aria-hidden
      >
        {copied ? (
          <Check size={16} />
        ) : willShare ? (
          <Share2 size={16} />
        ) : (
          <Link2 size={16} />
        )}
      </span>
      {iconOnly ? null : (
        <span
          data-aturi-wp="universal-link-label"
          className={slotClass('universalLinkLabel', unstyled, classNames)}
        >
          {activeLabel}
        </span>
      )}
    </button>
  );
}

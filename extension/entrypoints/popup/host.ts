import { browser } from '#imports';
import { IS_SAFARI } from '../../lib/platform';

/**
 * How Safari is showing the popup, written onto <html> for popup.css.
 *
 * On macOS, and in an iPad popover, Safari sizes the popup to the page, so
 * the body's fixed width (`--popup-w`) is the popup's width. An iPhone, and an
 * iPad in a narrow window, show the popup as a sheet as wide as the screen or
 * window instead, and there a fixed body leaves a gutter or scrolls sideways.
 *
 * - `data-platform="ios"`: Safari on iPhone or iPad.
 * - `data-popup-host="sheet"`: the popup is one of those sheets, and the body
 *   fills it.
 *
 * Neither is ever set by Chrome, Firefox or macOS Safari, where the popup
 * renders exactly as it always has. The Chrome and Firefox builds don't run
 * any of this.
 */

/** iPhone and iPod touch say so in the user agent; an iPad passes for a Mac. */
export function isIPhoneUserAgent(ua: string): boolean {
  return /\b(iPhone|iPod)\b/.test(ua);
}

/**
 * Whether a presented popup is laid out wider or narrower than its own body.
 * A popover lays the page out at exactly the body's fixed width; a sheet lays
 * it out at the screen's or window's. Zero means "not laid out yet" (before
 * Safari presents the popup its view has no size). The 2px slack absorbs
 * rounding.
 */
export function looksLikeSheet(viewportWidth: number, bodyWidth: number): boolean {
  return viewportWidth > 0 && bodyWidth > 0 && Math.abs(viewportWidth - bodyWidth) >= 2;
}

let iosPopup: Promise<boolean> = Promise.resolve(false);

/**
 * Whether this popup is on iOS. Settles once Safari has answered
 * `getPlatformInfo`; false straight away in Chrome and Firefox.
 */
export function isIOSPopup(): Promise<boolean> {
  return iosPopup;
}

/** Call once, first thing, before the popup renders. */
export function detectPopupHost(): void {
  if (!IS_SAFARI) return;
  const root = document.documentElement;

  // An iPhone shows a sheet. Setting the attributes now gets the first paint
  // right; an iPad has to wait for the API below. The exception is an iPhone
  // Plus or Max in landscape, which shows a popover: Safari sizes that to the
  // page, so the fluid body would shrink it to its narrowest, and popup.css's
  // 320px floor is the width it gets instead of --popup-w.
  if (isIPhoneUserAgent(navigator.userAgent)) {
    root.dataset.platform = 'ios';
    root.dataset.popupHost = 'sheet';
  }

  let info: Promise<{ os: string }>;
  try {
    info = browser.runtime.getPlatformInfo();
  } catch (err) {
    info = Promise.reject(err);
  }
  iosPopup = info.then(
    ({ os }) => {
      if (os !== 'ios') {
        delete root.dataset.platform;
        delete root.dataset.popupHost;
        return false;
      }
      root.dataset.platform = 'ios';
      watchForSheet(root);
      return true;
    },
    () => root.dataset.platform === 'ios'
  );
}

/**
 * Latch `data-popup-host="sheet"` once the presented popup's width parts from
 * the body's. It is never cleared: with a fluid body the two widths always
 * match, so there would be nothing left to tell a popover by. A mismatch has
 * to hold for a second frame before it counts, so one odd frame while Safari
 * sizes a popover can't make it fluid. Only ever runs on iOS: macOS (and
 * Chrome) start a popup at 1x1 and grow it, which would trip the check.
 */
function watchForSheet(root: HTMLElement): void {
  if (root.dataset.popupHost === 'sheet') return;
  let suspect = false;

  const check = () => {
    if (root.dataset.popupHost === 'sheet') return stop();
    // Before Safari presents the popup it isn't in a window and has no size.
    if (document.visibilityState !== 'visible') return;
    const bodyWidth = document.body?.getBoundingClientRect().width ?? 0;
    if (!looksLikeSheet(window.innerWidth, bodyWidth)) {
      suspect = false;
      return;
    }
    if (!suspect) {
      suspect = true;
      requestAnimationFrame(check);
      return;
    }
    root.dataset.popupHost = 'sheet';
    stop();
  };

  function stop() {
    window.removeEventListener('resize', check);
    document.removeEventListener('visibilitychange', check);
  }

  window.addEventListener('resize', check);
  document.addEventListener('visibilitychange', check);
  requestAnimationFrame(check);
}

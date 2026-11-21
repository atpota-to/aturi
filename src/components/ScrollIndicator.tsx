/**
 * ScrollIndicator Component
 * A small floating pill that tells visitors there's more below the preview
 * card, and scrolls to the picker when tapped. Shown only while the picker is
 * below the fold; fades out once they scroll.
 */

'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

type ScrollIndicatorProps = {
  targetId?: string; // Optional ID of element to scroll to
};

export default function ScrollIndicator({
  targetId = 'waypoint-picker'
}: ScrollIndicatorProps) {
  const [scrolled, setScrolled] = useState(false);
  // Start "in view" so the pill doesn't flash on pages where the picker is
  // already on screen (tall desktop windows); the observer corrects it.
  const [pickerInView, setPickerInView] = useState(true);
  const isVisible = !scrolled && !pickerInView;

  // Only offer the hint while the picker is still below the fold, and hide it
  // once the visitor has scrolled a bit. The picker's place is measured
  // rather than read off an observer entry: the remember bar pins itself
  // over the screen's bottom edge, where this hint sits, as soon as the
  // picker's top is on screen, so a hint left up by a stale entry lands on
  // the bar. Viewport resizes measure again too (iOS Safari's toolbar or
  // keyboard settling after load); the observer only reports layout moving
  // the picker.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      setScrolled(window.scrollY > 150);
      const element = document.getElementById(targetId);
      // Nothing to scroll to: leave the hint hidden.
      setPickerInView(!element || element.getBoundingClientRect().top < window.innerHeight);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    const element = document.getElementById(targetId);
    const observer =
      element && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(schedule)
        : null;
    if (element) observer?.observe(element);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [targetId]);

  const handleClick = () => {
    const element = document.getElementById(targetId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className={`fn-lp-scroll${isVisible ? '' : ' is-hidden'}`}>
      <button
        type="button"
        onClick={handleClick}
        className="scroll-indicator-floating"
        tabIndex={isVisible ? 0 : -1}
      >
        <ChevronDown size={15} aria-hidden="true" />
        <span>Scroll to choose an app</span>
      </button>
    </div>
  );
}

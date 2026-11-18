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

  useEffect(() => {
    const handleScroll = () => {
      // Hide indicator once user has scrolled a bit
      setScrolled(window.scrollY > 150);
    };
    handleScroll();

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Only offer the hint while the picker is still below the fold.
  useEffect(() => {
    const element = document.getElementById(targetId);
    // Nothing to scroll to (or no observer support): leave the hint hidden.
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      setPickerInView(entry.isIntersecting || entry.boundingClientRect.top < 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
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

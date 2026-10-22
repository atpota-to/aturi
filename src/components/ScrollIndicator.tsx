/**
 * ScrollIndicator Component
 * A small floating pill that tells visitors there's more below the preview
 * card, and scrolls to the picker when tapped. Fades out once they scroll.
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
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleScroll = () => {
      // Hide indicator once user has scrolled a bit
      const scrolled = window.scrollY > 150;
      setIsVisible(!scrolled);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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

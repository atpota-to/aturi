/**
 * ScrollIndicator Component
 * A subtle, nature-inspired indicator that shows users there's more content below
 * Appears after preview cards and guides users to the waypoint picker
 */

'use client';

import { useEffect, useState } from 'react';

type ScrollIndicatorProps = {
  targetId?: string; // Optional ID of element to scroll to
  text?: string;
};

export default function ScrollIndicator({ 
  targetId = 'waypoint-picker', 
  text = 'Choose your path below'
}: ScrollIndicatorProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleScroll = () => {
      // Hide indicator once user has scrolled a bit
      const scrolled = window.scrollY > 100;
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
    <div
      style={{
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.6s ease',
        pointerEvents: isVisible ? 'auto' : 'none',
        margin: '-1rem 0 2rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1rem',
      }}
    >
      {/* Subtle divider line with gradient fade */}
      <div
        style={{
          width: '100%',
          height: '1px',
          background: 'linear-gradient(90deg, transparent 0%, var(--border-subtle) 50%, transparent 100%)',
        }}
      />

      {/* Interactive scroll button */}
      <button
        onClick={handleClick}
        className="scroll-indicator-button"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '1rem 1.5rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-tertiary)',
          transition: 'all 0.4s ease',
          position: 'relative',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-accent)';
          e.currentTarget.style.transform = 'translateY(4px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-tertiary)';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        {/* Text hint */}
        <span
          style={{
            fontSize: '0.8125rem',
            fontWeight: '400',
            letterSpacing: '0.02em',
            textTransform: 'lowercase',
            opacity: 0.8,
          }}
        >
          {text}
        </span>

        {/* Animated leaves/seeds falling */}
        <div
          style={{
            position: 'relative',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* First leaf */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              position: 'absolute',
              animation: 'float-down-1 3s ease-in-out infinite',
            }}
          >
            <path d="M12 2C12 2 7 5 7 12c0 3 2 5 5 5s5-2 5-5c0-7-5-10-5-10z" />
            <path d="M12 12L7 7" />
          </svg>

          {/* Second leaf (offset) */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              position: 'absolute',
              opacity: 0.5,
              animation: 'float-down-2 3s ease-in-out 1.5s infinite',
            }}
          >
            <path d="M12 2C12 2 7 5 7 12c0 3 2 5 5 5s5-2 5-5c0-7-5-10-5-10z" />
            <path d="M12 12L7 7" />
          </svg>
        </div>

        {/* Simple arrow as fallback/reinforcement */}
        <div
          style={{
            fontSize: '1.25rem',
            opacity: 0.6,
            animation: 'bounce-gentle 2s ease-in-out infinite',
          }}
        >
          ↓
        </div>
      </button>

      <style jsx>{`
        @keyframes float-down-1 {
          0% {
            transform: translateY(-8px) rotate(0deg);
            opacity: 0;
          }
          20% {
            opacity: 0.7;
          }
          50% {
            transform: translateY(8px) rotate(15deg);
            opacity: 0.9;
          }
          80% {
            opacity: 0.4;
          }
          100% {
            transform: translateY(16px) rotate(30deg);
            opacity: 0;
          }
        }

        @keyframes float-down-2 {
          0% {
            transform: translateY(-8px) rotate(0deg) translateX(4px);
            opacity: 0;
          }
          20% {
            opacity: 0.5;
          }
          50% {
            transform: translateY(8px) rotate(-12deg) translateX(-2px);
            opacity: 0.7;
          }
          80% {
            opacity: 0.3;
          }
          100% {
            transform: translateY(16px) rotate(-25deg) translateX(-6px);
            opacity: 0;
          }
        }

        @keyframes bounce-gentle {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(4px);
          }
        }

        .scroll-indicator-button:hover svg {
          animation-play-state: paused;
          opacity: 1;
        }

        @media (max-width: 640px) {
          .scroll-indicator-button {
            padding: 0.875rem 1.25rem;
          }
        }
      `}</style>
    </div>
  );
}


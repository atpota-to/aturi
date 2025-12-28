/**
 * ScrollIndicator Component
 * A floating, nature-inspired overlay that shows users there's more content below
 * Positioned over the preview card to ensure visibility regardless of card height
 */

'use client';

import { useEffect, useState } from 'react';
import { Leaf } from 'lucide-react';

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
    <div
      style={{
        position: 'fixed',
        bottom: '2rem',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.6s ease, transform 0.4s ease',
        pointerEvents: isVisible ? 'auto' : 'none',
      }}
    >
      {/* Floating organic button with backdrop */}
      <button
        onClick={handleClick}
        className="scroll-indicator-floating"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '1rem 1.75rem 1.25rem',
          background: 'rgba(15, 15, 15, 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--border-subtle)',
          cursor: 'pointer',
          color: 'var(--text-tertiary)',
          transition: 'all 0.4s ease',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.03)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(18, 18, 18, 0.9)';
          e.currentTarget.style.borderColor = 'var(--border-medium)';
          e.currentTarget.style.color = 'var(--text-accent)';
          e.currentTarget.style.transform = 'translateY(-4px)';
          e.currentTarget.style.boxShadow = '0 12px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(15, 15, 15, 0.85)';
          e.currentTarget.style.borderColor = 'var(--border-subtle)';
          e.currentTarget.style.color = 'var(--text-tertiary)';
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.03)';
        }}
      >
        {/* Subtle ambient glow */}
        <div
          style={{
            position: 'absolute',
            top: '-50%',
            left: '-50%',
            width: '200%',
            height: '200%',
            background: 'radial-gradient(circle at center, var(--glow-subtle) 0%, transparent 60%)',
            opacity: 0.15,
            pointerEvents: 'none',
            animation: 'breathe-slow 6s ease-in-out infinite',
          }}
        />

        {/* Falling leaves container */}
        <div
          style={{
            position: 'relative',
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Multiple leaves falling at different rates */}
          <div
            style={{
              position: 'absolute',
              animation: 'float-leaf-1 3.5s ease-in-out infinite',
            }}
          >
            <Leaf size={28} strokeWidth={1.5} />
          </div>

          <div
            style={{
              position: 'absolute',
              animation: 'float-leaf-2 3.5s ease-in-out 1.2s infinite',
            }}
          >
            <Leaf size={22} strokeWidth={1.5} />
          </div>

          <div
            style={{
              position: 'absolute',
              animation: 'float-leaf-3 3.5s ease-in-out 2.4s infinite',
            }}
          >
            <Leaf size={24} strokeWidth={1.5} />
          </div>
        </div>

        {/* Text hint */}
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: '400',
            letterSpacing: '0.03em',
            textTransform: 'lowercase',
            opacity: 0.85,
            whiteSpace: 'nowrap',
          }}
        >
          scroll to choose path
        </span>

      </button>

      <style jsx>{`
        @keyframes float-leaf-1 {
          0% {
            transform: translateY(-12px) rotate(0deg) translateX(-2px);
            opacity: 0;
          }
          15% {
            opacity: 0.8;
          }
          50% {
            transform: translateY(10px) rotate(20deg) translateX(3px);
            opacity: 1;
          }
          75% {
            opacity: 0.5;
          }
          85% {
            opacity: 0.3;
          }
          100% {
            transform: translateY(20px) rotate(35deg) translateX(5px);
            opacity: 0;
          }
        }

        @keyframes float-leaf-2 {
          0% {
            transform: translateY(-12px) rotate(0deg) translateX(4px);
            opacity: 0;
          }
          15% {
            opacity: 0.6;
          }
          50% {
            transform: translateY(10px) rotate(-15deg) translateX(-2px);
            opacity: 0.8;
          }
          75% {
            opacity: 0.4;
          }
          85% {
            opacity: 0.2;
          }
          100% {
            transform: translateY(20px) rotate(-28deg) translateX(-6px);
            opacity: 0;
          }
        }

        @keyframes float-leaf-3 {
          0% {
            transform: translateY(-12px) rotate(0deg) translateX(0px);
            opacity: 0;
          }
          15% {
            opacity: 0.4;
          }
          50% {
            transform: translateY(10px) rotate(10deg) translateX(-4px);
            opacity: 0.6;
          }
          75% {
            opacity: 0.3;
          }
          85% {
            opacity: 0.15;
          }
          100% {
            transform: translateY(20px) rotate(18deg) translateX(-7px);
            opacity: 0;
          }
        }

        @keyframes breathe-slow {
          0%, 100% {
            opacity: 0.15;
            transform: scale(1);
          }
          50% {
            opacity: 0.25;
            transform: scale(1.1);
          }
        }

        /* Keep leaves animating even on hover - just slow them down slightly */
        .scroll-indicator-floating:hover > div > div > div {
          animation-duration: 4.5s;
        }

        @media (max-width: 640px) {
          .scroll-indicator-floating {
            padding: 0.875rem 1.5rem 1rem;
          }
        }
      `}</style>
    </div>
  );
}


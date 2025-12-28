'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface StaggeredChildrenProps {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
  style?: React.CSSProperties;
}

export function StaggeredChildren({
  children,
  className,
  staggerDelay = 0.08,
  style,
}: StaggeredChildrenProps) {
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: staggerDelay,
        delayChildren: 0.1,
      },
    },
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}

interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  delay?: number;
}

export function StaggerItem({ children, className, style, delay = 0 }: StaggerItemProps) {
  const item = {
    hidden: { 
      opacity: 0, 
      y: 30,
      scale: 0.95,
      rotate: -1,
    },
    show: { 
      opacity: 1, 
      y: 0,
      scale: 1,
      rotate: 0,
      transition: {
        duration: 0.6,
        ease: [0.34, 1.56, 0.64, 1], // Organic spring-like easing
        delay,
      },
    },
  };

  return (
    <motion.div variants={item} className={className} style={style}>
      {children}
    </motion.div>
  );
}


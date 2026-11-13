'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface FadeInProps {
  children: ReactNode;
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function FadeIn({ children, delay = 0, className, style }: FadeInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{
        duration: 0.45,
        delay,
        ease: [0.22, 1, 0.36, 1] as [number, number, number, number], // Gentle ease-out, no overshoot
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}

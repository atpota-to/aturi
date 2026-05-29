import { defineConfig } from 'vitest/config';

export default defineConfig({
  // This package ships no CSS; pin an empty PostCSS config so Vite doesn't
  // walk up and load the root Next.js app's Tailwind PostCSS setup.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

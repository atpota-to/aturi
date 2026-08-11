import { defineConfig } from 'vitest/config';

export default defineConfig({
  // styles.css is shipped as a raw asset, never processed here; pin an empty
  // PostCSS config so Vite doesn't walk up and load the root Next.js app's
  // Tailwind PostCSS setup.
  css: { postcss: { plugins: [] } },
  // No @vitejs/plugin-react on purpose. Vite transforms .tsx with esbuild,
  // which reads `jsx` from this package's tsconfig — `react-jsx`, so the
  // automatic runtime is used and test files need no React import. Flipping
  // tsconfig's `jsx` to `react` makes every .tsx test fail with "React is not
  // defined", which is how that coupling was confirmed.
  test: {
    // Node is the default so the SSR and packaging suites run in the
    // environment they actually assert about. The DOM suites opt in per file
    // with an `@vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2020',
  external: ['react', 'react-dom', 'lucide-react', '@aturi/waypoints'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
  // The theme stylesheet is opt-in and not imported by any component, so copy
  // it into dist as a standalone file consumers can import explicitly.
  onSuccess:
    "node -e \"require('fs').copyFileSync('src/styles.css','dist/styles.css')\"",
});

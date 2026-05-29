import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2020',
  external: ['react', 'react-dom', 'lucide-react', '@aturi.to/waypoints'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
  // Post-build: copy the opt-in theme into dist and prepend the "use client"
  // directive to the bundles. esbuild strips the directive during bundling, so
  // we re-add it here — see scripts/postbuild.mjs.
  onSuccess: 'node scripts/postbuild.mjs',
});

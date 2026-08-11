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
  // Keeps `tsup --watch` producing a complete dist. `onSuccess` fires when the
  // JS build finishes, which is *before* the declaration build completes — and
  // that phase clears .d.ts files it did not emit, including the one postbuild
  // writes for the styles subpath. So `npm run build` runs the script again
  // after tsup exits; it is idempotent. See scripts/postbuild.mjs.
  onSuccess: 'node scripts/postbuild.mjs',
});

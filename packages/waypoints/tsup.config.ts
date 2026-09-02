import { defineConfig } from 'tsup';

export default defineConfig({
  // `icons` is a separate entry so the brand marks stay out of the main bundle;
  // see the note at the top of src/icons.ts.
  entry: { index: 'src/index.ts', icons: 'src/icons.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2020',
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
});

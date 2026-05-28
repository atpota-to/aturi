// Post-build steps for @aturi/waypoints-react, run by tsup's `onSuccess`.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

// 1) Ship the opt-in theme as a standalone file. No component imports it, so
//    tsup never emits it on its own — copy it verbatim for explicit import via
//    `@aturi/waypoints-react/styles.css`.
copyFileSync('src/styles.css', 'dist/styles.css');

// 2) Guarantee the React Client Component directive survives bundling. The
//    components are stateful and use browser APIs, so the entry must carry
//    "use client" for React Server Components / Next.js App Router. esbuild
//    strips the directive from source and banners during bundling, so we
//    prepend it to the emitted entries as the first statement. It's harmlessly
//    ignored by non-RSC bundlers (Vite, webpack).
const DIRECTIVE = '"use client";\n';
for (const file of ['dist/index.js', 'dist/index.cjs']) {
  const code = readFileSync(file, 'utf8');
  if (!/^["']use client["']/.test(code)) {
    writeFileSync(file, DIRECTIVE + code);
  }
}

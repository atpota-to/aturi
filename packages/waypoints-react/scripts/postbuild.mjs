// Post-build steps for @aturi.to/waypoints-react, run by tsup's `onSuccess`.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

// 1) Ship the opt-in theme as a standalone file. No component imports it, so
//    tsup never emits it on its own — copy it verbatim for explicit import via
//    `@aturi.to/waypoints-react/styles.css`.
copyFileSync('src/styles.css', 'dist/styles.css');

// 2) Give the ./styles.css subpath a types entry. Without one, tooling that
//    resolves subpath exports as modules (arethetypeswrong, and TypeScript
//    under stricter future resolution modes) cannot resolve it at all. An empty
//    declaration is everything a CSS side-effect import needs, and it takes the
//    subpath from unresolvable in every mode to resolvable under bundler and
//    node16-from-ESM — the two that actually import CSS.
writeFileSync(
  'dist/styles.d.ts',
  '// Side-effect-only stylesheet; nothing to declare.\nexport {};\n',
);

// 3) Guarantee the React Client Component directive survives bundling. The
//    components are stateful and use browser APIs, so the entry must carry
//    "use client" for React Server Components / Next.js App Router. esbuild
//    strips the directive from source and banners during bundling, so we
//    prepend it to the emitted entries as the first statement. It's harmlessly
//    ignored by non-RSC bundlers (Vite, webpack).
//
//    Prepending a line after tsup has written the sourcemap shifts every
//    mapping by one line, so the map is corrected in the same step. A source
//    map's `mappings` field is a `;`-separated list of output lines, so one
//    leading `;` inserts exactly one unmapped line at the top — no dependency,
//    and no other field needs touching. Both edits sit inside the same guard so
//    a re-run over an already-patched bundle is a no-op.
const DIRECTIVE = '"use client";\n';
for (const file of ['dist/index.js', 'dist/index.cjs']) {
  const code = readFileSync(file, 'utf8');
  if (/^["']use client["']/.test(code)) continue;

  writeFileSync(file, DIRECTIVE + dedupeSourceMappingUrl(code));

  const mapFile = `${file}.map`;
  if (existsSync(mapFile)) {
    const map = JSON.parse(readFileSync(mapFile, 'utf8'));
    map.mappings = `;${map.mappings}`;
    writeFileSync(mapFile, JSON.stringify(map));
  }
}

/**
 * Keep only the last `//# sourceMappingURL=` pragma. Bundled dependencies can
 * carry their own trailing pragma, and a bundle with more than one leaves the
 * browser resolving whichever it sees last while devtools warn about the rest.
 */
function dedupeSourceMappingUrl(code) {
  const lines = code.split('\n');
  const pragma = /^\/\/# sourceMappingURL=/;
  const last = lines.findLastIndex((line) => pragma.test(line));
  if (last === -1) return code;
  return lines.filter((line, i) => !pragma.test(line) || i === last).join('\n');
}

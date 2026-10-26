#!/usr/bin/env node
// Keeps the package copies of Aturi's canonical source files in lockstep with
// the app's `src/`. The app and browser extension keep importing `src/utils/*`
// directly; these packages ship standalone copies so they can build without the
// Next.js app. This script is the drift guard for that tradeoff.
//
//   node scripts/sync.mjs          copy canonical files into the packages
//   node scripts/sync.mjs --check  exit non-zero if any copy is stale
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIconDataModule } from './svgFromJsx.mjs';

const here = dirname(fileURLToPath(import.meta.url)); // packages/waypoints/scripts
const repoRoot = resolve(here, '../../..'); // repo root
const coreSrc = resolve(here, '../src'); // packages/waypoints/src
const reactSrc = resolve(here, '../../waypoints-react/src'); // packages/waypoints-react/src

const identity = (s) => s;

// The React icon catalog imports the Anisota mark from the app's component
// tree (`../components/AnisotaLogo`). In the package the logo sits next to the
// catalog, so rewrite that one import. Everything else is copied verbatim.
const rewriteAnisotaImport = (s) =>
  s.replace(
    /from ['"]\.\.\/components\/AnisotaLogo['"]/,
    "from './AnisotaLogo'",
  );

const FILES = [
  // Zero-dependency core logic -> @aturi.to/waypoints
  {
    from: resolve(repoRoot, 'src/utils/waypoints.data.ts'),
    to: resolve(coreSrc, 'waypoints.data.ts'),
    transform: identity,
  },
  {
    // upstreamFetch imports this for its deadline and User-Agent; ship it in
    // the package so the copy builds.
    from: resolve(repoRoot, 'src/utils/requestDeadline.ts'),
    to: resolve(coreSrc, 'requestDeadline.ts'),
    transform: identity,
  },
  {
    // uriParser imports this; ship it in the package so the copy builds.
    from: resolve(repoRoot, 'src/utils/upstreamFetch.ts'),
    to: resolve(coreSrc, 'upstreamFetch.ts'),
    transform: identity,
  },
  {
    from: resolve(repoRoot, 'src/utils/uriParser.ts'),
    to: resolve(coreSrc, 'uriParser.ts'),
    transform: identity,
  },
  {
    from: resolve(repoRoot, 'src/utils/reverseParsers.ts'),
    to: resolve(coreSrc, 'reverseParsers.ts'),
    transform: identity,
  },
  {
    // The same catalog the React package ships, translated into standalone SVG
    // markup so the zero-dependency core can offer the marks to consumers that
    // are not on React. Generated rather than copied: JSX is not valid SVG, and
    // a hand-kept second catalog would drift. See scripts/svgFromJsx.mjs.
    from: resolve(repoRoot, 'src/utils/waypointIcons.tsx'),
    also: [resolve(repoRoot, 'src/components/AnisotaLogo.tsx')],
    to: resolve(coreSrc, 'waypointIcons.data.ts'),
    transform: renderIconDataModule,
  },
  // React icon catalog + its Anisota dependency -> @aturi.to/waypoints-react
  {
    from: resolve(repoRoot, 'src/utils/waypointIcons.tsx'),
    to: resolve(reactSrc, 'waypointIcons.tsx'),
    transform: rewriteAnisotaImport,
  },
  {
    from: resolve(repoRoot, 'src/components/AnisotaLogo.tsx'),
    to: resolve(reactSrc, 'AnisotaLogo.tsx'),
    transform: identity,
  },
];

const rel = (p) => relative(repoRoot, p);
const check = process.argv.includes('--check');

let drift = 0;
for (const file of FILES) {
  // `also` lists further canonical inputs a transform needs; their contents are
  // passed after the primary source.
  const sources = [file.from, ...(file.also ?? [])];
  for (const source of sources) {
    if (!existsSync(source)) {
      console.error(`missing source: ${rel(source)}`);
      process.exit(1);
    }
  }
  const expected = file.transform(...sources.map((s) => readFileSync(s, 'utf8')));
  if (check) {
    const current = existsSync(file.to) ? readFileSync(file.to, 'utf8') : null;
    if (current !== expected) {
      drift++;
      console.error(`drift: ${rel(file.to)} is out of sync with ${rel(file.from)}`);
    }
  } else {
    mkdirSync(dirname(file.to), { recursive: true });
    writeFileSync(file.to, expected);
    console.log(`synced ${rel(file.from)} -> ${rel(file.to)}`);
  }
}

if (check) {
  if (drift > 0) {
    console.error(
      `\n${drift} file(s) out of sync. Run \`npm run sync\` in packages/waypoints.`,
    );
    process.exit(1);
  }
  console.log('All synced files are up to date.');
}

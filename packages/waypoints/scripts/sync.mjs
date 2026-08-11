#!/usr/bin/env node
// Keeps the package copies of Aturi's canonical source files in lockstep with
// the app's `src/`. The app and browser extension keep importing `src/utils/*`
// directly; these packages ship standalone copies so they can build without the
// Next.js app. This script is the drift guard for that tradeoff.
//
//   node scripts/sync.mjs          copy canonical files into the packages
//   node scripts/sync.mjs --check  exit non-zero if any copy is stale
//
// `--check` compares each copy against `transform(canonical)`, which makes the
// transform definitionally correct: whatever it produces is certified as
// in-sync. So the transform has to check *itself*. Every rewrite below asserts
// that it matched what it expected to match and that nothing unresolvable
// survived, and `SyncError` carries those failures out to a non-zero exit in
// both modes. Unit tests live in `src/__tests__/sync.test.ts`.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // packages/waypoints/scripts
const repoRoot = resolve(here, '../../..'); // repo root
const coreSrc = resolve(here, '../src'); // packages/waypoints/src
const reactSrc = resolve(here, '../../waypoints-react/src'); // packages/waypoints-react/src

/** A transform or verification refused the input. Always fatal. */
export class SyncError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SyncError';
  }
}

export const identity = (s) => s;

/**
 * The React icon catalog imports the Anisota mark from the app's component
 * tree (`../components/AnisotaLogo`). In the package the logo sits next to the
 * catalog, so rewrite that one import. Everything else is copied verbatim.
 *
 * Global, and asserted on both ends: a canonical file that grows a second
 * import of the same module, renames the path, or switches to an alias must
 * fail here rather than produce a copy with an unresolvable import that
 * `--check` then blesses forever.
 */
const ANISOTA_IMPORT = /(from\s+['"])\.\.\/components\/AnisotaLogo(['"])/g;

export const rewriteAnisotaImport = (s) => {
  const out = s.replace(ANISOTA_IMPORT, "$1./AnisotaLogo$2");
  if (out === s) {
    throw new SyncError(
      "expected an import of '../components/AnisotaLogo' to rewrite, found none. " +
        'If the canonical file legitimately no longer imports it, update ' +
        'rewriteAnisotaImport in packages/waypoints/scripts/sync.mjs.',
    );
  }
  if (/\.\.\/components\//.test(out)) {
    throw new SyncError(
      "an import of '../components/…' survived the rewrite; the copy would " +
        'reach outside the package. Teach sync.mjs about the new import.',
    );
  }
  return out;
};

/**
 * Relative module specifiers in a TS/TSX source. Covers `import x from '…'`,
 * bare `import '…'`, `export … from '…'`, and dynamic `import('…')`.
 */
export function relativeImportsOf(source) {
  const specifiers = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]*)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) specifiers.push(m[1]);
  return specifiers;
}

/**
 * Closes the gap the hardcoded file list leaves open: sync.mjs guards exactly
 * the six paths below, so a canonical file that grows an import of a seventh
 * `src/utils/*` module copies over an import of a file that does not exist in
 * the package. Resolve every relative import against the destination and fail
 * if it lands nowhere.
 */
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];

export function assertImportsResolve(destPath, contents, fileExists = existsSync) {
  const destDir = dirname(destPath);
  const unresolved = relativeImportsOf(contents).filter((specifier) => {
    const base = resolve(destDir, specifier);
    return !RESOLVE_SUFFIXES.some((suffix) => fileExists(`${base}${suffix}`));
  });
  if (unresolved.length > 0) {
    throw new SyncError(
      `${unresolved.join(', ')} — imported by the copy but not present in the ` +
        'package. Add the missing module to the FILES list in ' +
        'packages/waypoints/scripts/sync.mjs, or drop the import from the ' +
        'canonical file.',
    );
  }
}

export const FILES = [
  // Zero-dependency core logic -> @aturi.to/waypoints
  {
    from: resolve(repoRoot, 'src/utils/waypoints.data.ts'),
    to: resolve(coreSrc, 'waypoints.data.ts'),
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

/**
 * Destinations this run writes. They count as present even on a first sync into
 * an empty package directory, so the import check does not depend on the order
 * of FILES (waypointIcons.tsx is copied before the AnisotaLogo.tsx it imports).
 */
const PLANNED_OUTPUTS = new Set(FILES.map((f) => f.to));

const defaultFileExists = (p) => existsSync(p) || PLANNED_OUTPUTS.has(p);

/**
 * Transform one canonical file into the exact bytes its copy must contain,
 * verifying the result. Throws `SyncError` with `file.from` named, so the guard
 * points at the canonical file the author actually edited — in `--check` mode
 * too, before any copy is written.
 */
export function expectedContentsFor(file, io = {}) {
  const readFile = io.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const fileExists = io.fileExists ?? defaultFileExists;
  const source = readFile(file.from);
  let out;
  try {
    out = file.transform(source);
    assertImportsResolve(file.to, out, fileExists);
  } catch (error) {
    if (error instanceof SyncError) {
      throw new SyncError(`${relative(repoRoot, file.from)}: ${error.message}`);
    }
    throw error;
  }
  return out;
}

const rel = (p) => relative(repoRoot, p);

function main(argv) {
  const check = argv.includes('--check');

  let drift = 0;
  for (const file of FILES) {
    if (!existsSync(file.from)) {
      console.error(`missing source: ${rel(file.from)}`);
      return 1;
    }
    let expected;
    try {
      expected = expectedContentsFor(file);
    } catch (error) {
      if (!(error instanceof SyncError)) throw error;
      console.error(error.message);
      return 1;
    }
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
      return 1;
    }
    console.log('All synced files are up to date.');
  }
  return 0;
}

// Only run the copy when invoked as a CLI, so the transforms above can be
// imported by tests without touching the filesystem.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

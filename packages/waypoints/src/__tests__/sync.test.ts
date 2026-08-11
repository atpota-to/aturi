import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `scripts/sync.mjs` is the drift guard for the generated copies in
 * `packages/*­/src`, and `--check` compares each copy against
 * `transform(canonical)` — which makes the transform definitionally correct.
 * Nothing tested the transform itself, so a canonical file that changed the one
 * import sync.mjs rewrites would produce a broken copy that `--check` then
 * certified as in-sync forever.
 *
 * These tests exercise the transform directly. The script is imported through a
 * runtime-built URL because it is a build script, not part of the package's
 * typed source graph — and importing it must have no side effects, which the
 * first test asserts.
 */

const SCRIPT_URL = new URL('../../scripts/sync.mjs', import.meta.url).href;
const SCRIPT_PATH = fileURLToPath(SCRIPT_URL);

type SyncModule = {
  SyncError: new (message: string) => Error;
  identity: (s: string) => string;
  rewriteAnisotaImport: (s: string) => string;
  relativeImportsOf: (s: string) => string[];
  assertImportsResolve: (
    destPath: string,
    contents: string,
    fileExists?: (p: string) => boolean,
  ) => void;
  expectedContentsFor: (
    file: { from: string; to: string; transform: (s: string) => string },
    io?: { readFile?: (p: string) => string; fileExists?: (p: string) => boolean },
  ) => string;
  FILES: { from: string; to: string; transform: (s: string) => string }[];
};

const sync: SyncModule = await import(/* @vite-ignore */ SCRIPT_URL);

const {
  SyncError,
  identity,
  rewriteAnisotaImport,
  relativeImportsOf,
  assertImportsResolve,
  expectedContentsFor,
  FILES,
} = sync;

describe('sync.mjs module shape', () => {
  it('is importable without running the copy', () => {
    // The CLI body is guarded on `process.argv[1]`; if that guard regresses,
    // importing this module would rewrite six files in the working tree.
    expect(typeof rewriteAnisotaImport).toBe('function');
    expect(FILES.length).toBeGreaterThan(0);
  });

  it('still guards every file it did before', () => {
    const relativePaths = FILES.map((f) => f.from.replace(/^.*\/aturi\//, ''));
    expect(relativePaths).toEqual([
      'src/utils/waypoints.data.ts',
      'src/utils/upstreamFetch.ts',
      'src/utils/uriParser.ts',
      'src/utils/reverseParsers.ts',
      'src/utils/waypointIcons.tsx',
      'src/components/AnisotaLogo.tsx',
    ]);
  });

  it('runs the CLI only when invoked as one', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    expect(source).toContain('process.argv[1]');
    expect(source).toContain('import.meta.url');
  });
});

describe('rewriteAnisotaImport', () => {
  const CANONICAL = [
    "import { type ReactNode } from 'react';",
    "import { AnisotaLogo } from '../components/AnisotaLogo';",
    '',
    'export const WAYPOINT_ICONS = {};',
    '',
  ].join('\n');

  it('rewrites the app-tree import to the sibling copy', () => {
    expect(rewriteAnisotaImport(CANONICAL)).toContain(
      "import { AnisotaLogo } from './AnisotaLogo';",
    );
  });

  it('leaves every other line byte-identical', () => {
    const out = rewriteAnisotaImport(CANONICAL).split('\n');
    const original = CANONICAL.split('\n');
    expect(out.filter((_, i) => i !== 1)).toEqual(original.filter((_, i) => i !== 1));
  });

  it('handles double quotes and extra whitespace', () => {
    expect(rewriteAnisotaImport('import x from   "../components/AnisotaLogo";')).toBe(
      'import x from   "./AnisotaLogo";',
    );
  });

  it('rewrites every occurrence, not just the first', () => {
    // The original was a non-global replace, so a canonical file with a second
    // import from the same module shipped a copy reaching outside the package
    // while `--check` reported everything in sync.
    const twoImports =
      "import { AnisotaLogo } from '../components/AnisotaLogo';\n" +
      "import { AnisotaMark } from '../components/AnisotaLogo';\n";
    const out = rewriteAnisotaImport(twoImports);
    expect(out).not.toContain('../components/');
    expect(out.match(/\.\/AnisotaLogo/g)).toHaveLength(2);
  });

  it('rewrites a re-export as well as an import', () => {
    expect(rewriteAnisotaImport("export * from '../components/AnisotaLogo';")).toBe(
      "export * from './AnisotaLogo';",
    );
  });

  it.each([
    ['the logo moves inside the app tree', "import x from '../components/brand/AnisotaLogo';"],
    ['the import becomes an alias path', "import x from '@/components/AnisotaLogo';"],
    ['the import is dropped entirely', "import { type ReactNode } from 'react';"],
  ])('fails loudly when %s', (_name, source) => {
    // Silently no-opping is the failure mode this whole file exists for: the
    // copy is written unchanged, and `--check` compares it against that same
    // unchanged output and reports success.
    expect(() => rewriteAnisotaImport(source)).toThrow(SyncError);
    expect(() => rewriteAnisotaImport(source)).toThrow(/sync\.mjs/);
  });

  it('fails when an app-tree import survives the rewrite', () => {
    const mixed =
      "import { AnisotaLogo } from '../components/AnisotaLogo';\n" +
      "import { Other } from '../components/Other';\n";
    expect(() => rewriteAnisotaImport(mixed)).toThrow(/survived the rewrite/);
  });
});

describe('relativeImportsOf', () => {
  it('finds imports, re-exports, side-effect imports, and dynamic imports', () => {
    const source = [
      "import { a } from './a';",
      "import type { B } from './types/b';",
      "import './side-effect';",
      "export * from './c';",
      "export { d } from './d';",
      "const e = await import('./e');",
      "import { far } from 'react';",
      "import { alias } from '@/utils/x';",
    ].join('\n');
    expect(relativeImportsOf(source)).toEqual([
      './a',
      './types/b',
      './side-effect',
      './c',
      './d',
      './e',
    ]);
  });

  it('returns nothing for a file with no relative imports', () => {
    expect(relativeImportsOf('export const x = 1;\n')).toEqual([]);
  });
});

describe('assertImportsResolve', () => {
  const dest = '/pkg/src/uriParser.ts';
  const present = (paths: string[]) => (p: string) => paths.includes(p);

  it('accepts an import that lands on a file in the package', () => {
    expect(() =>
      assertImportsResolve(
        dest,
        "import { upstreamFetch } from './upstreamFetch';",
        present(['/pkg/src/upstreamFetch.ts']),
      ),
    ).not.toThrow();
  });

  it('resolves an extensionless directory import through its index', () => {
    expect(() =>
      assertImportsResolve(
        dest,
        "import { x } from './lib';",
        present(['/pkg/src/lib/index.ts']),
      ),
    ).not.toThrow();
  });

  it('rejects a canonical file that grew an import sync.mjs does not copy', () => {
    // The structural gap the hardcoded FILES list leaves open: a seventh
    // `src/utils/*` module is invisible to --check until the package build
    // fails several steps later with a misdirected error.
    expect(() =>
      assertImportsResolve(
        dest,
        "import { ssrfGuard } from './ssrfGuard';",
        present(['/pkg/src/upstreamFetch.ts']),
      ),
    ).toThrow(/ssrfGuard/);
    expect(() =>
      assertImportsResolve(dest, "import { x } from './nope';", present([])),
    ).toThrow(/FILES list/);
  });

  it('ignores bare package specifiers', () => {
    expect(() =>
      assertImportsResolve(dest, "import { useState } from 'react';", present([])),
    ).not.toThrow();
  });
});

describe('expectedContentsFor', () => {
  it('names the canonical file when a transform refuses it', () => {
    // The guard has to point at the file the author edited, in --check mode as
    // well as during a copy — not at the stale copy downstream of it.
    const file = {
      from: '/repo/src/utils/waypointIcons.tsx',
      to: '/repo/packages/waypoints-react/src/waypointIcons.tsx',
      transform: rewriteAnisotaImport,
    };
    const io = {
      readFile: () => "import { type ReactNode } from 'react';\n",
      fileExists: () => true,
    };
    expect(() => expectedContentsFor(file, io)).toThrow(
      /src\/utils\/waypointIcons\.tsx: expected an import/,
    );
  });

  it('names the canonical file when a copied import resolves nowhere', () => {
    const file = {
      from: '/repo/src/utils/uriParser.ts',
      to: '/repo/packages/waypoints/src/uriParser.ts',
      transform: identity,
    };
    const io = {
      readFile: () => "import { ssrfGuard } from './ssrfGuard';\n",
      fileExists: () => false,
    };
    expect(() => expectedContentsFor(file, io)).toThrow(
      /src\/utils\/uriParser\.tsx?: \.\/ssrfGuard/,
    );
  });

  it('reproduces the real repo copies byte for byte', () => {
    // The end-to-end assertion: transform(canonical) must equal what is
    // checked in, which is exactly what `npm run sync:check` verifies.
    for (const file of FILES) {
      expect({ file: file.to, equal: expectedContentsFor(file) === readFileSync(file.to, 'utf8') })
        .toEqual({ file: file.to, equal: true });
    }
  });
});

describe('identity transform', () => {
  it('copies verbatim', () => {
    const source = 'export const x = 1;\n';
    expect(identity(source)).toBe(source);
  });
});

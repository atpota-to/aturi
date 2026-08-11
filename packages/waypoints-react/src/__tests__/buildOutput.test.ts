import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The three things about this package that are only true after `tsup` runs, and
 * that no amount of source-level checking can see.
 *
 * The "use client" directive is the load-bearing one: esbuild strips directives
 * while bundling, so scripts/postbuild.mjs prepends it back. If that step ever
 * regresses, the package still builds, still typechecks and still passes every
 * other test here — it just breaks at import time in every RSC consumer, which
 * is the entire audience for a "use client" package.
 *
 * dist/ is a build artifact and may legitimately be absent (fresh clone) or
 * stale, so these skip rather than fail when there is nothing to inspect. CI
 * runs the build before this suite, so there they always execute.
 */

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(PKG_ROOT, 'dist');

const BUNDLES = ['index.js', 'index.cjs'];
const hasDist = BUNDLES.every((f) => existsSync(join(DIST, f)));

/**
 * True when the first statement of the module — ignoring a byte-order mark and
 * leading whitespace, which is all that may precede a directive prologue — is
 * the `"use client"` directive. A match anywhere else in the file (inside a
 * string, a comment, or after an import) does not count.
 */
function startsWithUseClient(code: string): boolean {
  return /^﻿?\s*(['"])use client\1\s*;?/.test(code);
}

describe.skipIf(!hasDist)('build output', () => {
  it.each(BUNDLES)('dist/%s opens with the "use client" directive', (file) => {
    const code = readFileSync(join(DIST, file), 'utf8');
    expect(code).not.toBe('');
    expect(startsWithUseClient(code)).toBe(true);
  });

  it('ships dist/styles.css with the themeable custom properties', () => {
    const css = readFileSync(join(DIST, 'styles.css'), 'utf8');
    expect(css).toContain('--aturi-wp-accent');
    expect(css).toContain('.aturi-wp');
  });

  it('resolves every path named in package.json exports', () => {
    const pkg = JSON.parse(
      readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };

    const paths: string[] = [];
    const walk = (node: unknown) => {
      if (typeof node === 'string') {
        paths.push(node);
        return;
      }
      if (node && typeof node === 'object') {
        Object.values(node as Record<string, unknown>).forEach(walk);
      }
    };
    walk(pkg.exports);

    expect(paths.length).toBeGreaterThan(0);
    const missing = paths.filter((p) => !existsSync(join(PKG_ROOT, p)));
    expect(missing).toEqual([]);
  });
});

describe('build output guard', () => {
  it('checks the real directive detector against known-bad shapes', () => {
    // Keeps the skip-when-absent path above honest: if the detector itself
    // rotted into something that matches anything, this fails even on a clone
    // with no dist/.
    expect(startsWithUseClient('"use client";\nimport x from "y";')).toBe(true);
    expect(startsWithUseClient("'use client';\n")).toBe(true);
    expect(startsWithUseClient('﻿"use client";')).toBe(true);
    expect(startsWithUseClient('import x from "y";\n"use client";')).toBe(false);
    expect(startsWithUseClient('// "use client"\nimport x from "y";')).toBe(
      false,
    );
    expect(startsWithUseClient('"use strict";\n"use client";')).toBe(false);
    expect(startsWithUseClient('')).toBe(false);
  });
});

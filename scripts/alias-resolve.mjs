/**
 * Node ESM resolve hook mapping the `@/…` path alias to `src/…`.
 *
 * tsconfig.json defines `@/*` → `./src/*`, which Next resolves at build time.
 * Node's own loader knows nothing about it, so importing a `src/lib` module
 * straight from `node --test` fails on the first aliased import. This teaches
 * the loader the same mapping, and supplies the extension TypeScript lets
 * source files omit.
 *
 * Relative specifiers inside src/ get the same extension probing: production
 * modules import siblings as `../didResolver` (no extension), which Next
 * resolves but Node's loader rejects, so any test that transitively touches
 * those modules would fail without it. Specifiers outside src/, bare package
 * names, and built-ins pass straight through.
 */
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC_ROOT = pathToFileURL(`${resolvePath(process.cwd(), 'src')}/`).href;
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

export async function resolve(specifier, context, nextResolve) {
  const isAlias = specifier.startsWith('@/');
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (!isAlias && !isRelative) return nextResolve(specifier, context);

  let base;
  if (isAlias) {
    base = new URL(specifier.slice(2), SRC_ROOT).href;
  } else {
    if (!context.parentURL?.startsWith(SRC_ROOT)) {
      return nextResolve(specifier, context);
    }
    base = new URL(specifier, context.parentURL).href;
  }

  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(candidate, context);
    }
  }
  return nextResolve(isAlias ? base : specifier, context);
}

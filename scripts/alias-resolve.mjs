/**
 * Node ESM resolve hook mapping the `@/…` path alias to `src/…`.
 *
 * tsconfig.json defines `@/*` → `./src/*`, which Next resolves at build time.
 * Node's own loader knows nothing about it, so importing a `src/lib` module
 * straight from `node --test` fails on the first aliased import. This teaches
 * the loader the same mapping, and supplies the extension TypeScript lets
 * source files omit.
 */
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC_ROOT = pathToFileURL(`${resolvePath(process.cwd(), 'src')}/`).href;
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('@/')) return nextResolve(specifier, context);

  const base = new URL(specifier.slice(2), SRC_ROOT).href;
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(candidate, context);
    }
  }
  return nextResolve(base, context);
}

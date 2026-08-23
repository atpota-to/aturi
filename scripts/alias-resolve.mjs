/**
 * Node ESM resolve hook for `npm test`.
 *
 * Two things TypeScript allows and Node's loader does not:
 *
 *   - the `@/…` alias. tsconfig.json defines `@/*` → `./src/*`, which Next
 *     resolves at build time; Node knows nothing about it.
 *   - a relative import with no file extension (`./scopes`). Node requires
 *     `./scopes.ts`; TypeScript and Next do not.
 *
 * Both are resolved the same way: try the candidate with each extension the
 * project uses and take the first that exists. Without the second, a test can
 * only reach modules whose entire import graph happens to use the alias — a
 * limit that is invisible until a test imports a module that doesn't.
 */
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC_ROOT = pathToFileURL(`${resolvePath(process.cwd(), 'src')}/`).href;
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/** First candidate that exists on disk, else null. */
function firstExisting(base) {
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = new URL(specifier.slice(2), SRC_ROOT).href;
    return nextResolve(firstExisting(base) ?? base, context);
  }

  // Extensionless relative imports, resolved against the importing file.
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    if (/\.[a-z]+$/i.test(specifier) || !context.parentURL) {
      return nextResolve(specifier, context);
    }
    const found = firstExisting(new URL(specifier, context.parentURL).href);
    if (found) return nextResolve(found, context);
  }

  return nextResolve(specifier, context);
}

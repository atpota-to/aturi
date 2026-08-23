/**
 * Node ESM resolve hook for `npm test`.
 *
 * Two gaps between how the source is written and what Node's loader accepts:
 *
 *  - tsconfig.json defines `@/*` → `./src/*`, which Next resolves at build
 *    time. Node knows nothing about it, so the first aliased import fails.
 *  - TypeScript lets a relative import omit the file extension. Node's ESM
 *    loader requires it, so a module under test that imports a sibling with
 *    `./thing` fails even though the alias is not involved.
 *
 * Both are handled by supplying the extension TypeScript left off.
 */
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC_ROOT = pathToFileURL(`${resolvePath(process.cwd(), 'src')}/`).href;
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/** First `base` + extension that exists on disk, or null. */
function withExtension(base) {
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = new URL(specifier.slice(2), SRC_ROOT).href;
    return nextResolve(withExtension(base) ?? base, context);
  }

  // Relative sibling imports. Only consulted when Node's own resolution
  // fails, so an import that already names its extension is untouched.
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (!context.parentURL) throw err;
      const resolved = withExtension(new URL(specifier, context.parentURL).href);
      if (!resolved) throw err;
      return nextResolve(resolved, context);
    }
  }

  return nextResolve(specifier, context);
}

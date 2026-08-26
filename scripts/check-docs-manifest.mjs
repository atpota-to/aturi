/**
 * Verify every manifest entry still resolves upstream.
 *
 * The documentation tools rank against a committed index and fetch bodies at
 * request time, so a page renamed upstream turns into a search hit whose body
 * will not load. Nothing in the offline test suite can catch that. Run this
 * when upstream has moved, or on a schedule:
 *
 *   node scripts/check-docs-manifest.mjs
 *
 * Exits non-zero if anything 404s, and names what to regenerate.
 */
import { readFileSync } from 'node:fs';

function entriesFrom(file, key) {
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf('= [');
  return JSON.parse(src.slice(start + 2, src.lastIndexOf('];') + 1)).map((e) => ({
    id: e[key],
    raw: e.raw,
    url: e.url,
  }));
}

const entries = [
  ...entriesFrom('src/lib/mcp/docsManifest.ts', 'id'),
  ...entriesFrom('src/lib/mcp/apiManifest.ts', 'nsid'),
];
console.log(`checking ${entries.length} manifest entries…`);

const broken = [];
const CONCURRENCY = 8;
let cursor = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const entry = entries[cursor++];
      if (!entry) return;
      try {
        const res = await fetch(entry.raw, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
        if (!res.ok) broken.push({ ...entry, status: res.status });
      } catch (err) {
        broken.push({ ...entry, status: err.name });
      }
    }
  }),
);

if (!broken.length) {
  console.log('all entries resolve.');
  process.exit(0);
}
console.error(`\n${broken.length} entr${broken.length === 1 ? 'y' : 'ies'} no longer resolve:`);
for (const b of broken) console.error(`  [${b.status}] ${b.id}\n         ${b.raw}`);
console.error('\nRegenerate with scripts/build-docs-manifest.mjs against fresh clones.');
process.exit(1);

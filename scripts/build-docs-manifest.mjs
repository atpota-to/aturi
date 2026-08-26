/**
 * Regenerate the manifests the documentation tools search.
 *
 * The tools fetch page and lexicon bodies from raw.githubusercontent.com at
 * request time, so nothing here is a cache of content. What it builds is the
 * index: the titles, descriptions and headings needed to rank a query without
 * fetching a hundred pages first, and the nsid/type/description of every
 * lexicon. Those change when upstream adds or renames a page, which is rare
 * and worth a deliberate commit rather than a live crawl.
 *
 * Usage, with the three upstream repos cloned somewhere:
 *
 *   node scripts/build-docs-manifest.mjs \
 *     --website  /path/to/atproto-website \
 *     --bskydocs /path/to/bsky-docs \
 *     --atproto  /path/to/atproto
 *
 * Writes src/lib/mcp/docsManifest.ts and src/lib/mcp/apiManifest.ts.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
for (const key of ['website', 'bskydocs', 'atproto']) {
  if (!args[key]) {
    console.error(`Missing --${key}. See the usage comment at the top of this file.`);
    process.exit(1);
  }
}

const RAW = 'https://raw.githubusercontent.com';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Section headings, which carry most of a page's searchable vocabulary. Both
 * levels: atproto.com's specs head their sections with ###, docs.bsky.app
 * uses ##, and a query should reach either.
 */
function headings(body, max = 14) {
  return [...body.matchAll(/^#{2,3}\s+(.+?)\s*$/gm)]
    .map((m) => m[1].replace(/\{\{.*?\}\}/g, '').replace(/[#*`]/g, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function clean(text, max = 220) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// --- atproto.com: specs and guides. Blog and off-protocol posts are dated
// --- announcements rather than reference material, so they stay out: a
// --- newcomer asking how OAuth works wants the spec, not a 2024 changelog.
const docs = [];
const websiteRoot = join(args.website, 'src/app/[locale]');
for (const file of walk(websiteRoot).filter((f) => f.endsWith('/en.mdx'))) {
  const slug = relative(websiteRoot, file).replace(/\/en\.mdx$/, '');
  if (!/^(specs|guides)\//.test(slug)) continue;
  const body = readFileSync(file, 'utf8');
  const header = body.match(/export const header = \{([\s\S]*?)\n\}/);
  const title = header?.[1].match(/title:\s*'([^']*)'|title:\s*"([^"]*)"/);
  const desc = header?.[1].match(/description:\s*\n?\s*'([^']*)'|description:\s*\n?\s*"([^"]*)"/);
  docs.push({
    id: slug,
    source: 'atproto',
    title: clean(title?.[1] ?? title?.[2] ?? slug, 120),
    description: clean(desc?.[1] ?? desc?.[2] ?? ''),
    url: `https://atproto.com/${slug}`,
    raw: `${RAW}/bluesky-social/atproto-website/main/src/app/%5Blocale%5D/${slug}/en.mdx`,
    headings: headings(body),
  });
}

// --- docs.bsky.app: Docusaurus, so the title is the first H1 rather than
// --- frontmatter, and the URL keeps the /docs prefix.
const bskyRoot = join(args.bskydocs, 'docs');
for (const file of walk(bskyRoot).filter((f) => ['.md', '.mdx'].includes(extname(f)))) {
  const slug = relative(bskyRoot, file).replace(/\.mdx?$/, '');
  const body = readFileSync(file, 'utf8');
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  const prose = body
    .replace(/^---[\s\S]*?---/, '')
    .replace(/^import .*$/gm, '')
    .replace(/^#.*$/gm, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 40 && !l.startsWith('<') && !l.startsWith(':'));
  docs.push({
    id: `bsky/${slug}`,
    source: 'bsky',
    title: clean(h1?.[1] ?? slug, 120),
    description: clean(prose ?? ''),
    url: `https://docs.bsky.app/docs/${slug}`,
    raw: `${RAW}/bluesky-social/bsky-docs/main/docs/${relative(bskyRoot, file)}`,
    headings: headings(body),
  });
}
docs.sort((a, b) => a.id.localeCompare(b.id));

// --- Lexicons: the API definition itself.
const api = [];
const lexRoot = join(args.atproto, 'lexicons');
for (const file of walk(lexRoot).filter((f) => f.endsWith('.json'))) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    continue;
  }
  if (!doc.id) continue;
  const main = doc.defs?.main;
  // A lexicon without a `main` def is a shared type file (app.bsky.actor.defs
  // and friends). Those are looked up constantly, so index them too, with
  // their def names standing in for the fields a method would have.
  const defNames = Object.keys(doc.defs ?? {}).filter((k) => k !== 'main');
  api.push({
    nsid: doc.id,
    type: main?.type ?? 'defs',
    description: clean(main?.description ?? doc.description ?? '', 300),
    params: Object.keys(main?.parameters?.properties ?? {}),
    inputProps: Object.keys(main?.input?.schema?.properties ?? {}),
    recordProps: Object.keys(main?.record?.properties ?? {}),
    defs: defNames,
    errors: (main?.errors ?? []).map((e) => e.name),
    raw: `${RAW}/bluesky-social/atproto/main/lexicons/${relative(lexRoot, file)}`,
  });
}
api.sort((a, b) => a.nsid.localeCompare(b.nsid));

const stamp = new Date().toISOString().slice(0, 10);
const banner = (what, count) => `/**
 * ${what}
 *
 * GENERATED by scripts/build-docs-manifest.mjs. Do not hand-edit: regenerate
 * it when upstream adds or renames pages. ${count} entries, last built ${stamp}.
 *
 * This is an index, not a copy: bodies are fetched from the raw CDN at request
 * time so answers track upstream, while ranking a query stays local.
 */
`;

writeFileSync(
  'src/lib/mcp/docsManifest.ts',
  `${banner('Documentation pages on atproto.com and docs.bsky.app.', docs.length)}
export type DocSource = 'atproto' | 'bsky';

export type DocPage = {
  /** Stable id a caller passes to read_atproto_doc. */
  id: string;
  source: DocSource;
  title: string;
  description: string;
  /** The public page, for citation. */
  url: string;
  /** Where the Markdown actually comes from. */
  raw: string;
  headings: string[];
};

export const DOC_PAGES: DocPage[] = ${JSON.stringify(docs, null, 2)};
`,
);

writeFileSync(
  'src/lib/mcp/apiManifest.ts',
  `${banner('Every lexicon in bluesky-social/atproto: the XRPC and record definitions.', api.length)}
export type ApiMethod = {
  nsid: string;
  /** query, procedure, record, subscription, or an object-only lexicon. */
  type: string;
  description: string;
  /** Query-string parameters, for a query or subscription. */
  params: string[];
  /** Request-body fields, for a procedure. */
  inputProps: string[];
  /** Record fields, for a record type. */
  recordProps: string[];
  /** Named defs beside main, which is all a shared type file has. */
  defs: string[];
  errors: string[];
  raw: string;
};

export const API_METHODS: ApiMethod[] = ${JSON.stringify(api, null, 2)};
`,
);

console.log(`docs: ${docs.length} pages (${docs.filter((d) => d.source === 'atproto').length} atproto, ${docs.filter((d) => d.source === 'bsky').length} bsky)`);
console.log(`api:  ${api.length} lexicons`);

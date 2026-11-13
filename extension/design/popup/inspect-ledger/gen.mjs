// Builds body.html from ../data.json so every fixture string is exact and
// the folding rule is code: hits that share a URI merge into one record;
// the one the page declares canonical or that the address bar resolves to
// is the page's own record, the rest are filed in the drawer below it.
//
//   node gen.mjs            writes body.html (the 7-hit mockup)
//                           and body-one.html, body-forty.html,
//                           body-profile.html for stress.mjs
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const data = JSON.parse(fs.readFileSync(path.join(here, '..', 'data.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICON = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
};
const svg = (name, size = 14, cls = '') =>
  `<svg${cls ? ` class="${cls}"` : ''} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

// ---------- Folding ----------

function fold(hits) {
  const byUri = new Map();
  for (const h of hits) {
    if (!byUri.has(h.uri)) byUri.set(h.uri, { ...h, sightings: [] });
    byUri.get(h.uri).sightings.push(h);
  }
  const records = [...byUri.values()];
  const isOwn = (r) => r.sightings.some((s) => s.where === 'url' || s.relation === 'canonical');
  const own = records.find(isOwn) ?? records[0];
  return { own, others: records.filter((r) => r !== own) };
}

// The provenance sentence under the title: how the page declared it, then
// the other ways it was found.
function provenance(own) {
  const rel = own.sightings.find((s) => s.relation);
  const rest = own.sightings.filter((s) => s !== rel).map((s) => data.whereLabels[s.where]);
  const parts = [];
  if (rel) parts.push(`Declared by the page as ${rel.relation}`);
  for (const w of rest) parts.push(parts.length ? `also ${w.charAt(0).toLowerCase()}${w.slice(1)}` : w);
  return parts.join(' · ');
}

// ---------- Display forms ----------
// The clipboard always takes the full string (data-copy). The row shows a
// form the eye can use: a DID or CID keeps both ends; a handle or host can
// break before a dot; a path (AT URI, aturi.to link) breaks at its slashes
// and carries its own hierarchy: the repo part quiet, the record's own
// identifiers in ink.

const mid = (s, tailLen) =>
  `<span class="fi-mid"><span class="fi-mid-head">${esc(s.slice(0, -tailLen))}</span><span class="fi-mid-tail">${esc(s.slice(-tailLen))}</span></span>`;

// A Bluesky-hosted PDS breaks only before its generic ".host.bsky.network"
// suffix; any other host or a handle may break before any dot.
const dots = (s) =>
  /\.host\.bsky\.network$/.test(s)
    ? esc(s).replace(/\.host\.bsky\.network$/, '<wbr>.host.bsky.network')
    : esc(s).replace(/\./g, '<wbr>.');

const dim = (s) => `<span class="fi-dim">${esc(s)}</span>`;
const sep = (s) => `<span class="fi-sep">${esc(s)}</span>`;
const id = (s) => `<span class="fi-id">${esc(s)}</span>`;

const atUri = (r) =>
  r.collection
    ? `${dim('at://' + r.did)}${sep('/')}<wbr><span class="fi-coll">${esc(r.collection)}</span>${sep('/')}<wbr>${id(r.rkey)}`
    : `${dim('at://')}${id(r.did)}`;

const link = (r) => {
  const bare = r.universalLink.replace(/^https:\/\//, '');
  const [host, profile, handle, ...rest] = bare.split('/');
  if (!rest.length) return `${dim(host + '/' + profile + '/')}<wbr>${id(handle)}`;
  const [kind, rkey] = rest;
  return `${dim(host + '/' + profile + '/')}<wbr>${id(handle)}${dim('/')}<wbr>${dim(kind + '/')}${id(rkey)}`;
};

// ---------- Ledger ----------

const glyph = () =>
  `<span class="fi-glyph" aria-hidden="true">${svg('copy', 14, 'fi-glyph-copy')}${svg('check', 14, 'fi-glyph-done')}</span>`;

const row = ({ label, name = label, value, copies, cls = '', path = false, copied = false, title = null }) =>
  `<button type="button" class="fi-row${path ? ' is-path' : ''}${copied ? ' is-copied' : ''}" data-copy="${esc(copies)}" aria-label="Copy ${esc(name)}">` +
  `<span class="fi-label"><span class="fi-label-text">${esc(label)}</span><span class="fi-label-done">Copied</span></span>` +
  `<span class="fi-value${cls ? ' ' + cls : ''}"${title ? ` title="${esc(title)}"` : ''}>${value}</span>` +
  glyph() +
  `</button>`;

function ledger(r, { nested = false, copied = null, indent = '' }) {
  const rows = [
    row({ label: 'AT URI', value: atUri(r), copies: r.uri, path: true, cls: 'is-path', copied: copied === 'uri' }),
    row({ label: 'DID', value: mid(r.did, 6), copies: r.did, copied: copied === 'did', title: r.did }),
    row({ label: 'Handle', value: dots(r.handle), copies: r.handle, cls: 'is-dots', copied: copied === 'handle' }),
    row({ label: 'PDS', name: 'PDS host', value: dots(r.pdsHost), copies: r.pdsHost, cls: 'is-dots', copied: copied === 'pds' }),
    r.cid ? row({ label: 'CID', value: mid(r.cid, 6), copies: r.cid, copied: copied === 'cid', title: r.cid }) : null,
    row({ label: 'Link', name: 'aturi.to link', value: link(r), copies: r.universalLink, path: true, cls: 'is-path', copied: copied === 'link' }),
  ].filter(Boolean);
  const who = nested ? ` for ${r.handle}’s ${r.kind.toLowerCase()}` : '';
  return `${indent}<div class="fi-ledger${nested ? ' is-nested' : ''}" role="group" aria-label="Identifiers${who}. Each row copies its value.">\n${rows.map((x) => indent + '  ' + x).join('\n')}\n${indent}</div>`;
}

const hintFor = (r) => (r.collection ? 'record, PDS, raw JSON, links in' : 'profile, PDS, collections');

const band = (r) =>
  `<a class="inspect-cta fi-cta" href="${esc(r.explorer)}" target="_blank" rel="noopener">${svg('compass', 14)}<span class="fi-cta-text">Open on aturi.to</span><span class="fi-cta-hint">${esc(hintFor(r))}</span><span class="fi-glyph" aria-hidden="true">${svg('ext')}</span></a>`;

// ---------- The page's record ----------

function card(own) {
  const title = own.collection
    ? `${esc(own.kind)} <span class="fi-title-by">by</span> ${esc(own.handle)}`
    : `${esc(own.kind)} <span class="fi-title-by">·</span> ${esc(own.handle)}`;
  return `  <section class="popup-section is-sheet fi-lead">
    <h2 class="popup-section-label is-highlighted">This page</h2>
    <button type="button" class="inspect-rescan fi-rescan">${svg('refresh')}Scan again</button>

    <article class="fi-card" aria-labelledby="fi-title">
      <header class="fi-head">
        <h3 class="fi-title" id="fi-title">${title}</h3>
        <p class="fi-declared">${esc(provenance(own))}</p>
      </header>

${ledger(own, { copied: 'did', indent: '      ' })}

      ${band(own)}
    </article>
  </section>`;
}

// ---------- The drawer ----------

function ref(r, { open = false, showKind = false }) {
  const kind = showKind ? `<span class="fi-ref-kind">${esc(r.kind)}</span>` : '';
  const rkey = r.rkey ? `<span class="fi-ref-rkey">${esc(r.rkey)}</span>` : '';
  const srcTitle = data.whereLabels[r.where] ?? '';
  return `      <li class="fi-ref${open ? ' is-open' : ''}">
        <div class="fi-ref-head">
          <button type="button" class="fi-ref-main" aria-expanded="${open}" aria-controls="fi-ref-${r.n}" title="${esc(srcTitle)}">${svg('chevron', 14, 'fi-ref-chev')}<span class="fi-ref-handle">${esc(r.handle)}</span>${kind}${rkey}</button>
          <button type="button" class="popup-waypoint-copy fi-ref-copy" data-copy="${esc(r.uri)}" aria-label="Copy AT URI for ${esc(r.handle)}’s ${esc(r.kind.toLowerCase())}">${svg('copy')}</button>
        </div>
        <div class="fi-ref-body" id="fi-ref-${r.n}"${open ? '' : ' hidden'}>
${ledger(r, { nested: true, indent: '          ' })}
          <a class="fi-ref-open" href="${esc(r.explorer)}" target="_blank" rel="noopener">${svg('compass')}<span>Open on aturi.to</span><span class="fi-glyph" aria-hidden="true">${svg('ext')}</span></a>
        </div>
      </li>`;
}

function drawer(others, { openN = null, cap = 8 }) {
  if (!others.length) return '';
  const kinds = new Set(others.map((r) => r.kind));
  const showKind = kinds.size > 1;
  const shown = others.slice(0, cap);
  const more = others.length - shown.length;
  const moreRow = more > 0
    ? `\n      <li class="fi-ref"><button type="button" class="fi-ref-more" aria-expanded="false">${svg('chevronDown', 14, 'fi-ref-chev')}Show ${more} more</button></li>`
    : '';
  return `

  <section class="popup-section is-sheet">
    <h2 class="popup-section-label">Also on this page · ${others.length}</h2>
    <ul class="popup-waypoints fi-refs">
${shown.map((r) => ref(r, { open: r.n === openN, showKind })).join('\n')}${moreRow}
    </ul>
  </section>`;
}

// ---------- Assembly ----------

function body({ own, others, openN = null, cap = 8, note }) {
  const count = 1 + others.length;
  return `<!-- ${note} Generated by gen.mjs from ../data.json. -->
<div class="popup-root inspect-root fi-root">
  <div class="fi-live" aria-live="polite"></div>

${card(own)}${drawer(others, { openN, cap })}

</div>
<script>
  /* Stands in for the frame change that ships with this: the Inspect badge
     counts distinct URIs after folding (${count}), not raw hits. */
  document.querySelector('.popup-mode-tab-badge').textContent = '${count}';
</script>
`;
}

const { own, others } = fold(data.hits);

// The mockup: 7 hits, hits 1 and 2 folded, the DID row copied, the
// @bjkeefe.bsky.social reference (hit 4) open.
fs.writeFileSync(path.join(here, 'body.html'), body({ own, others, openN: 4, note: 'Inspect tab: the 7-hit fixture. Mock states: the DID row is copied, hit 4 is open.' }));

// Stress variants (not the deliverable).
fs.writeFileSync(path.join(here, 'body-one.html'), body({ own, others: [], note: 'Stress: one hit (hits 1 and 2 only).' }));

const forty = Array.from({ length: 39 }, (_, i) => ({ ...others[i % others.length], n: 100 + i }));
fs.writeFileSync(path.join(here, 'body-forty.html'), body({ own, others: forty, note: 'Stress: 40 hits (the five real references repeated).' }));

const profileOwn = {
  ...own,
  uri: `at://${own.did}`,
  collection: null, rkey: null, cid: null, kind: 'Profile',
  universalLink: `https://aturi.to/profile/${own.handle}`,
  explorer: `https://aturi.to/explore/${own.handle}`,
  sightings: [{ where: 'url' }],
};
// One reference is a profile too, so the drawer's kinds are mixed and the
// rows show them.
const profileRefs = others.map((r, i) => i === 0
  ? { ...r, uri: `at://${r.did}`, collection: null, rkey: null, cid: null, kind: 'Profile', universalLink: `https://aturi.to/profile/${r.handle}`, explorer: `https://aturi.to/explore/${r.handle}` }
  : r);
fs.writeFileSync(path.join(here, 'body-profile.html'), body({ own: profileOwn, others: profileRefs, openN: 3, note: 'Stress: a profile page (no rkey, no record); the first reference is a profile too.' }));

console.log('wrote body.html (+ one, forty, profile)');

// Writes post.html and nopage.html for the "one sheet" model from the shared
// fixtures (waypoints.json, data.json, icons.json). node build.mjs
import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const W = path.resolve(here, '..');
const wp = JSON.parse(fs.readFileSync(path.join(W, 'waypoints.json'), 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(W, 'data.json'), 'utf8'));
const icons = JSON.parse(fs.readFileSync(path.join(W, 'icons.json'), 'utf8'));

const ICON_KEY = { pinkleap: 'pinksky', 'anisota-reader': 'anisotaReader', 'standard-reader': 'standardReader', 'aturi-explore': 'aturiExplore', 'atp-tools': 'atptools' };
const mark = (id) => { const e = icons[ICON_KEY[id] || id]; if (!e) throw new Error('no icon ' + id); return `<span class="popup-waypoint-icon">${e.svg}</span>`; };

const G = (paths, size = 14, sw = 2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const g = {
  leaf: G('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>', 20, 2.2),
  sliders: G('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>', 17),
  copy: (s = 14) => G('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', s),
  check: (s = 14) => G('<path d="M20 6 9 17l-5-5"/>', s),
  external: (s = 14) => G('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', s),
  compass: (s = 14) => G('<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>', s),
  chevronRight: (s = 14) => G('<path d="m9 18 6-6-6-6"/>', s),
  refresh: (s = 13) => G('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>', s),
  search: (s = 14) => G('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', s),
  shuffle: (s = 15) => G('<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>', s),
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- shared regions ----------
const topbar = (redirectOn) => `  <header class="popup-topbar" data-sticky>
    <div class="popup-title">${g.leaf}<span>aturi</span></div>
    <div class="popup-topbar-actions">
      <a class="popup-icon-btn os-topbar-redirect" href="#auto-redirect" aria-label="Auto-redirect is on; go to its row"${redirectOn ? '' : ' hidden'}>${g.shuffle(16)}</a>
      <button type="button" class="popup-icon-btn" aria-label="Open extension settings">${g.sliders}</button>
    </div>
  </header>`;

const redirectRow = (on) => `  <footer id="auto-redirect" class="popup-redirect os-redirect${on ? ' is-on' : ''}">
    ${g.shuffle(15).replace('<svg ', '<svg class="popup-redirect-icon" ')}
    <span class="popup-redirect-label"><span class="popup-redirect-title">Auto-redirect</span>${on ? '<span class="popup-redirect-sub">Posts open in Anisota</span>' : ''}</span>
    ${on ? '<button type="button" class="popup-redirect-pause">Pause on this tab</button>' : ''}
    <button type="button" role="switch" aria-checked="${on ? 'true' : 'false'}" class="aturi-switch aturi-switch-sm${on ? ' on' : ''}" aria-label="Auto-redirect"><span class="popup-redirect-state">${on ? 'On' : 'Off'}</span><span class="aturi-switch-box" aria-hidden="true"></span></button>
  </footer>`;

// ---------- waypoint rows ----------
const DESC = {
  anisota: 'View post on anisota.net', blacksky: 'View post on blacksky.community',
  bluepy: 'View post on bluepy.social', reddwarf: 'View post on reddwarf.app', impro: 'View post on impro.social', lea: 'View post on lea.ac',
  witchsky: 'View post on witchsky.app', mu: 'View post on mu.social', deer: 'View post on deer.social', northsky: 'View post on northsky.app',
  leaflet: 'View profile on leaflet.pub', 'anisota-reader': 'View publications on anisota.net', offprint: 'View on offprint.app', pckt: 'View on pckt.blog', 'standard-reader': 'View documents on standard-reader.app',
  aturi: 'View post on aturi.to', pinkleap: 'View post on pinkleap.app', margin: 'View profile on margin.at', streamplace: 'View profile on stream.place', grain: 'View profile on grain.social', popfeed: 'View profile on popfeed.social', tangled: 'View profile on tangled.org',
  'aturi-explore': 'Inspect record on aturi.to/explore', pdsls: 'View raw record on pdsls.dev', 'atp-tools': 'View raw record on atp.tools', taproot: 'Inspect record on atproto.at',
};
const wprow = ([id, name, host, absent], descOverride) => {
  const desc = descOverride ?? (absent ? 'No records found on this repo' : DESC[id]);
  return `      <div class="popup-waypoint${absent ? ' is-absent' : ''}">
        <button type="button" class="popup-waypoint-main">${mark(id)}<span class="popup-waypoint-name">${esc(name)}</span><span class="popup-waypoint-desc">${esc(desc)}</span></button>
        <button type="button" class="popup-waypoint-copy" aria-label="Copy ${esc(name)} link">${g.copy(14)}</button>
      </div>`;
};
const group = (label, items, highlighted = false) => `    <section class="popup-section is-sheet">
      <h2 class="popup-section-label${highlighted ? ' is-highlighted' : ''}">${esc(label)}</h2>
      <div class="popup-waypoints">
${items.map((it) => wprow(it)).join('\n')}
      </div>
    </section>`;

// ---------- post page ----------
const hit = data.hits[0];
const refs = data.hits.slice(2);
const idRow = ({ label, head, tail, plain, wrap, copied, aria }) => `        <li><button type="button" class="os-id${copied ? ' is-copied' : ''}${wrap ? ' is-tall' : ''}" aria-label="${esc(aria)}"${copied ? ' aria-live="polite"' : ''}>
          <span class="os-id-label">${copied ? 'Copied' : label}</span>
          ${plain ? `<span class="os-id-value is-plain">${esc(plain)}</span>` : wrap ? `<span class="os-id-value is-wrap">${wrap.map((seg, i) => (i < wrap.length - 1 ? esc(seg) + '<wbr>' : `<span class="os-id-tail">${esc(seg)}</span>`)).join('')}</span>` : `<span class="os-id-value"><span class="os-id-head">${esc(head)}</span><span class="os-id-tail">${esc(tail)}</span></span>`}
          <span class="os-id-glyph">${copied ? g.check(14) : g.copy(14)}</span>
        </button></li>`;

const cidHead = hit.cid.slice(0, -6), cidTail = hit.cid.slice(-6);
const post = `<div class="popup-shell">
${topbar(false)}
  <main class="popup-body">
    <div class="popup-root os-root">
    <section class="os-card" aria-label="This page">
      <div class="os-card-head">
        <span class="popup-page-avatar" aria-hidden="true">D</span>
        <div class="popup-page-text">
          <span class="popup-page-title">Post by dame.is</span>
          <span class="popup-page-meta"><span class="popup-source-collection">app.bsky.feed.post</span> · declared by the page</span>
        </div>
      </div>
      <ul class="os-ledger" aria-label="Identifiers; each line copies">
${idRow({ label: 'AT URI', wrap: [`at://${hit.did}`, `/${hit.collection}`, `/${hit.rkey}`], aria: 'Copy AT URI' })}
${idRow({ label: 'Link', wrap: ['aturi.to/profile/dame.is', '/post', `/${hit.rkey}`], aria: 'Copy aturi.to link' })}
${idRow({ label: 'DID', plain: hit.did, copied: true, aria: 'Copy DID (copied)' })}
${idRow({ label: 'Handle', plain: hit.handle, aria: 'Copy handle' })}
${idRow({ label: 'PDS', plain: hit.pdsHost, aria: 'Copy PDS host' })}
${idRow({ label: 'CID', head: cidHead, tail: cidTail, aria: 'Copy CID' })}
      </ul>
      <a class="os-cta" href="${esc(hit.universalLink)}" target="_blank" rel="noopener">${g.compass(15)}<span>Open on aturi.to</span><span class="os-cta-sub">record · raw JSON · PDS · links in</span>${g.external(14)}</a>
    </section>
${group(wp.post.recommended.label, wp.post.recommended.items, true)}
${wp.post.groups.map((gr) => group(gr.label, gr.items)).join('\n')}
    <section class="popup-section is-sheet os-filed">
      <h2 class="popup-section-label">Also on this page · ${refs.length}</h2>
      <details class="os-drawer">
        <summary class="os-drawer-front">${g.chevronRight(14).replace('<svg ', '<svg class="os-drawer-chevron" ')}<span class="os-drawer-front-text">Posts this page refers to</span><span class="os-drawer-preview">${esc(refs.map((r) => r.handle).join(', '))}</span></summary>
${refs.map((r) => `        <div class="os-ref">
          <a class="os-ref-main" href="${esc(r.universalLink)}" target="_blank" rel="noopener" title="Open on aturi.to"><span class="os-ref-handle">${esc(r.handle)}</span><span class="os-ref-preview">${esc(r.preview)}</span></a>
          <button type="button" class="popup-waypoint-copy" aria-label="Copy AT URI of ${esc(r.handle)}’s post">${g.copy(14)}</button>
        </div>`).join('\n')}
      </details>
    </section>
    </div>
  </main>
${redirectRow(false)}
</div>
`;
fs.writeFileSync(path.join(here, 'post.html'), post);

// ---------- no-data page ----------
const SEEN = [['dame.is', 'D', '12 pages', 'pds.atpota.to'], ['mitsuhiko.at', 'M', '4 pages', 'puffball.us-east.host.bsky.network'], ['kyefox.com', 'K', '2 pages', 'puffball.us-east.host.bsky.network']];
const nopage = `<div class="popup-shell">
${topbar(false)}
  <main class="popup-body">
    <div class="popup-root os-root">
    <p class="os-notice">${g.compass(15)}<span class="os-notice-text">${esc(wp.nopage.title)}</span><button type="button" class="os-notice-rescan">${g.refresh(13)}Scan again</button></p>
    <form class="os-lookup" action="https://aturi.to/" method="get">
      <label class="os-lookup-field">${g.search(14)}<input class="aturi-input" type="text" name="q" placeholder="Handle, DID or at:// URI" aria-label="Look up a handle, DID or AT URI" autocomplete="off" spellcheck="false"></label>
      <button type="submit" class="aturi-btn aturi-btn-primary">Open</button>
    </form>
    <section class="popup-section is-sheet">
      <h2 class="popup-section-label">Seen lately</h2>
      <div class="popup-waypoints">
${SEEN.map(([h, l, n, pds]) => `        <div class="popup-waypoint">
          <button type="button" class="popup-waypoint-main" title="Open ${h} on aturi.to"><span class="popup-icon-letter" aria-hidden="true">${l}</span><span class="popup-waypoint-name">${h}</span><span class="popup-waypoint-desc">${pds}</span></button>
          <span class="os-repo-count">${n}</span>
        </div>`).join('\n')}
      </div>
    </section>
    <section class="popup-section is-sheet">
      <h2 class="popup-section-label">Jump to an app</h2>
      <div class="popup-waypoints">
${wp.nopage.groups.map((gr) => {
  const shown = gr.items.slice(0, 6), rest = gr.items.length - shown.length;
  return `        <details class="os-group">
          <summary class="os-group-front">${g.chevronRight(14).replace('<svg ', '<svg class="os-drawer-chevron" ')}<span class="os-group-name">${esc(gr.label)}</span><span class="os-group-marks">${shown.map(([id]) => mark(id)).join('')}${rest > 0 ? `<span class="os-group-more">+${rest}</span>` : ''}</span></summary>
          <div class="os-group-rows">
${gr.items.map((it) => wprow(it, it[2])).join('\n')}
          </div>
        </details>`;
}).join('\n')}
      </div>
    </section>
    </div>
  </main>
${redirectRow(false)}
</div>
`;
fs.writeFileSync(path.join(here, 'nopage.html'), nopage);
console.log('wrote post.html', post.length, 'nopage.html', nopage.length);

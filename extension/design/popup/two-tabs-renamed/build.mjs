// Writes the "two tabs, renamed" model's pages from the shared fixtures
// (waypoints.json, data.json, icons.json). node build.mjs
//   post.html            post page, "Open in" tab open (the landing)
//   post-thispage.html   post page, "This page" tab open
//   post-on.html         post page, "Open in", auto-redirect on (status strip)
//   post-thispage-on.html  "This page" with auto-redirect on (pause row)
//   nopage.html          no-data page, "This page" tab open (the landing there)
//   nopage-openin.html   no-data page, "Open in" tab open (shortcuts)
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
  chevronDown: (s = 14) => G('<path d="m6 9 6 6 6-6"/>', s),
  refresh: (s = 13) => G('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>', s),
  search: (s = 14) => G('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', s),
  atSign: (s = 14) => G('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>', s),
  shuffle: (s = 15) => G('<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>', s),
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- shared regions ----------
// Brand, two folder tabs, settings. The theme toggle has gone to Settings >
// Appearance; the tabs carry no count badge (the toolbar badge has it).
const topbar = (active) => `  <header class="popup-topbar" data-sticky>
    <div class="popup-title">${g.leaf}<span>aturi</span></div>
    <div class="popup-mode-tabs" role="tablist" aria-label="Popup mode">
      <button type="button" role="tab" aria-selected="${active === 'open' ? 'true' : 'false'}"${active === 'open' ? '' : ' tabindex="-1"'} class="popup-mode-tab${active === 'open' ? ' is-active' : ''}"><span class="popup-mode-tab-label" data-label="Open in">Open in</span></button>
      <button type="button" role="tab" aria-selected="${active === 'page' ? 'true' : 'false'}"${active === 'page' ? '' : ' tabindex="-1"'} class="popup-mode-tab${active === 'page' ? ' is-active' : ''}"><span class="popup-mode-tab-label" data-label="This page">This page</span></button>
    </div>
    <div class="popup-topbar-actions">
      <button type="button" class="popup-icon-btn" aria-label="Open extension settings">${g.sliders}</button>
    </div>
  </header>`;

// The status strip: only when auto-redirect is on, only on the Open in tab
// (This page has its own row). One line, no switch; the switch is in Settings.
const statusStrip = () => `  <footer class="tt-strip" data-sticky>
    ${g.shuffle(15).replace('<svg ', '<svg class="tt-strip-icon" ')}
    <span class="tt-strip-text"><b>Auto-redirect on</b> · posts open in Anisota</span>
    <button type="button" class="popup-redirect-pause">Pause on this tab</button>
  </footer>`;

// ---------- waypoint rows (exactly today's) ----------
const DESC = {
  anisota: 'View post on anisota.net', blacksky: 'View post on blacksky.community',
  bluepy: 'View post on bluepy.social', reddwarf: 'View post on reddwarf.app', impro: 'View post on impro.social', lea: 'View post on lea.ac',
  witchsky: 'View post on witchsky.app', mu: 'View post on mu.social', deer: 'View post on deer.social', northsky: 'View post on northsky.app',
  leaflet: 'View profile on leaflet.pub', 'anisota-reader': 'View publications on anisota.net', offprint: 'View on offprint.app', pckt: 'View on pckt.blog', 'standard-reader': 'View documents on standard-reader.app',
  aturi: 'View post on aturi.to', pinkleap: 'View post on pinkleap.app', margin: 'View profile on margin.at', streamplace: 'View profile on stream.place', grain: 'View profile on grain.social', popfeed: 'View profile on popfeed.social', tangled: 'View profile on tangled.org',
  'aturi-explore': 'Inspect record on aturi.to/explore', pdsls: 'View raw record on pdsls.dev', 'atp-tools': 'View raw record on atp.tools', taproot: 'Inspect record on atproto.at',
};
const wprow = ([id, name, host, absent]) => {
  const desc = absent ? 'No records found on this repo' : DESC[id];
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

// ---------- post page: Open in ----------
const hit = data.hits[0];
const refs = data.hits.slice(2);

const openInPanel = () => `    <button type="button" class="tt-line" aria-label="Post by dame.is: see identifiers and details on the This page tab">
      <span class="tt-line-title">${esc(wp.post.pageCard.title)}</span>
      <span class="tt-line-meta"><span class="popup-source-collection">app.bsky.feed.post</span> · on Bluesky</span>
      <span class="tt-line-go">${g.chevronRight(16)}</span>
    </button>
${group(wp.post.recommended.label, wp.post.recommended.items, true)}
${wp.post.groups.map((gr) => group(gr.label, gr.items)).join('\n')}`;

// ---------- post page: This page ----------
const idRow = ({ label, value, tall, copied, aria }) => `        <li><button type="button" class="tt-id${tall ? ' is-tall' : ''}${copied ? ' is-copied' : ''}" aria-label="${esc(aria)}"${copied ? ' aria-live="polite"' : ''}>
          <span class="tt-id-text"><span class="tt-id-label">${copied ? 'Copied' : label}</span><span class="tt-id-value">${value}</span></span>
          <span class="tt-id-glyph">${copied ? g.check(14) : g.copy(14)}</span>
        </button></li>`;

// 22 + 1 + 6 = 29 mono characters: what the value column holds at 12px.
const cidShort = `${esc(hit.cid.slice(0, 22))}…${esc(hit.cid.slice(-6))}`;
const ledger = [
  idRow({ label: 'AT URI', tall: true, aria: 'Copy AT URI', value: `at://${esc(hit.did)}/<wbr>${esc(hit.collection)}/<wbr><span class="tt-id-tail">${esc(hit.rkey)}</span>` }),
  idRow({ label: 'DID', copied: true, aria: 'Copy DID (copied)', value: esc(hit.did) }),
  idRow({ label: 'Handle', aria: 'Copy handle', value: esc(hit.handle) }),
  idRow({ label: 'PDS', aria: 'Copy PDS host', value: esc(hit.pdsHost) }),
  idRow({ label: 'CID', aria: 'Copy CID', value: `<span title="${esc(hit.cid)}">${cidShort}</span>` }),
  idRow({ label: 'Link', tall: true, aria: 'Copy aturi.to link', value: `aturi.to/profile/<wbr><span class="tt-id-tail">${esc(hit.handle)}</span>/<wbr>post/<wbr><span class="tt-id-tail">${esc(hit.rkey)}</span>` }),
].join('\n');

const refRow = (r) => `      <div class="tt-ref">
        <button type="button" class="tt-ref-main" aria-label="Open post by ${esc(r.handle)} on aturi.to"><span class="tt-ref-handle">${esc(r.handle)}</span><span class="tt-ref-preview">${esc(r.preview)}</span></button>
        <button type="button" class="tt-id-glyph tt-ref-copy" aria-label="Copy AT URI of post by ${esc(r.handle)}">${g.copy(14)}</button>
      </div>`;

const redirectRow = (on) => `    <div class="tt-status${on ? ' is-on' : ''}">
      ${g.shuffle(15).replace('<svg ', '<svg class="tt-status-icon" ')}
      <span class="tt-status-text"><span class="tt-status-title">Auto-redirect${on ? ' on' : ''}</span><span class="tt-status-state">${on ? 'Posts open in Anisota' : 'Off'}</span></span>
      ${on ? '<button type="button" class="popup-redirect-pause">Pause on this tab</button>' : '<button type="button" class="tt-status-link">Settings</button>'}
    </div>`;

const thisPagePanel = (on) => `    <section class="tt-card" aria-label="This page's record">
      <div class="tt-card-head">
        <div class="tt-card-title"><b>${esc(hit.kind)}</b> by <b>${esc(hit.handle)}</b></div>
        <div class="tt-card-sub">Declared by the page as canonical · also in the address bar</div>
      </div>
      <ul class="tt-ledger">
${ledger}
      </ul>
      <button type="button" class="tt-cta">${g.compass(15)}<span class="tt-cta-label">Open on aturi.to</span><span class="tt-cta-note">record, PDS, raw JSON, links in</span>${g.external(14)}</button>
    </section>
    <section class="popup-section is-sheet">
      <div class="tt-drawer-head">
        <h2 class="popup-section-label">Also on this page · ${refs.length}</h2>
        <button type="button" class="inspect-rescan">${g.refresh(13)}Scan again</button>
      </div>
      <div class="popup-waypoints">
${refs.map(refRow).join('\n')}
      </div>
    </section>
${redirectRow(on)}`;

// ---------- no-data page ----------
const tile = ([id, name, host]) => `        <div class="popup-tile">
          <button type="button" class="popup-tile-main">${mark(id)}<span class="popup-tile-name">${esc(name)}</span><span class="popup-tile-desc">${esc(host)}</span></button>
          <button type="button" class="popup-waypoint-copy" aria-label="Copy ${esc(name)} link">${g.copy(12)}</button>
        </div>`;
const tileGroup = (gr) => `    <section class="popup-section is-sheet">
      <h2 class="popup-section-label">${esc(gr.label)}</h2>
      <div class="popup-tiles">
${gr.items.map(tile).join('\n')}
      </div>
    </section>`;

const nopageOpenIn = () => `    <p class="tt-shortcuts-note">No record on this page, so these shortcuts open each app's home page.</p>
${wp.nopage.groups.map(tileGroup).join('\n')}`;

const RECENTS = [['dame.is', 12], ['mitsuhiko.at', 3], ['bjkeefe.bsky.social', 2]];
const recentRow = ([handle, n]) => `      <div class="tt-ref">
        <button type="button" class="tt-ref-main tt-recent" aria-label="Open ${esc(handle)} on aturi.to">${g.atSign(14).replace('<svg ', '<svg class="tt-recent-icon" ')}<span class="tt-recent-handle">${esc(handle)}</span><span class="tt-recent-count">${n} visits</span><span class="tt-id-glyph tt-recent-go">${g.external(14)}</span></button>
      </div>`;

const nopageThisPage = () => `    <div class="popup-notice tt-notice">
      <div class="popup-notice-icon">${g.compass(20)}</div>
      <h2 class="popup-notice-title">${esc(wp.nopage.title)}</h2>
      <p class="popup-notice-body">We couldn't find a supported AT URI for this tab (from the address or an <code>at://</code> link in the page head). On a supported profile or post, this popup offers context-aware links instead.</p>
    </div>
    <form class="tt-lookup" aria-label="Look up a repo or record">
      <label class="popup-section-label" for="tt-lookup-field">Look up</label>
      <div class="tt-lookup-row">
        <span class="tt-lookup-icon">${g.search(15)}</span>
        <input id="tt-lookup-field" class="aturi-input tt-lookup-input" type="text" placeholder="Handle, DID or at:// URI" spellcheck="false" autocomplete="off">
        <button type="submit" class="aturi-btn aturi-btn-primary tt-lookup-go">Go</button>
      </div>
    </form>
    <section class="popup-section is-sheet">
      <h2 class="popup-section-label">Recent repos</h2>
      <div class="popup-waypoints">
${RECENTS.map(recentRow).join('\n')}
      </div>
    </section>`;

// ---------- assemble ----------
const shell = (active, panel, foot = '') => `<div class="popup-shell">
${topbar(active)}
  <main class="popup-body">
    <div class="popup-root" role="tabpanel">
${panel}
    </div>
  </main>
${foot}</div>
`;

const out = {
  'post.html': shell('open', openInPanel()),
  'post-thispage.html': shell('page', thisPagePanel(false)),
  'post-on.html': shell('open', openInPanel(), statusStrip()),
  'post-thispage-on.html': shell('page', thisPagePanel(true)),
  'nopage.html': shell('page', nopageThisPage()),
  'nopage-openin.html': shell('open', nopageOpenIn()),
};
for (const [name, html] of Object.entries(out)) fs.writeFileSync(path.join(here, name), html);
console.log('wrote', Object.keys(out).join(', '));

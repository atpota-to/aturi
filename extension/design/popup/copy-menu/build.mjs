// Builds post.html, nopage.html and two extra states (post-closed.html,
// post-on.html) for the "Copy menu and hand off" model. Icons come from
// ../icons.json, group order and hosts from ../waypoints.json.
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const icons = JSON.parse(fs.readFileSync(path.join(root, 'icons.json'), 'utf8'));
const wp = JSON.parse(fs.readFileSync(path.join(root, 'waypoints.json'), 'utf8'));

const iconKey = {
  'anisota-reader': 'anisotaReader',
  'standard-reader': 'standardReader',
  pinkleap: 'pinksky',
  'aturi-explore': 'aturiExplore',
  'atp-tools': 'atptools',
};
const icon = (id) => {
  const k = iconKey[id] ?? id;
  if (!icons[k]) throw new Error('no icon for ' + id);
  return icons[k].svg;
};

const L = (body, size = 14, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

const LEAF = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`;
const SLIDERS = L('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>', 17);
const SHUFFLE = (size = 14, cls = '') => L('<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>', size, cls ? ` class="${cls}"` : '');
const COPY = L('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');
const CHECK = L('<path d="M20 6 9 17l-5-5"/>');
const CHEVRON = L('<path d="m6 9 6 6 6-6"/>', 12);
const EXTERNAL = L('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', 12);
const COMPASS = L('<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>');
const SEARCH = L('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>');

// ---------- shared pieces ----------

const topbar = (on) => `
  <header class="popup-topbar cm-topbar" data-sticky>
    <div class="popup-title">${LEAF}<span>aturi</span></div>
    <div class="cm-topbar-right">
      <button type="button" role="switch" aria-checked="${on ? 'true' : 'false'}" class="aturi-switch aturi-switch-sm cm-redirect${on ? ' on' : ''}" title="Send Atmosphere links straight to your favourite client">${SHUFFLE(14, 'cm-redirect-icon')}<span class="cm-redirect-label">Auto-redirect</span><span class="aturi-switch-box" aria-hidden="true"></span></button>
      <button type="button" class="popup-icon-btn" aria-label="Open extension settings">${SLIDERS}</button>
    </div>
  </header>`;

const row = (id, name, desc, absent = false) => `
      <div class="popup-waypoint${absent ? ' is-absent' : ''}">
        <button type="button" class="popup-waypoint-main">
          <span class="popup-waypoint-icon">${icon(id)}</span>
          <span class="popup-waypoint-name">${name}</span>
          <span class="popup-waypoint-desc">${desc}</span>
        </button>
        <button type="button" class="popup-waypoint-copy" aria-label="Copy link for ${name}">${COPY}</button>
      </div>`;

const sheet = (label, rows, highlighted = false, extraClass = '') => `
  <section class="popup-section is-sheet${extraClass ? ' ' + extraClass : ''}">
    <h2 class="popup-section-label${highlighted ? ' is-highlighted' : ''}">${label}</h2>
    <div class="popup-waypoints">${rows}
    </div>
  </section>`;

// Row descriptions as the shipped Waypoints tab shows them on the sample post page.
const postDesc = {
  anisota: 'View post on anisota.net', blacksky: 'View post on blacksky.community',
  bluepy: 'View post on bluepy.social', reddwarf: 'View post on reddwarf.app', impro: 'View post on impro.social', lea: 'View post on lea.ac',
  witchsky: 'View post on witchsky.app', mu: 'View post on mu.social', deer: 'View post on deer.social', northsky: 'View post on northsky.app',
  leaflet: 'View profile on leaflet.pub', 'anisota-reader': 'View publications on anisota.net', offprint: 'View on offprint.app', pckt: 'View on pckt.blog', 'standard-reader': 'View documents on standard-reader.app',
  aturi: 'View post on aturi.to', pinkleap: 'View post on pinkleap.app', margin: 'View profile on margin.at', streamplace: 'View profile on stream.place', grain: 'View profile on grain.social', popfeed: 'View profile on popfeed.social', tangled: 'View profile on tangled.org',
  'aturi-explore': 'Inspect record on aturi.to/explore', pdsls: 'View raw record on pdsls.dev', 'atp-tools': 'View raw record on atp.tools', taproot: 'Inspect record on atproto.at',
};
const ABSENT = 'No records found on this repo';

const postList = () => {
  const rec = wp.post.recommended;
  let out = sheet(rec.label, rec.items.map(([id, name]) => row(id, name, postDesc[id])).join(''), true);
  for (const g of wp.post.groups) {
    out += sheet(g.label, g.items.map(([id, name, host, flag]) => row(id, name, flag === 'absent' ? ABSENT : postDesc[id], flag === 'absent')).join(''));
  }
  return out;
};

const menuItem = (key, val, copied = false) => `
        <button type="button" role="menuitem" class="cm-menu-item${copied ? ' is-copied' : ''}"${copied ? ' aria-live="polite"' : ''}>
          <span class="cm-menu-key">${copied ? 'Copied' : key}</span>
          <span class="cm-menu-val">${val}</span>${copied ? `<span class="cm-menu-check">${CHECK}</span>` : ''}
        </button>`;

const menu = () => `
      <div class="cm-menu" role="menu" aria-label="Copy an identifier">${menuItem('AT URI', 'at://did:plc:gq4fo3…/3mypi5zkyps2i')}${menuItem('DID', 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj', true)}${menuItem('Handle', 'dame.is')}${menuItem('PDS', 'pds.atpota.to')}${menuItem('Link', 'aturi.to/profile/dame.is/post/3mypi5zkyps2i')}
      </div>`;

const band = (paused) => paused
  ? `
    <div class="cm-page-band is-paused">${SHUFFLE(13)}<span class="cm-page-band-text">Auto-redirect is paused on this tab</span><button type="button" class="cm-page-band-action">Resume</button></div>`
  : `
    <div class="cm-page-band">${SHUFFLE(13)}<span class="cm-page-band-text">Auto-redirect is on</span><button type="button" class="cm-page-band-action">Pause on this tab</button></div>`;

const pageCard = ({ menuOpen = false, on = false, paused = false } = {}) => `
  <section class="popup-section is-sheet cm-page-section">
    <h2 class="popup-section-label">This page</h2>
    <div class="popup-page cm-page">
      <div class="popup-page-head">
        <span class="popup-page-avatar" aria-hidden="true">D</span>
        <div class="popup-page-text">
          <span class="popup-page-title">Post by dame.is</span>
          <span class="popup-page-meta"><span class="popup-source-collection">app.bsky.feed.post</span> · on Bluesky</span>
        </div>
      </div>
      <div class="popup-page-actions cm-actions">
        <button type="button" class="popup-page-btn cm-copy-btn${menuOpen ? ' is-open' : ''}" aria-haspopup="menu" aria-expanded="${menuOpen ? 'true' : 'false'}">${COPY}<span>Copy</span>${CHEVRON}</button>
        <a class="popup-page-btn cm-open-btn" href="https://aturi.to/profile/dame.is/post/3mypi5zkyps2i" target="_blank" rel="noopener">${COMPASS}<span>Open on aturi.to</span>${EXTERNAL}</a>${menuOpen ? menu() : ''}
      </div>${on ? band(paused) : ''}
    </div>
  </section>`;

const more = `
  <p class="cm-more">5 more records on this page · <a href="https://aturi.to/profile/dame.is/post/3mypi5zkyps2i" target="_blank" rel="noopener">See them on aturi.to</a></p>`;

const post = (opts) => `<div class="popup-shell">${topbar(opts.on)}
  <main class="popup-body">
    <div class="popup-root cm-root">${pageCard(opts)}${opts.footnote ? more.replace('cm-more', 'cm-more is-footnote') : ''}${postList()}${opts.footnote ? '' : more}
    </div>
  </main>
</div>
`;

// ---------- no-data page ----------

const chip = (h) => `<button type="button" class="cm-chip">${h}</button>`;

const lookupCard = `
  <section class="popup-section is-sheet cm-page-section">
    <h2 class="popup-section-label">This page</h2>
    <div class="popup-page cm-page cm-lookup-card">
      <p class="cm-nodata">No Atmosphere data on this page.</p>
      <form class="cm-lookup" role="search" action="https://aturi.to/" onsubmit="return false">${SEARCH}<input class="cm-lookup-input" type="text" name="q" placeholder="Go to a handle, DID or at://" aria-label="Go to a handle, DID or at://" autocomplete="off" spellcheck="false"><button type="submit" class="cm-lookup-go">Go</button></form>
      <div class="cm-recent"><span class="cm-recent-label">Recent</span>${chip('dame.is')}${chip('kyefox.com')}${chip('mitsuhiko.at')}</div>
    </div>
  </section>`;

const nopageList = () => {
  let out = '';
  for (const g of wp.nopage.groups) {
    out += sheet(g.label, g.items.map(([id, name, host]) => row(id, name, host)).join(''), false, 'cm-shortcuts');
  }
  return out;
};

const nopage = () => `<div class="popup-shell">${topbar(false)}
  <main class="popup-body">
    <div class="popup-root cm-root">${lookupCard}
  <div class="popup-jump-head"><h2 class="popup-jump-title">Jump to an app</h2><span class="popup-jump-note">Shortcuts open each app's home page</span></div>${nopageList()}
    </div>
  </main>
</div>
`;

fs.writeFileSync(path.join(here, 'post.html'), post({ menuOpen: true }));
fs.writeFileSync(path.join(here, 'post-closed.html'), post({ menuOpen: false }));
fs.writeFileSync(path.join(here, 'post-on.html'), post({ menuOpen: false, on: true }));
fs.writeFileSync(path.join(here, 'post-paused.html'), post({ menuOpen: false, on: true, paused: true }));
fs.writeFileSync(path.join(here, 'post-footnote.html'), post({ menuOpen: false, footnote: true }));
fs.writeFileSync(path.join(here, 'nopage.html'), nopage());
console.log('built post.html post-closed.html post-on.html nopage.html');

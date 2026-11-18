// Builds the states for the combined model (copy-menu + record tabs on the
// card + Seen lately + header search). Icons come from ../icons.json, groups
// and hosts from ../waypoints.json, the records from ../data.json.
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const icons = JSON.parse(fs.readFileSync(path.join(root, 'icons.json'), 'utf8'));
const wp = JSON.parse(fs.readFileSync(path.join(root, 'waypoints.json'), 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));

const iconKey = { 'anisota-reader': 'anisotaReader', 'standard-reader': 'standardReader', pinkleap: 'pinksky', 'aturi-explore': 'aturiExplore', 'atp-tools': 'atptools' };
const icon = (id) => { const k = iconKey[id] ?? id; if (!icons[k]) throw new Error('no icon for ' + id); return icons[k].svg; };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const L = (body, size = 14, extra = '') => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
const LEAF = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`;
const SLIDERS = L('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>', 17);
const SEARCH = (s = 17) => L('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', s);
const CLOSE = L('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 14);
const SHUFFLE = (size = 14, cls = '') => L('<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>', size, cls ? ` class="${cls}"` : '');
const COPY = L('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');
const CHECK = (s = 13) => L('<path d="M20 6 9 17l-5-5"/>', s);
const CHEVRON_DOWN = L('<path d="m6 9 6 6 6-6"/>', 12);
const CHEVRON_UP = L('<path d="m18 15-6-6-6 6"/>', 12);
const EXTERNAL = L('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', 12);
const COMPASS = (s = 14) => L('<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>', s);
const ARROW_UR = L('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>', 14);
const WINDOW = L('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/>', 13);
const HISTORY = L('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>', 13);

// ---------- records ----------
// Hits 1 and 2 are one record; 3-7 are the references, in page order.
const page = data.hits[0];
const refs = data.hits.slice(2);
const initial = (h) => h[0].toUpperCase();
// Provenance after the middot, lowercase mid-line: "· in structured data".
const where = (r) => data.whereLabels[r.where].replace(/^./, (c) => c.toLowerCase());
const kindWord = (r) => (r.kind || 'Bluesky post').replace(/^Bluesky /, '').replace(/^./, (c) => c.toUpperCase());
const cardTitle = (r) => `Post by ${r.handle}`;
const tabTitle = (r, isPage) => isPage ? `The page's own record · ${cardTitle(r)}` : `${cardTitle(r)} · ${where(r)}`;

// ---------- top bar ----------
// A sticky wrapper holds the bar, its search drawer and the scrim. The
// inner box is the positioned one, so the drawer hangs from the bar's
// bottom edge in the view and in the full render alike.
const topbar = ({ on = false, searchOpen = false, search = '', nodata = false } = {}) => `
  <div class="cm2-bar" data-sticky>
    <div class="cm2-bar-inner">
      <header class="popup-topbar cm2-topbar">
        <div class="popup-title">${LEAF}<span>aturi</span></div>
        <div class="cm2-topbar-right">
          <button type="button" role="switch" aria-checked="${on ? 'true' : 'false'}" class="aturi-switch aturi-switch-sm cm2-redirect${on ? ' on' : ''}" title="Send Atmosphere links straight to your favourite client">${SHUFFLE(14, 'cm2-redirect-icon')}<span class="cm2-redirect-label">Auto-redirect</span><span class="aturi-switch-box" aria-hidden="true"></span></button>
          <button type="button" class="popup-icon-btn cm2-search-btn${searchOpen ? ' is-pressed' : ''}" aria-label="Go to a handle, DID or at:// URI" title="Go to a handle, DID or at:// URI (/)"${nodata ? '' : ` aria-expanded="${searchOpen ? 'true' : 'false'}" aria-controls="cm2-search"`}>${SEARCH()}</button>
          <button type="button" class="popup-icon-btn" aria-label="Open extension settings">${SLIDERS}</button>
        </div>
      </header>${search}${searchOpen ? `
      <div class="cm2-scrim" aria-hidden="true"></div>` : ''}
    </div>
  </div>`;

// ---------- the search field and Seen lately ----------
const seen = [
  ['dame.is', 'pds.atpota.to', '12 pages'],
  ['mitsuhiko.at', 'puffball.us-east.host.bsky.network', '4 pages'],
  ['kyefox.com', 'puffball.us-east.host.bsky.network', '2 pages'],
];

const KBD = (k) => `<kbd class="cm2-kbd" aria-hidden="true">${k}</kbd>`;

// combobox: the field owns the suggestion list below it (the drawer); plain:
// a field on its own (the no-data card), with the "/" keycap at rest.
const field = ({ close = true, value = '', autofocus = true, combobox = true, kbd = false } = {}) => `
      <div class="cm2-field">${SEARCH(16)}<input id="cm2-search-input" class="cm2-field-input" type="text" name="q" placeholder="Go to a handle, DID or at:// URI" aria-label="Go to a handle, DID or at:// URI" autocomplete="off" spellcheck="false"${combobox ? ' role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="cm2-sugg"' : ''}${value ? ` value="${esc(value)}"` : ''}${autofocus ? ' autofocus' : ''}${close ? ' aria-describedby="cm2-search-hint"' : ''}>${kbd ? KBD('/') : ''}${close ? `<button type="button" class="cm2-field-close" aria-label="Close search">${CLOSE}</button>` : ''}</div>`;

const suggRow = ([h, host, n], i) => `
          <a id="cm2-sugg-${i + 1}" class="cm2-sugg-row" role="option" aria-selected="false" tabindex="-1" href="https://aturi.to/explore/${h}" target="_blank" rel="noopener"><span class="popup-icon-letter" aria-hidden="true">${initial(h)}</span><span class="cm2-sugg-handle">${h}</span><span class="cm2-sugg-host">${host}</span><span class="cm2-sugg-count">${n}</span></a>`;

const goRow = (typed) => `
        <a id="cm2-sugg-go" class="cm2-sugg-row is-go" role="option" aria-selected="false" tabindex="-1" href="https://aturi.to/explore/${encodeURIComponent(typed)}" target="_blank" rel="noopener">${ARROW_UR}<span class="cm2-sugg-go">Go to <span class="cm2-sugg-typed">${esc(typed)}</span> on aturi.to</span>${KBD('Enter')}</a>`;

// The drawer that hangs from the bar on a record page. Closed, it stays in
// the markup hidden, so the glyph's aria-controls always points at it.
const searchDrawer = ({ open = false, typed = '' } = {}) => {
  const rows = typed ? seen.filter(([h]) => h.includes(typed)) : seen;
  return `
      <div id="cm2-search" class="cm2-search" role="search"${open ? '' : ' hidden'}>${field({ value: typed, autofocus: open })}
        <span id="cm2-search-hint" hidden>Enter opens it on aturi.to; Escape closes the search</span>
        <div id="cm2-sugg" class="cm2-sugg" role="listbox" aria-label="Suggestions">${typed ? goRow(typed) : ''}${rows.length ? `
          <div role="group" aria-labelledby="cm2-sugg-seen" class="cm2-sugg-group">
          <div id="cm2-sugg-seen" class="cm2-sugg-head">${HISTORY}<span>Seen lately</span></div>${rows.map(suggRow).join('')}
          </div>` : ''}
        </div>
      </div>`;
};

// ---------- the card and its tabs ----------
const tab = (label, { active = false, pinned = false, title = '' } = {}) => `
        <button type="button" role="tab" class="popup-mode-tab cm2-tab${active ? ' is-active' : ''}${pinned ? ' is-pinned' : ''}" aria-selected="${active ? 'true' : 'false'}" tabindex="${active ? '0' : '-1'}"${title ? ` title="${esc(title)}"` : ''}>${pinned ? WINDOW : ''}<span class="popup-mode-tab-label" data-label="${esc(label)}">${esc(label)}</span></button>`;

// The run holds at most RUN_CAP references (page order); past that the
// list is the primary path. The +N tab at the strip's end counts the
// references not fully visible in the strip (the inline script sets it
// on load and on scroll) and opens the list of all of them.
const RUN_CAP = 12;
const tabs = (items, openIndex /* -1 = This page */, { listOpen = false } = {}) => {
  const run = items.slice(0, RUN_CAP);
  const overflow = items.length > 2;
  return `
    <div class="cm2-tabs">
      <div class="cm2-tablist" role="tablist" aria-label="Records on this page">${tab('This page', { active: openIndex < 0, pinned: true, title: tabTitle(page, true) })}${items.length ? `
        <div class="cm2-tabs-scroll${overflow ? ' is-overflowing' : ''}">${run.map((it, i) => tab(it.handle, { active: i === openIndex, title: tabTitle(it, false) })).join('')}
        </div>` : ''}
      </div>${overflow ? `
      <button type="button" class="popup-mode-tab cm2-tab cm2-tab-more${listOpen ? ' is-expanded' : ''}" data-total="${items.length}" aria-expanded="${listOpen ? 'true' : 'false'}" aria-controls="cm2-refs-list" aria-label="More records on this page" title="More records on this page"><span class="popup-mode-tab-label" data-label="+${items.length}">+${items.length}</span></button>` : ''}
    </div>`;
};

// The filed list of every referenced record, under the card: letter,
// handle, kind and where it was found. A row opens that tab and scrolls it
// into view; the open record's row is marked current.
const refsList = (items, openIndex, { open = false } = {}) => `
  <section class="popup-section is-sheet cm2-refs" id="cm2-refs-list"${open ? '' : ' hidden'}>
    <h2 class="popup-section-label">Records on this page</h2>
    <div class="popup-waypoints" role="list">${items.map((it, i) => `
      <div class="popup-waypoint cm2-ref" role="listitem">
        <button type="button" class="popup-waypoint-main"${i === openIndex ? ' aria-current="true"' : ''} title="${esc(tabTitle(it, false))}">
          <span class="popup-icon-letter" aria-hidden="true">${initial(it.handle)}</span>
          <span class="popup-waypoint-name">${esc(it.handle)}</span>
          <span class="popup-waypoint-desc">${kindWord(it)} · ${where(it)}</span>${i === openIndex ? `<span class="cm2-ref-current" aria-hidden="true">${CHECK(13)}</span>` : ''}
        </button>
      </div>`).join('')}
    </div>
  </section>`;

// Segmented identifiers: a <wbr> after each slash lets the browser wrap an
// AT URI or link at a path boundary; dots in a host do the same; a CID has
// no joints, so it wraps wherever it must (overflow-wrap on the value).
const seg = (s, { rkey = '' } = {}) => {
  let out = esc(s).replace(/\//g, '/<wbr>');
  if (rkey) out = out.replace(new RegExp(esc(rkey) + '$'), `<b class="cm2-rkey">${esc(rkey)}</b>`);
  return out;
};
const host = (s) => esc(s).replace(/\./g, '<wbr>.');

const KEYS = { uri: 'AT URI', link: 'Link', did: 'DID', handle: 'Handle', pds: 'PDS', cid: 'CID' };

// A row keeps its name while copied; the state is the row's tint, a tick
// on its last line (out of flow, so the value never re-wraps) and the Copy
// button reading "Copied" above the ledger. The live region says which.
const ledgerRow = (k, val, { copied = false } = {}) => `
        <li><button type="button" class="cm2-ledger-row${copied ? ' is-copied' : ''}" title="Copy the ${KEYS[k]}">
          <span class="cm2-ledger-key">${KEYS[k]}</span>
          <span class="cm2-ledger-val">${val}</span>${copied ? `<span class="cm2-ledger-tick" aria-hidden="true">${CHECK(13)}</span>` : ''}
        </button></li>`;

const ledger = (r, copiedKey = '') => `
      <ul id="cm2-ledger" class="cm2-ledger" role="list" aria-label="Identifiers of this record">${ledgerRow('uri', seg(r.uri, { rkey: r.rkey }), { copied: copiedKey === 'uri' })}${ledgerRow('link', seg(r.universalLink.replace(/^https:\/\//, ''), { rkey: r.rkey }), { copied: copiedKey === 'link' })}${ledgerRow('did', esc(r.did), { copied: copiedKey === 'did' })}${ledgerRow('handle', esc(r.handle), { copied: copiedKey === 'handle' })}${ledgerRow('pds', host(r.pdsHost), { copied: copiedKey === 'pds' })}${ledgerRow('cid', esc(r.cid), { copied: copiedKey === 'cid' })}
      </ul>
      <div class="sr-only" aria-live="polite">${copiedKey ? `${KEYS[copiedKey]} copied` : ''}</div>`;

const band = (paused) => paused
  ? `
      <div class="cm2-page-band is-paused">${SHUFFLE(13)}<span class="cm2-page-band-text">Auto-redirect is paused for this page</span><button type="button" class="cm2-page-band-action">Resume</button></div>`
  : `
      <div class="cm2-page-band">${SHUFFLE(13)}<span class="cm2-page-band-text">Auto-redirect is on</span><button type="button" class="cm2-page-band-action">Pause for this page</button></div>`;

const card = ({ items, openIndex = -1, rec, isPage = true, menuOpen = false, copied = '', on = false, paused = false, listOpen = false }) => `
  <section class="popup-section cm2-card-section">${tabs(items, openIndex, { listOpen })}
    <div class="popup-page cm2-page" role="tabpanel">
      <div class="popup-page-head">
        <span class="popup-page-avatar" aria-hidden="true">${initial(rec.handle)}</span>
        <div class="popup-page-text">
          <span class="popup-page-title">${cardTitle(rec)}</span>
          <span class="popup-page-meta"><span class="popup-source-collection">${rec.collection}</span> · ${isPage ? 'on Bluesky' : where(rec)}</span>
        </div>
      </div>${isPage ? '' : `
      <p class="cm2-page-preview">${esc(rec.preview)}</p>`}
      <div class="popup-page-actions cm2-actions">
        <button type="button" class="popup-page-btn cm2-copy-btn${menuOpen ? ' is-open' : ''}${copied ? ' is-copied' : ''}" aria-expanded="${menuOpen ? 'true' : 'false'}" aria-controls="cm2-ledger">${copied ? CHECK(14) : COPY}<span>${copied ? 'Copied' : 'Copy'}</span>${menuOpen ? CHEVRON_UP : CHEVRON_DOWN}</button>
        <a class="popup-page-btn cm2-open-btn" href="${rec.universalLink}" target="_blank" rel="noopener">${COMPASS()}<span>Open on aturi.to</span>${EXTERNAL}</a>
      </div>${menuOpen ? ledger(rec, copied) : `
      <ul id="cm2-ledger" class="cm2-ledger" hidden></ul>`}${on ? band(paused) : ''}
    </div>
  </section>${items.length > 2 ? refsList(items, openIndex, { open: listOpen }) : ''}`;

// ---------- waypoints as shipped ----------
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
  for (const g of wp.post.groups) out += sheet(g.label, g.items.map(([id, name, h, flag]) => row(id, name, flag === 'absent' ? ABSENT : postDesc[id], flag === 'absent')).join(''));
  return out;
};

// The strip's script: sets the fade classes and the +N count from what is
// actually visible, on load and on scroll. In the extension the same runs
// on scroll (rAF-throttled) and on resize; a vertical wheel over the run
// moves it sideways. The 40 is the run's scroll-padding: a tab's snap
// position is its left edge less that padding.
const stripScript = (snapTo = -1) => `
<script>(() => {
  const run = document.querySelector('.cm2-tabs-scroll');
  const more = document.querySelector('.cm2-tab-more');
  if (!run || !more) return;
  const total = +more.dataset.total;
  const label = more.querySelector('.popup-mode-tab-label');
  const update = () => {
    const sl = run.scrollLeft, w = run.clientWidth, max = run.scrollWidth - w;
    const scrolled = sl > 1, atEnd = sl >= max - 1;
    run.classList.toggle('is-scrolled', scrolled);
    run.classList.toggle('is-at-end', atEnd);
    // A tab counts as visible while at most 8px of it is under a fade.
    const lo = sl + (scrolled ? 32 : 0), hi = sl + w - (atEnd ? 0 : 32);
    let visible = 0;
    for (const t of run.children) if (t.offsetLeft >= lo && t.offsetLeft + t.offsetWidth <= hi) visible++;
    const hidden = Math.max(0, total - visible);
    label.textContent = '+' + hidden; label.dataset.label = '+' + hidden;
    more.setAttribute('aria-label', hidden + ' more record' + (hidden === 1 ? '' : 's') + ' on this page, list them all');
    more.title = hidden + ' more record' + (hidden === 1 ? '' : 's') + ' on this page · list them all';
  };
  run.addEventListener('scroll', update, { passive: true });
  run.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { run.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  ${snapTo >= 0 ? `run.scrollLeft = run.children[${snapTo}].offsetLeft - 40; /* the snap position of that tab */` : ''}
  update();
})();</script>
`;

const post = (opts) => `<div class="popup-shell">${topbar({ on: opts.on, searchOpen: !!opts.searchOpen, search: searchDrawer({ open: !!opts.searchOpen, typed: opts.typed || '' }) })}
  <main class="popup-body">
    <div class="popup-root cm2-root">${card(opts)}${postList()}
    </div>
  </main>
</div>
${stripScript(opts.snapTo ?? -1)}`;

// ---------- no-data page ----------
const seenSheet = () => sheet('Seen lately', seen.map(([h, hst, n]) => `
      <div class="popup-waypoint">
        <a class="popup-waypoint-main" href="https://aturi.to/explore/${h}" target="_blank" rel="noopener" title="Open ${h} on aturi.to"><span class="popup-icon-letter" aria-hidden="true">${initial(h)}</span><span class="popup-waypoint-name">${h}</span><span class="popup-waypoint-desc">${hst}</span><span class="cm2-repo-count">${n}</span></a>
      </div>`).join(''), false, 'cm2-seen');

// One tab, no tablist: a static label on an open, empty folder.
const lookupCard = `
  <section class="popup-section cm2-card-section">
    <div class="cm2-tabs is-lone">
      <span class="popup-mode-tab cm2-tab is-active is-pinned">${WINDOW}<span class="popup-mode-tab-label" data-label="This page">This page</span></span>
    </div>
    <div class="popup-page cm2-page cm2-lookup-card">
      <p class="cm2-nodata">${COMPASS(15)}<span>No Atmosphere data on this page.</span></p>
      <form class="cm2-lookup" role="search" action="https://aturi.to/" onsubmit="return false">${field({ close: false, autofocus: true, combobox: false, kbd: true })}</form>
    </div>
  </section>`;

const nopageList = () => wp.nopage.groups.map((g) => sheet(g.label, g.items.map(([id, name, h]) => row(id, name, h)).join(''), false, 'cm2-shortcuts')).join('');

const nopage = () => `<div class="popup-shell">${topbar({ nodata: true })}
  <main class="popup-body">
    <div class="popup-root cm2-root">${lookupCard}${seenSheet()}
  <div class="popup-jump-head"><h2 class="popup-jump-title">Jump to an app</h2><span class="popup-jump-note">Shortcuts open each app's home page</span></div>${nopageList()}
    </div>
  </main>
</div>
`;

// ---------- 40 references (invented handles; the first five are the fixture's) ----------
const manyHandles = [
  'jay.bsky.team', 'pfrazee.com', 'why.bsky.team', 'danabra.mov', 'retr0.id', 'bnewbold.net', 'divy.zone', 'hailey.at', 'samuel.bsky.team', 'emily.bsky.team',
  'rudy.bsky.social', 'ngerakines.me', 'matthieu.bsky.social', 'juli.ee', 'brid.gy', 'cameron.pfiffer.org', 'adam.bsky.social', 'mary.my.id', 'bossett.social', 'tom.sherman.is',
  'did:web:atproto.example.net', 'nat.bsky.social', 'hipster.press', 'eli.bsky.social', 'jacob.gold', 'whey.party', 'dholms.xyz', 'smokesignal.events', 'mackuba.eu', 'hugo.bsky.team',
  'kaz.bsky.social', 'tessa.dev', 'aoc.bsky.social', 'ngl.at', 'lexicon.community',
];
const manyItems = [...refs, ...manyHandles.map((handle) => ({ handle, where: 'jsonld', kind: 'Bluesky post' }))];

const items = refs;
fs.writeFileSync(path.join(here, 'post.html'), post({ items, openIndex: -1, rec: page, isPage: true, menuOpen: true, copied: 'uri' }));
fs.writeFileSync(path.join(here, 'post-closed.html'), post({ items, openIndex: -1, rec: page, isPage: true }));
fs.writeFileSync(path.join(here, 'post-ref.html'), post({ items, openIndex: 0, rec: refs[0], isPage: false }));
fs.writeFileSync(path.join(here, 'post-refs.html'), post({ items, openIndex: 0, rec: refs[0], isPage: false, listOpen: true }));
fs.writeFileSync(path.join(here, 'post-search.html'), post({ items, openIndex: -1, rec: page, isPage: true, searchOpen: true }));
fs.writeFileSync(path.join(here, 'post-search-typed.html'), post({ items, openIndex: -1, rec: page, isPage: true, searchOpen: true, typed: 'mitsu' }));
fs.writeFileSync(path.join(here, 'post-on.html'), post({ items, openIndex: -1, rec: page, isPage: true, on: true }));
fs.writeFileSync(path.join(here, 'post-many.html'), post({ items: manyItems, openIndex: -1, rec: page, isPage: true, snapTo: 4 }));
fs.writeFileSync(path.join(here, 'nopage.html'), nopage());
console.log('built post, post-closed, post-ref, post-refs, post-search, post-search-typed, post-on, post-many, nopage');

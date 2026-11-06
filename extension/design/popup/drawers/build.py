# Builds post.html and nopage.html for the "Drawers" popup model from the
# shared fixtures. Run: python3 -I build.py <popup-models dir>
import json, os, sys
ROOT = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
icons = json.load(open(os.path.join(ROOT, 'icons.json')))
wp = json.load(open(os.path.join(ROOT, 'waypoints.json')))
data = json.load(open(os.path.join(ROOT, 'data.json')))

ICON_KEY = {'anisota-reader': 'anisotaReader', 'standard-reader': 'standardReader',
            'aturi-explore': 'aturiExplore', 'atp-tools': 'atptools', 'pinkleap': 'pinksky'}
def mark(wid):
    return icons[ICON_KEY.get(wid, wid)]['svg']

def g(name, size=14, cls='', sw=2):
    paths = {
        'chevron': '<path d="m9 18 6-6-6-6"/>',
        'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
        'check': '<path d="M20 6 9 17l-5-5"/>',
        'ext': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
        'refresh': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
        'sliders': '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
        'leaf': '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
        'shuffle': '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
        'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        'pause': '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    }[name]
    c = f' class="{cls}"' if cls else ''
    return (f'<svg{c} width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths}</svg>')

def topbar():
    return f'''  <header class="popup-topbar dw-topbar" data-sticky>
    <div class="popup-title">{g('leaf', 20, sw=2.2)}<span>aturi</span></div>
    <div class="popup-topbar-actions">
      <button type="button" class="popup-icon-btn" aria-label="Open extension settings">{g('sliders', 17)}</button>
    </div>
  </header>
'''

def tab(label, open_, controls, count=None, note=None):
    cnt = f'<span class="dw-tab-count">· {count}</span>' if count else ''
    n = f'\n          {note}' if note else ''
    return (f'        <div class="dw-tabline">\n          <button type="button" class="dw-tab" aria-expanded="{"true" if open_ else "false"}" '
            f'aria-controls="{controls}">{g("chevron", 12, "dw-tab-chev", sw=2.4)}<span class="dw-tab-label">{label}</span>{cnt}</button>{n}\n        </div>\n')

def wprow(wid, name, desc, absent=False, copy_label=None):
    cl = ' is-absent' if absent else ''
    copy_label = copy_label or f'Copy link for {name}'
    return (f'<div class="popup-waypoint{cl}"><button type="button" class="popup-waypoint-main">'
            f'<span class="popup-waypoint-icon">{mark(wid)}</span><span class="popup-waypoint-name">{name}</span>'
            f'<span class="popup-waypoint-desc">{desc}</span></button>'
            f'<button type="button" class="popup-waypoint-copy" aria-label="{copy_label}">{g("copy", 14)}</button></div>')

def guide(label, lead=False, count=None):
    cl = ' is-lead' if lead else ''
    cnt = f'<span class="dw-guide-count">{count}</span>' if count else ''
    return f'<div class="dw-guide{cl}">{label}{cnt}</div>'

def idrow(label, value_html, long=False, copied=False, kbd=None, aria=None):
    cl = ' is-long' if long else ''
    cl += ' is-copied' if copied else ''
    lab = 'Copied' if copied else label
    k = f'<kbd class="dw-kbd">{kbd}</kbd>' if kbd else ''
    glyph = g('check', 14, sw=2.4) if copied else g('copy', 14)
    a = f' aria-label="{aria}"' if aria else ''
    return (f'<li><button type="button" class="dw-id{cl}"{a}><span class="dw-id-label">{lab}{k}</span>'
            f'<span class="dw-id-value">{value_html}</span><span class="dw-id-glyph">{glyph}</span></button></li>')

def redirect_drawer():
    return f'''      <section class="dw-drawer" id="dw-redirect">
{tab('Auto-redirect', False, 'dw-redirect-body')}        <div class="dw-box">
          <div class="dw-face dw-rd-face">
            {g('shuffle', 15, 'dw-rd-icon')}
            <span class="dw-rd-text"><b>Off</b> · links open where they are</span>
            <button type="button" role="switch" aria-checked="false" class="aturi-switch aturi-switch-sm" aria-label="Auto-redirect"><span class="aturi-switch-box" aria-hidden="true"></span></button>
          </div>
          <div class="dw-body" id="dw-redirect-body">
            <p class="dw-rd-copy">When on, Bluesky links open in your favourite client instead of bsky.app. This tab can sit it out.</p>
            <div class="dw-rd-row">
              <button type="button" class="dw-btn" disabled>{g('pause', 13)}Pause on this tab</button>
              <span class="dw-rd-hint">Turn it on first</span>
            </div>
            <a class="dw-band" href="#settings">{g('sliders', 14)}<span>Choose favourites in Settings</span>{g('ext', 14, 'dw-band-ext')}</a>
          </div>
        </div>
      </section>
'''

# ---------------- post page ----------------
h = data['hits'][0]
refs = data['hits'][2:]
p = wp['post']
# Descriptions as the shipped popup prints them on this page.
DESC = {
  'bluepy': 'View post on bluepy.social', 'reddwarf': 'View post on reddwarf.app', 'impro': 'View post on impro.social', 'lea': 'View post on lea.ac',
  'witchsky': 'View post on witchsky.app', 'mu': 'View post on mu.social', 'deer': 'View post on deer.social', 'northsky': 'View post on northsky.app',
  'leaflet': 'View profile on leaflet.pub', 'anisota-reader': 'View publications on anisota.net', 'offprint': 'View on offprint.app', 'pckt': 'View on pckt.blog', 'standard-reader': 'View documents on standard-reader.app',
  'aturi': 'View post on aturi.to', 'pinkleap': 'View post on pinkleap.app', 'margin': 'View profile on margin.at', 'streamplace': 'View profile on stream.place', 'grain': 'View profile on grain.social', 'popfeed': 'View profile on popfeed.social', 'tangled': 'View profile on tangled.org',
  'aturi-explore': 'Inspect record on aturi.to/explore', 'pdsls': 'View raw record on pdsls.dev', 'atp-tools': 'View raw record on atp.tools', 'taproot': 'Inspect record on atproto.at',
  'anisota': 'View post on anisota.net', 'blacksky': 'View post on blacksky.community',
}
def rows_for(items):
    out = []
    for it in items:
        wid, name, host = it[0], it[1], it[2]
        absent = len(it) > 3 and it[3] == 'absent'
        desc = 'No records found on this repo' if absent else DESC[wid]
        out.append('            ' + wprow(wid, name, desc, absent))
    return '\n'.join(out)

rec_rows = rows_for(p['recommended']['items'])
group_html = []
for grp in p['groups']:
    group_html.append('            ' + guide(grp['label'], count=len(grp['items'])))
    group_html.append(rows_for(grp['items']))
groups = '\n'.join(group_html)

ref_rows = []
for r in refs:
    ref_rows.append(f'            <div class="popup-waypoint dw-ref"><a class="popup-waypoint-main" href="{r["universalLink"]}">'
                    f'<span class="popup-waypoint-name">{r["handle"]}</span><span class="popup-waypoint-desc">{r["preview"]}</span></a>'
                    f'<button type="button" class="popup-waypoint-copy" aria-label="Copy AT URI of the post by {r["handle"]}">{g("copy", 14)}</button></div>')
ref_rows = '\n'.join(ref_rows)
face_handles = ', '.join(f'<b>{r["handle"]}</b>' for r in refs)

post = f'''<div class="popup-shell dw-shell">
{topbar()}  <main class="popup-body">
    <div class="popup-root dw-stack">

      <section class="dw-drawer is-open" id="dw-page">
{tab('This page', True, 'dw-page-body', note=f'<button type="button" class="dw-tabline-note dw-tabline-link">{g("refresh", 12)}Scan again</button>')}        <div class="dw-box">
          <div class="dw-face dw-page-face">
            <div class="dw-page-title"><b>Bluesky post</b> by <b>{h['handle']}</b></div>
            <div class="dw-page-src">Declared by the page as canonical · also in the address bar</div>
          </div>
          <div class="dw-body" id="dw-page-body">
            <ul class="dw-ledger">
              {idrow('AT URI', f'at://{h["did"]}/<wbr>{h["collection"]}/<b>{h["rkey"]}</b>', long=True, kbd='⌘C', aria='Copy AT URI')}
              {idrow('Link', f'aturi.to/profile/<b>{h["handle"]}</b>/<wbr>post/<b>{h["rkey"]}</b>', long=True, copied=True, aria='Copy aturi.to link, copied')}
              {idrow('Handle', h['handle'], aria='Copy handle')}
              {idrow('DID', h['did'], aria='Copy DID')}
              {idrow('PDS', h['pdsHost'], aria='Copy PDS host')}
              {idrow('CID', 'bafyreighfosenlos2js…uldo72mtbi', aria='Copy CID')}
            </ul>
            <a class="dw-band" href="{h['universalLink']}">{g('leaf', 14, sw=2.2)}<span>Open on aturi.to</span><span class="dw-band-note">record, PDS, raw JSON, links in</span>{g('ext', 14, 'dw-band-ext')}</a>
          </div>
        </div>
      </section>

      <section class="dw-drawer is-open" id="dw-open">
{tab('Open in', True, 'dw-open-body')}        <div class="dw-box">
          <div class="dw-face">
            {guide('Recommended for posts', lead=True)}
{rec_rows}
          </div>
          <div class="dw-body" id="dw-open-body">
{groups}
          </div>
        </div>
      </section>

      <section class="dw-drawer" id="dw-refs">
{tab('Also on this page', False, 'dw-refs-body', count=len(refs))}        <div class="dw-box">
          <button type="button" class="dw-face dw-refs-face" aria-expanded="false" aria-controls="dw-refs-body"><span class="dw-refs-face-text">Posts by {face_handles}</span></button>
          <div class="dw-body" id="dw-refs-body">
            {guide('In structured data · open on aturi.to, or copy the AT URI')}
{ref_rows}
          </div>
        </div>
      </section>

{redirect_drawer()}
    </div>
  </main>
</div>
'''

# ---------------- no-data page ----------------
n = wp['nopage']
ng = []
for grp in n['groups']:
    ng.append('            ' + guide(grp['label'], count=len(grp['items'])))
    ng.append('\n'.join('            ' + wprow(it[0], it[1], it[2], copy_label=f'Copy {it[1]} home page link') for it in grp['items']))
ngroups = '\n'.join(ng)

nopage = f'''<div class="popup-shell dw-shell">
{topbar()}  <main class="popup-body">
    <div class="popup-root dw-stack">

      <section class="dw-drawer is-open" id="dw-page">
{tab('This page', True, 'dw-page-body', note=f'<button type="button" class="dw-tabline-note dw-tabline-link">{g("refresh", 12)}Scan again</button>')}        <div class="dw-box">
          <div class="dw-face dw-page-face">
            <div class="dw-page-title"><b>{n['title']}</b></div>
            <div class="dw-page-src">Nothing in the address bar, the page head or an at:// link</div>
          </div>
          <div class="dw-body dw-lookup" id="dw-page-body">
            <label class="dw-lookup-label" for="dw-q">Look up a handle, DID or at:// URI</label>
            <div class="dw-lookup-form">
              <div class="dw-lookup-field">{g('search', 14)}<input id="dw-q" class="dw-lookup-input" type="text" placeholder="dame.is · did:plc:… · at://…" spellcheck="false"></div>
              <button type="button" class="aturi-btn aturi-btn-primary dw-lookup-go">Open</button>
            </div>
            <div class="dw-recent"><span class="dw-recent-label">Recent</span><a class="dw-chip" href="https://aturi.to/profile/dame.is">dame.is</a><a class="dw-chip" href="https://aturi.to/profile/mitsuhiko.at">mitsuhiko.at</a><a class="dw-chip" href="https://aturi.to/profile/kyefox.com">kyefox.com</a></div>
          </div>
        </div>
      </section>

      <section class="dw-drawer is-open" id="dw-open">
{tab('Jump to an app', True, 'dw-open-body', note='<span class="dw-tabline-note">Shortcuts open each app’s home page</span>')}        <div class="dw-box">
          <div class="dw-body dw-body-only" id="dw-open-body">
{ngroups}
          </div>
        </div>
      </section>

{redirect_drawer()}
    </div>
  </main>
</div>
'''

open(os.path.join(HERE, 'post.html'), 'w').write(post)
open(os.path.join(HERE, 'nopage.html'), 'w').write(nopage)
print('wrote post.html', len(post), 'nopage.html', len(nopage))

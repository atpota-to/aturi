# Builds post.html (pulled state), rest.html (resting state) and nopage.html
# for the "Pull the card" popup model. Run: python3 -I build.py
import json, os, html

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
icons = json.load(open(os.path.join(ROOT, 'icons.json')))
wp = json.load(open(os.path.join(ROOT, 'waypoints.json')))
data = json.load(open(os.path.join(ROOT, 'data.json')))

ICON_KEY = {
    'anisota-reader': 'anisotaReader', 'standard-reader': 'standardReader', 'pinkleap': 'pinksky',
    'aturi-explore': 'aturiExplore', 'atp-tools': 'atptools',
}
def mark(wid):
    return icons[ICON_KEY.get(wid, wid)]['svg']

def lucide(body, size=14, sw=2):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{body}</svg>')

G = {
    'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    'check': '<path d="M20 6 9 17l-5-5"/>',
    'external': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    'compass': '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
    'chev-up': '<path d="m18 15-6-6-6 6"/>',
    'chev-down': '<path d="m6 9 6 6 6-6"/>',
    'chev-right': '<path d="m9 18 6-6-6-6"/>',
    'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'settings': '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'shuffle': '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
    'leaf': '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
}

def topbar():
    return f'''  <header class="popup-topbar">
    <div class="popup-title">{lucide(G['leaf'], 20, 2.2)}<span>aturi</span></div>
    <div class="popup-topbar-actions">
      <button type="button" class="popup-icon-btn" aria-label="Look up a handle, DID or at:// URI">{lucide(G['search'], 17)}</button>
      <button type="button" class="popup-icon-btn" aria-label="Open extension settings">{lucide(G['settings'], 17)}</button>
    </div>
  </header>
'''

def wp_row(wid, name, desc, absent=False):
    cls = 'popup-waypoint is-absent' if absent else 'popup-waypoint'
    d = 'No records found on this repo' if absent else desc
    return (f'      <div class="{cls}">'
            f'<button type="button" class="popup-waypoint-main"><span class="popup-waypoint-icon">{mark(wid)}</span>'
            f'<span class="popup-waypoint-name">{html.escape(name)}</span><span class="popup-waypoint-desc">{html.escape(d)}</span></button>'
            f'<button type="button" class="popup-waypoint-copy" aria-label="Copy link to {html.escape(name)}">{lucide(G["copy"])}</button></div>\n')

def drawer(label, rows_html, highlighted=False):
    hl = ' is-highlighted' if highlighted else ''
    return (f'  <section class="popup-section is-sheet">\n    <h2 class="popup-section-label{hl}">{html.escape(label)}</h2>\n'
            f'    <div class="popup-waypoints">\n{rows_html}    </div>\n  </section>\n')

# Row descriptions as the shipped popup writes them on the sample post page.
DESC = {
    'anisota': 'View post on anisota.net', 'blacksky': 'View post on blacksky.community',
    'bluepy': 'View post on bluepy.social', 'reddwarf': 'View post on reddwarf.app', 'impro': 'View post on impro.social', 'lea': 'View post on lea.ac',
    'witchsky': 'View post on witchsky.app', 'mu': 'View post on mu.social', 'deer': 'View post on deer.social', 'northsky': 'View post on northsky.app',
    'leaflet': 'View profile on leaflet.pub', 'anisota-reader': 'View publications on anisota.net', 'offprint': 'View on offprint.app',
    'pckt': 'View on pckt.blog', 'standard-reader': 'View documents on standard-reader.app',
    'aturi': 'View post on aturi.to', 'pinkleap': 'View post on pinkleap.app', 'margin': 'View profile on margin.at', 'semble': '',
    'streamplace': 'View profile on stream.place', 'grain': 'View profile on grain.social', 'popfeed': 'View profile on popfeed.social',
    'sifa': '', 'blento': '', 'tangled': 'View profile on tangled.org',
    'aturi-explore': 'Inspect record on aturi.to/explore', 'pdsls': 'View raw record on pdsls.dev', 'atp-tools': 'View raw record on atp.tools', 'taproot': 'Inspect record on atproto.at',
}

def waypoint_drawers():
    out = ''
    rec = wp['post']['recommended']
    out += drawer(rec['label'], ''.join(wp_row(i[0], i[1], DESC[i[0]]) for i in rec['items']), highlighted=True)
    for g in wp['post']['groups']:
        rows = ''.join(wp_row(i[0], i[1], DESC[i[0]], absent=(len(i) > 3 and i[3] == 'absent')) for i in g['items'])
        out += drawer(g['label'], rows)
    return out

def redirect_row(on=False):
    return f'''  <section class="pc-redirect{' is-on' if on else ''}" aria-label="Auto-redirect">
    <span class="pc-redirect-icon">{lucide(G['shuffle'], 15)}</span>
    <span class="pc-redirect-text"><span class="pc-redirect-title">Auto-redirect</span><span class="pc-redirect-sub">Send links straight to your favourite app</span></span>
    <button type="button" role="switch" aria-checked="{'true' if on else 'false'}" class="aturi-switch aturi-switch-sm{' on' if on else ''}" aria-label="Auto-redirect"><span class="popup-redirect-state">{'On' if on else 'Off'}</span><span class="aturi-switch-box" aria-hidden="true"></span></button>
  </section>
'''

def strip():
    return f'''  <footer class="pc-strip" data-sticky>
    {lucide(G['shuffle'], 15)}
    <span class="pc-strip-text"><b>Auto-redirect is on</b> for Atmosphere links</span>
    <button type="button" class="pc-strip-btn">Pause on this tab</button>
  </footer>
'''

hit = data['hits'][0]
refs = data['hits'][2:]

def page_card(pulled=False):
    pull_label = 'Details'
    return f'''  <section class="popup-section is-sheet pc-page">
    <div class="pc-tabs">
      <span class="pc-tab">This page</span>
      <button type="button" class="pc-tab pc-pull" aria-expanded="{'true' if pulled else 'false'}" aria-controls="pc-sheet">{pull_label}{lucide(G['chev-up'], 12, 2.4)}</button>
    </div>
    <div class="popup-page pc-card">
      <div class="popup-page-head">
        <div class="popup-page-avatar">D</div>
        <div class="popup-page-text">
          <span class="popup-page-title">Post by dame.is</span>
          <span class="popup-page-meta"><span class="popup-source-collection">app.bsky.feed.post</span> · on Bluesky</span>
        </div>
      </div>
      <div class="popup-page-actions">
        <button type="button" class="popup-page-btn">{lucide(G['link'])}<span>Copy aturi.to link</span></button>
        <button type="button" class="popup-page-btn">{lucide(G['copy'])}<span>Copy at:// URI</span></button>
      </div>
      <a class="inspect-cta pc-open" href="{hit['universalLink']}" target="_blank" rel="noreferrer">{lucide(G['compass'], 15)}<span class="pc-open-label">Open on aturi.to</span><span class="pc-open-sub">record, PDS, raw JSON, links in</span>{lucide(G['external'])}</a>
    </div>
  </section>
'''

def rest_body(pulled=False, on=False):
    return (f'  <main class="popup-body">\n  <div class="popup-root">\n' + page_card(pulled) + waypoint_drawers() + redirect_row(on) + '  </div>\n  </main>\n' + (strip() if on else ''))

def ledger_row(key, val_html, copied=False, stacked=False, label_for=None):
    cls = 'pc-row' + (' is-stacked' if stacked else '') + (' is-copied' if copied else '')
    k = 'Copied' if copied else key
    btn = (f'<span class="pc-copy is-copied" role="status" aria-label="{html.escape(key)} copied">{lucide(G["check"], 15, 2.4)}</span>' if copied
           else f'<button type="button" class="pc-copy" aria-label="Copy {html.escape(label_for or key)}">{lucide(G["copy"])}</button>')
    return f'      <div class="{cls}"><span class="pc-key">{k}</span><span class="pc-val">{val_html}</span>{btn}</div>\n'

def mid(s, head, tail):
    return f'<span class="pc-mid"><span class="pc-mid-a">{html.escape(s[:-tail])}</span><span class="pc-mid-b">{html.escape(s[-tail:])}</span></span>'

def ref_row(h):
    return (f'      <div class="pc-ref"><a class="pc-ref-main" href="{h["universalLink"]}" target="_blank" rel="noreferrer">'
            f'<span class="pc-ref-handle">{html.escape(h["handle"])}</span><span class="pc-ref-preview">{html.escape(h["preview"])}</span>{lucide(G["external"], 13)}</a>'
            f'<button type="button" class="pc-copy" aria-label="Copy AT URI of the post by {html.escape(h["handle"])}">{lucide(G["copy"])}</button></div>\n')

def sheet():
    did = hit['did']; rkey = hit['rkey']; handle = hit['handle']
    at_uri = f'at://{html.escape(did)}/<br>{hit["collection"]}/<b>{rkey}</b>'
    link = f'aturi.to/profile/<b>{handle}</b>/<br>post/<b>{rkey}</b>'
    rows = ''
    rows += ledger_row('AT URI', at_uri, stacked=True)
    rows += ledger_row('DID', html.escape(did), copied=True)
    rows += ledger_row('Handle', html.escape(handle))
    rows += ledger_row('PDS', html.escape(hit['pdsHost']), label_for='PDS host')
    rows += ledger_row('CID', mid(hit['cid'], 0, 6))
    rows += ledger_row('Link', link, stacked=True, label_for='aturi.to link')
    return f'''    <section class="pc-sheet" id="pc-sheet" role="dialog" aria-modal="true" aria-labelledby="pc-sheet-title">
      <div class="pc-sheet-head">
        <button type="button" class="pc-back">{lucide(G['chev-down'], 15, 2.4)}<span>Back</span></button>
        <div class="pc-sheet-title"><b id="pc-sheet-title">Post by dame.is</b><span>Bluesky post · declared by the page</span></div>
      </div>
      <div class="pc-ledger">
{rows}      </div>
      <a class="pc-band" href="{hit['universalLink']}" target="_blank" rel="noreferrer">{lucide(G['compass'], 15)}<span class="pc-band-label">Open on aturi.to</span><span class="pc-band-sub">record, PDS, raw JSON, links in</span>{lucide(G['external'])}</a>
      <div class="pc-refs">
        <h3 class="pc-refs-label">Also on this page <span class="pc-count">· {len(refs)}</span><span class="pc-refs-note">other posts this page references</span></h3>
{''.join(ref_row(h) for h in refs)}      </div>
    </section>
'''

def shell(body):
    return f'<div class="popup-shell">\n{topbar()}{body}</div>\n'

# post.html: the pulled state. The resting body sits behind, dimmed and inert.
post = shell(
    '  <div class="pc-stage">\n'
    '    <div class="pc-behind" inert aria-hidden="true">\n' + rest_body(pulled=True) + '    </div>\n'
    '    <button type="button" class="pc-scrim" aria-label="Put the card back"></button>\n' + sheet() + '  </div>\n')

rest = shell(rest_body())
rest_on = shell(rest_body(on=True))

# nopage.html
def chip(wid, name, host):
    return (f'      <a class="pc-chip" href="https://{html.escape(host)}" target="_blank" rel="noreferrer" title="{html.escape(host)}">'
            f'<span class="popup-waypoint-icon">{mark(wid)}</span><span>{html.escape(name)}</span></a>\n')

def chip_drawer(g):
    return (f'  <section class="popup-section is-sheet">\n    <h2 class="popup-section-label">{html.escape(g["label"])}</h2>\n'
            f'    <div class="pc-chips">\n{"".join(chip(*i[:3]) for i in g["items"])}    </div>\n  </section>\n')

recent = [data['hits'][0], data['hits'][6], data['hits'][2]]
def recent_row(h):
    return (f'      <div class="popup-waypoint"><a class="popup-waypoint-main" href="{h["universalLink"]}" target="_blank" rel="noreferrer">'
            f'<span class="popup-icon-letter">{html.escape(h["handle"][0].upper())}</span>'
            f'<span class="popup-waypoint-name">{html.escape(h["handle"])}</span><span class="popup-waypoint-desc">{html.escape(h["kind"])} · {html.escape(h["preview"])}</span></a>'
            f'<button type="button" class="popup-waypoint-copy" aria-label="Copy AT URI">{lucide(G["copy"])}</button></div>\n')

nopage = shell(f'''  <main class="popup-body">
  <div class="popup-root">
  <section class="popup-section is-sheet pc-page">
    <div class="pc-tabs"><span class="pc-tab">This page</span></div>
    <div class="popup-page pc-card pc-nodata">
      <div class="popup-page-head">
        <div class="popup-page-avatar pc-mark">{lucide(G['compass'], 16)}</div>
        <div class="popup-page-text">
          <span class="popup-page-title">No Atmosphere record on this page</span>
          <span class="popup-page-meta">The address, the page head and the text name no post, profile, list or feed.</span>
        </div>
      </div>
      <form class="pc-lookup" action="https://aturi.to" method="get">
        <label class="pc-lookup-label" for="pc-lookup">Look something up instead</label>
        <div class="pc-lookup-row">
          <input id="pc-lookup" class="aturi-input" type="text" placeholder="Handle, DID or at:// URI" autocomplete="off" spellcheck="false">
          <button type="submit" class="aturi-btn aturi-btn-primary">Open</button>
        </div>
        <span class="pc-lookup-note">Opens on aturi.to: the record, its PDS, raw JSON and links in.</span>
      </form>
    </div>
  </section>
  <section class="popup-section is-sheet">
    <h2 class="popup-section-label">Recent</h2>
    <div class="popup-waypoints">
{''.join(recent_row(h) for h in recent)}    </div>
  </section>
  <div class="popup-jump-head"><h2 class="popup-jump-title">Jump to an app</h2><span class="popup-jump-note">Shortcuts open each app's home page</span></div>
{''.join(chip_drawer(g) for g in wp['nopage']['groups'])}{redirect_row()}  </div>
  </main>
''')

for name, content in [('post.html', post), ('rest.html', rest), ('rest-on.html', rest_on), ('nopage.html', nopage)]:
    with open(os.path.join(HERE, name), 'w') as f:
        f.write(content)
    print('wrote', name, len(content))

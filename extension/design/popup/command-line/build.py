# Builds post.html, nopage.html and post-typed.html for the "Command line"
# model from the fixtures (waypoints.json, data.json, icons.json).
# Run: python3 -I build.py
import json, os, html

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
W = json.load(open(os.path.join(ROOT, 'waypoints.json')))
D = json.load(open(os.path.join(ROOT, 'data.json')))
ICONS = json.load(open(os.path.join(ROOT, 'icons.json')))
BY_NAME = {v['name']: v['svg'] for v in ICONS.values()}

def esc(s):
    return html.escape(s, quote=True)

# ---------- UI glyphs (lucide, 24x24) ----------
def glyph(name, size=14, sw=2):
    paths = {
        'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
        'check': '<path d="M20 6 9 17l-5-5"/>',
        'external': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
        'compass': '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
        'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        'sliders': '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
        'shuffle': '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
        'moon': '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
        'refresh': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
        'at': '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
        'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
        'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
        'leaf': '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
        'corner-down-left': '<path d="M20 4v7a4 4 0 0 1-4 4H4"/><path d="m9 10-5 5 5 5"/>',
    }[name]
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths}</svg>')

def wp_icon(name):
    return f'<span class="popup-waypoint-icon">{BY_NAME[name]}</span>'

# ---------- Head: brand row + the field ----------
def head(value='', placeholder='Go to a handle, DID or at:// URI'):
    val = f' value="{esc(value)}"' if value else ''
    return f'''<header class="popup-topbar cl-head" data-sticky>
  <div class="cl-head-row">
    <a class="popup-title" href="https://aturi.to" title="aturi.to">{glyph('leaf', 20, 2.2)}<span>aturi</span></a>
    <div class="popup-topbar-actions">
      <button type="button" class="popup-icon-btn" aria-label="Open extension settings">{glyph('sliders', 17)}</button>
    </div>
  </div>
  <label class="cl-field is-focused">
    <span class="cl-field-icon">{glyph('search', 15)}</span>
    <span class="cl-sr-only">{esc(placeholder)}</span>
    <input class="cl-input" type="text" autocomplete="off" spellcheck="false" placeholder="{esc(placeholder)}"{val} role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="cl-results">
  </label>
</header>'''

# ---------- Rows ----------
def keys(primary, secondary=None):
    # The selected row's description becomes its key legend.
    out = f'<span class="cl-keys"><kbd class="cl-kbd">↵</kbd><span class="cl-keys-word">{esc(primary)}</span>'
    if secondary:
        out += f'<kbd class="cl-kbd">⌘↵</kbd><span class="cl-keys-word">{esc(secondary)}</span>'
    return out + '</span>'

def app_row(name, host, verb, absent=False, selected=False, open_word=None):
    cls = 'popup-waypoint cl-row'
    if absent: cls += ' is-absent'
    if selected: cls += ' is-selected'
    if absent:
        desc = '<span class="popup-waypoint-desc">No records found on this repo</span>'
    elif selected:
        desc = keys(open_word or f'Open on {host}', 'Copy link')
    else:
        desc = f'<span class="popup-waypoint-desc">{esc(verb)} {esc(host)}</span>'
    sel = ' aria-selected="true"' if selected else ''
    return (f'<div class="{cls}" role="option"{sel}>'
            f'<button type="button" class="popup-waypoint-main">{wp_icon(name)}'
            f'<span class="popup-waypoint-name">{esc(name)}</span>{desc}</button>'
            f'<button type="button" class="popup-waypoint-copy" aria-label="Copy the {esc(name)} link">{glyph("copy")}</button>'
            f'</div>')

def guide(label, count=None, highlighted=False):
    cls = 'cl-guide' + (' is-highlighted' if highlighted else '')
    c = f'<span class="cl-guide-count">{count}</span>' if count is not None else ''
    return f'<div class="{cls}" role="presentation"><span>{esc(label)}</span>{c}</div>'

def verb_for(item_id, host):
    # The shipped descriptions on the post page ("View post on", "View
    # profile on", "Inspect record on", ...): mirrored from the current
    # render so the rows say what they say today.
    profile = {'leaflet', 'margin', 'streamplace', 'grain', 'popfeed', 'tangled'}
    if item_id in profile: return 'View profile on'
    if item_id == 'anisota-reader': return 'View publications on'
    if item_id in ('offprint', 'pckt'): return 'View on'
    if item_id == 'standard-reader': return 'View documents on'
    if item_id in ('aturi-explore', 'taproot'): return 'Inspect record on'
    if item_id in ('pdsls', 'atp-tools'): return 'View raw record on'
    return 'View post on'

def sheet(label, body, aside=None, section_id=None, count=None):
    idattr = f' id="{section_id}"' if section_id else ''
    c = f' <span class="cl-tab-count">· {count}</span>' if count is not None else ''
    aside_html = f'<div class="cl-tabline-aside">{aside}</div>' if aside else ''
    return (f'<section class="popup-section is-sheet cl-sheet"{idattr}>'
            f'<div class="cl-tabline"><h2 class="popup-section-label">{esc(label)}{c}</h2>{aside_html}</div>'
            f'{body}</section>')

# ---------- This page: the record as the first result card ----------
def ledger_row(key, value_html, copied=False, stacked=False, title=None):
    cls = 'cl-row cl-ledger-row' + (' is-copied' if copied else '') + (' is-stacked' if stacked else '')
    t = f' title="{esc(title)}"' if title else ''
    tell = (f'<span class="cl-copy is-copied" aria-hidden="true">{glyph("check")}</span>' if copied
            else f'<span class="cl-copy" aria-hidden="true">{glyph("copy")}</span>')
    label = 'Copied' if copied else key
    aria = f'Copy {key}' if not copied else f'{key} copied'
    return (f'<button type="button" class="{cls}" role="option" aria-label="{esc(aria)}"{t}>'
            f'<span class="cl-ledger-key">{esc(label)}</span>'
            f'<span class="cl-ledger-val">{value_html}</span>{tell}</button>')

def this_page_sheet(hit, refs_count):
    h = hit
    uri = h['uri']
    did, coll, rkey = h['did'], h['collection'], h['rkey']
    at_html = (f'<span class="cl-mono-dim">at://</span>{esc(did)}/<wbr>'
               f'<span class="cl-mono-dim">{esc(coll)}/</span><wbr><b>{esc(rkey)}</b>')
    link = h['universalLink'].replace('https://', '')
    link_head, link_tail = link.rsplit('/', 1)
    link_html = f'<span class="cl-mono-dim">{esc(link_head)}/</span><wbr><b>{esc(link_tail)}</b>'
    cid = h['cid']
    # Head and tail of the CID; the extension would measure, the mock
    # keeps 26 + 6 characters, what the line holds at the medium preset.
    cid_html = f'{esc(cid[:26])}<span class="cl-mono-dim">…</span>{esc(cid[-6:])}'
    rows = [
        ledger_row('AT URI', at_html, stacked=True, title=uri),
        ledger_row('DID', esc(did), copied=True, title=did),
        ledger_row('Handle', esc(h['handle']), title=h['handle']),
        ledger_row('PDS', esc(h['pdsHost']), title=h['pds']),
        ledger_row('CID', cid_html, title=cid),
        ledger_row('Link', link_html, title=h['universalLink']),
    ]
    head_html = (f'<div class="cl-record-head">'
                 f'<span class="popup-page-avatar" aria-hidden="true">D</span>'
                 f'<span class="popup-page-text">'
                 f'<span class="popup-page-title">Post by {esc(h["handle"])}</span>'
                 f'<span class="popup-page-meta"><span class="popup-source-collection">{esc(coll)}</span> · on Bluesky · canonical</span>'
                 f'</span></div>')
    band = (f'<a class="cl-row cl-band" role="option" href="{esc(h["explorer"])}">'
            f'{glyph("compass", 16)}<span class="cl-band-title">Open on aturi.to</span>'
            f'<span class="cl-band-note">record, PDS, raw JSON, links in</span>{glyph("external", 15)}</a>')
    body = f'<div class="cl-card">{head_html}<div class="cl-ledger" role="group" aria-label="Identifiers; click one to copy it">{"".join(rows)}</div>{band}</div>'
    aside = (f'<a class="cl-jump" href="#also">Also on this page · {refs_count} {glyph("arrow-down", 12)}</a>')
    return sheet('This page', body, aside=aside)

# ---------- Open in: the waypoints as result rows ----------
def open_in_sheet(selected_first=True, filter_text=None):
    P = W['post']
    rows = []
    def keep(name, host, group):
        if not filter_text: return True
        f = filter_text.lower()
        return f in name.lower() or f in host.lower()
    rec = [i for i in P['recommended']['items'] if keep(i[1], i[2], 'rec')]
    if rec:
        rows.append(guide(P['recommended']['label'], highlighted=True))
        for n, (iid, name, host) in enumerate(rec):
            rows.append(app_row(name, host, verb_for(iid, host), selected=(selected_first and n == 0 and not filter_text)))
    first_done = bool(rec) and selected_first
    for g in P['groups']:
        items = [i for i in g['items'] if keep(i[1], i[2], g['label'])]
        if not items: continue
        rows.append(guide(g['label'], count=len(g['items']) if not filter_text else None))
        for i in items:
            iid, name, host = i[0], i[1], i[2]
            absent = len(i) > 3 and i[3] == 'absent'
            sel = (not first_done) and selected_first
            rows.append(app_row(name, host, verb_for(iid, host), absent=absent, selected=sel))
            if sel: first_done = True
    if not rows: return ''
    body = f'<div class="popup-waypoints cl-list" role="group">{"".join(rows)}</div>'
    return sheet('Open in', body)

# ---------- Also on this page: the referenced records ----------
def ref_row(h, selected=False):
    cls = 'cl-row cl-ref' + (' is-selected' if selected else '')
    letter = h['handle'][0].upper()
    desc = (keys('Open on aturi.to', 'Copy at:// URI') if selected
            else f'<span class="cl-ref-preview">{esc(h["preview"])}</span>')
    return (f'<div class="{cls}" role="option"{" aria-selected=true" if selected else ""}>'
            f'<a class="cl-ref-main" href="{esc(h["explorer"])}">'
            f'<span class="cl-avatar-sm" aria-hidden="true">{letter}</span>'
            f'<span class="cl-ref-handle">{esc(h["handle"])}</span>{desc}</a>'
            f'<button type="button" class="popup-waypoint-copy" aria-label="Copy the at:// URI of this post by {esc(h["handle"])}">{glyph("copy")}</button>'
            f'</div>')

def also_sheet(filter_text=None):
    refs = [h for h in D['hits'] if h['n'] >= 3]
    if filter_text:
        f = filter_text.lower()
        refs = [h for h in refs if f in h['handle'].lower() or f in h['preview'].lower()]
    if not refs: return ''
    body = (f'<div class="popup-waypoints cl-list" role="group">'
            f'{guide("Posts this page refers to · found in its structured data")}'
            f'{"".join(ref_row(h) for h in refs)}</div>')
    return sheet('Also on this page', body, section_id='also', count=len(refs))

# ---------- Extension: the settings rows ----------
def setting_row(icon, title, desc, control_html='', href=None, selected=False):
    tag = 'a' if href else 'button'
    extra = f' href="{esc(href)}"' if href else ' type="button"'
    cls = 'cl-row cl-setting' + (' is-selected' if selected else '')
    return (f'<{tag} class="{cls}" role="option"{extra}>'
            f'<span class="cl-setting-icon">{icon}</span>'
            f'<span class="cl-setting-text"><span class="cl-setting-title">{esc(title)}</span>'
            f'<span class="cl-setting-desc">{esc(desc)}</span></span>{control_html}</{tag}>')

def extension_sheet(with_scan=True, filter_text=None):
    rows = [
        setting_row(glyph('shuffle', 16), 'Auto-redirect', 'Off · links open where they are',
                    '<span class="aturi-switch aturi-switch-sm" aria-hidden="true"><span class="aturi-switch-box"></span></span>'),
        setting_row(glyph('moon', 16), 'Theme', 'Light · switch to dark'),
    ]
    if with_scan:
        rows.append(setting_row(glyph('refresh', 16), 'Scan again', 'Re-read this page for records'))
    rows.append(setting_row(glyph('sliders', 16), 'All settings', 'Groups, waypoints, appearance',
                            glyph('external', 14), href='#settings'))
    if filter_text:
        f = filter_text.lower()
        rows = [r for r in rows if f in r.lower()]
        if not rows: return ''
    body = f'<div class="popup-waypoints cl-list" role="group">{"".join(rows)}</div>'
    return sheet('Extension', body)

def goto_row(text):
    return (f'<section class="popup-section is-sheet cl-sheet cl-goto-sheet">'
            f'<div class="popup-waypoints cl-list"><a class="cl-row cl-goto" role="option" href="https://aturi.to/{esc(text)}">'
            f'{glyph("at", 16)}<span class="cl-goto-text">Go to <b>{esc(text)}</b> on aturi.to</span>'
            f'<span class="cl-goto-note">handle, DID or at:// URI</span>{glyph("external", 14)}</a></div></section>')

# ---------- Pages ----------
def shell(head_html, body_html):
    return f'''<div class="popup-shell cl-shell">
{head_html}
<main class="popup-body">
  <div class="popup-root cl-results" id="cl-results" role="listbox" aria-label="Results">
{body_html}
  </div>
</main>
</div>
'''

def post_page():
    hit = D['hits'][0]
    refs = [h for h in D['hits'] if h['n'] >= 3]
    body = '\n'.join([
        this_page_sheet(hit, len(refs)),
        open_in_sheet(),
        also_sheet(),
        extension_sheet(),
    ])
    return shell(head(), body)

def post_typed_page(text='lea'):
    # Filtered state: the field holds "lea"; only matching rows remain.
    # The first remaining row is selected.
    body = '\n'.join(x for x in [
        open_in_sheet(selected_first=True, filter_text=text),
        also_sheet(filter_text=text),
        extension_sheet(filter_text=text),
        goto_row(text),
    ] if x)
    return shell(head(value=text), body)

def nopage_page():
    N = W['nopage']
    notice = (f'<p class="cl-notice">{glyph("compass", 14)}<span class="cl-notice-text">No Atmosphere record on this page.</span>'
              f'<button type="button" class="cl-notice-action">{glyph("refresh", 13)}Scan again</button></p>')
    # Recent repos: handles the person has looked at (fixture handles).
    recents = [
        ('dame.is', 'pds.atpota.to', 'D'),
        ('mitsuhiko.at', 'puffball.us-east.host.bsky.network', 'M'),
        ('kyefox.com', 'puffball.us-east.host.bsky.network', 'K'),
    ]
    rrows = []
    for n, (handle, pds, letter) in enumerate(recents):
        sel = n == 0
        desc = keys('Open on aturi.to', 'Copy DID') if sel else f'<span class="cl-ref-preview">{esc(pds)}</span>'
        rrows.append(f'<div class="cl-row cl-ref{" is-selected" if sel else ""}" role="option"{" aria-selected=true" if sel else ""}>'
                     f'<a class="cl-ref-main" href="https://aturi.to/{esc(handle)}">'
                     f'<span class="cl-avatar-sm" aria-hidden="true">{letter}</span>'
                     f'<span class="cl-ref-handle">{esc(handle)}</span>{desc}</a>'
                     f'<button type="button" class="popup-waypoint-copy" aria-label="Copy the DID of {esc(handle)}">{glyph("copy")}</button></div>')
    recent = sheet('Recent', f'<div class="popup-waypoints cl-list" role="group">{"".join(rrows)}</div>',
                   aside='<span class="cl-tabline-note">repos you looked at</span>')
    arows = []
    for g in N['groups']:
        arows.append(guide(g['label'], count=len(g['items'])))
        for iid, name, host in g['items']:
            arows.append(app_row(name, host, 'Open', open_word=f'Open {host}'))
    apps = sheet('Open an app', f'<div class="popup-waypoints cl-list" role="group">{"".join(arows)}</div>',
                 aside='<span class="cl-tabline-note">each app’s home page</span>')
    body = '\n'.join([notice, recent, apps, extension_sheet(with_scan=False)])
    return shell(head(), body)

for name, fn in [('post.html', post_page), ('nopage.html', nopage_page), ('post-typed.html', post_typed_page)]:
    with open(os.path.join(HERE, name), 'w') as f:
        f.write(fn())
    print('wrote', name)

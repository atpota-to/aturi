# Two tabs, renamed: "Open in" and "This page"

## The model

The smallest change that fixes what the tabs mean. The folder tabs stay on the top bar, but they stop splitting one page's story by *kind of content* (a list vs. an inspector) and split it by *what the user wants to do*: **Open in** is where to go, **This page** is what this is. Open in is today's Waypoints tab with the page card shrunk to one line (title, collection, and a chevron into This page); the recommended drawer and the five groups are untouched. This page is one index card for the page's record: who and what it is, where the extension found it, a six-line ledger of identifiers where every line is a copy button, and one band out to aturi.to; under it, the other records the page references, filed in their own drawer, and a status row for auto-redirect on this page. The global switch leaves the footer for Settings; the footer is gone when auto-redirect is off and becomes a one-line status strip, with the per-tab pause, when it is on. The theme toggle goes to Settings › Appearance. On a page with nothing, This page holds the notice, a lookup field and recent repos, and Open in holds the home-page shortcuts.

Files: `post.html` (post page, Open in: the landing), `post-thispage.html` (post page, This page), `post-on.html` (Open in with auto-redirect on: the status strip), `post-thispage-on.html` (This page with auto-redirect on: the pause row), `nopage.html` (no-data page, This page: the landing there), `nopage-openin.html` (no-data page, Open in: shortcuts), `style.css` (overrides and `.tt-*` additions, tokens only), `build.mjs` (writes the six pages from the fixtures and `icons.json`; `node build.mjs`), `render-extra.mjs` (renders the four pages `render.mjs` does not: `node render-extra.mjs`), `measure.mjs` (prints any box edge that is not on a whole pixel).

Renders: `post-light__view.png`, `post-light__full.png` (1533px), `post-dark__view.png`, `nopage-light__view.png` (600px viewport; the content ends at 455px and the real popup would be that tall), `nopage-dark__view.png`; extras `post-thispage-{light,dark}__view.png` and `post-thispage-light__full.png` (771px), `post-on-*`, `post-thispage-on-*` (779px), `nopage-openin-*` (1501px).

## Regions

**Top bar** (48px, sticky). Brand mark top-left. Two folder tabs: Open in, This page. Settings glyph. No theme toggle, no count badge on the tab: the toolbar badge already carries the count, and the tab's name says what is behind it, which the badge used to have to do.

**Open in** (the landing on a page with a record).
- *The record line.* One 40px index card: "Post by dame.is", then `app.bsky.feed.post · on Bluesky` in the quiet tone, then a chevron. The whole line is a button that opens This page. It answers "what did the extension find?" in one line and points at the card that says more; it no longer carries copy buttons, so the copy job lives in one place.
- *Recommended for Posts* and the five groups, exactly as today: drawer tabs, white boxes, 40px rows, hover-only copy-link glyph.
- *Footer.* None when auto-redirect is off. When it is on, a 36px sticky status strip: "Auto-redirect on · posts open in Anisota · Pause on this tab". A line, not a control; the switch is in Settings.

**This page.**
- *The index card.* Head: "Bluesky post by dame.is" and where it was found ("Declared by the page as canonical · also in the address bar"). Ledger: AT URI, DID, Handle, PDS, CID, Link. The label sits in a 54px column, the value in Plex Mono; the AT URI and the link take two lines with the rkey and handle in ink, the CID is cut in the middle so its distinctive tail stays. Every line is one button: click or Enter copies, the label turns to "Copied" in moss and the glyph box fills (the DID line is drawn copied). Bottom band: "Open on aturi.to · record, PDS, raw JSON, links in", the one hand-off.
- *Also on this page · 5.* A drawer under the card: one 40px row per referenced record, handle in bold, the post's first line in the quiet tone, a copy glyph for its AT URI. The row opens the record on aturi.to; the glyph copies. "Scan again" sits on the drawer's top edge, right.
- *Auto-redirect.* A filed status row at the end. Off: "Auto-redirect · Off · Settings" (Settings opens the options page at the redirect section). On: two lines, "Auto-redirect on / Posts open in Anisota", and "Pause on this tab".

**No-data page.**
- *This page* (the landing there): the notice, a "Look up" field (handle, DID or at:// URI; Go opens it on aturi.to, or in the favourite client when auto-redirect is on), and a "Recent repos" drawer of handles with visit counts; the row opens the repo on aturi.to.
- *Open in*: one quiet line ("No record on this page, so these shortcuts open each app's home page") and the five groups as tile panels, three to a row, as today.

## The three jobs, in clicks

- **Jump.** 0 clicks to see it, 1 to do it: the popup opens on Open in with the recommended app first; click a row. Copy an app's link: hover the row, click the glyph (as today).
- **Copy.** 2 clicks: This page, then the ledger line (the whole line, not just the glyph). Keyboard: Tab to the line, Enter. The chevron on the record line is a second way into This page.
- **Hand off.** 2 clicks: This page, then "Open on aturi.to". Also 1 click from Open in, because Aturi is a waypoint in the Atmosphere group (and one click when it is the recommended or a recent).

## Where things went

- *Inspect's content* became This page: the page's own record as a ledger (copies, which belong in the popup), the hand-off band (the full information belongs on aturi.to), and the referenced records as a short list in a drawer named for what it is ("Also on this page · 5") instead of a tab named for a verb. The raw JSON, engagement counts, explorer breadcrumb and per-record chips are gone from the popup; they are one click away on aturi.to.
- *Auto-redirect, the switch:* Settings. It is global and changed rarely; it had the most prominent fixed slot in the popup.
- *Auto-redirect, the state and the pause:* on This page as a status row (always), and as the one-line strip on Open in when on. The pause is per-tab, so it belongs where the user lands right after a redirect, and that is Open in; the strip exists only in that state.
- *Theme:* Settings › Appearance (follows the system by default). It was a once-changed setting holding a permanent top-bar slot the tabs need now that their labels are longer.
- *Settings:* the top bar's only icon, where it was.
- *Scan again:* on the "Also on this page" drawer's edge, since that list is what a rescan rebuilds.
- *Lookup and recents:* This page on a no-data page, where "nothing here" needs a next step.

## What I dropped, and why

- The two copy buttons on the page card. They made the copy job live in two places; the ledger is the one place.
- The count badge on the tab. The toolbar badge carries the count; the tab's name now carries its meaning.
- The theme toggle from the top bar, and the global switch from the footer (both to Settings).
- Inspect's per-record detail (preview card, engagement, breadcrumb, raw JSON disclosure, five chips per record, PDS links). The record's preview survives as one quiet line in the references list; everything else is on aturi.to.
- The "Jump to an app" heading on the no-data shortcuts: the tab says it.

## How it scales

- *40 references:* the drawer shows six rows and a "Show all 40" row that extends the list in place; the drawer tab says "Also on this page · 40". The index card and the status row never move.
- *A profile page (no rkey):* the ledger loses CID and the AT URI is `at://did…` on one line; Link is `aturi.to/profile/dame.is`; the head says "Bluesky profile · dame.is"; Open in says "dame.is · profile · on Bluesky". Everything else is the same.
- *One waypoint group:* Open in is the record line, Recommended, and one drawer; the tabs are still right because This page is independent of how many apps there are.
- *Long handles and hosts:* the record line and the reference rows ellipsize the quiet part first (the host or the preview) and keep the name; ledger values wrap at slashes, so a 60-character handle takes a second line rather than a cut.
- *Text-size presets:* everything is in `--fs-*` and the 40px rows grow with the line box, as the shipped rows do.

## Trade-offs I accept

- Two of the three jobs are one tab away from the landing. That is the cost of keeping tabs: copy and hand-off are two clicks instead of one. The chevron on the record line and the Aturi waypoint soften it; they do not remove it.
- The per-tab pause appears in two places when auto-redirect is on (the strip on Open in, the row on This page). I prefer that duplication to a pause that is two clicks away right after a redirect.
- The no-data page lands on a different tab (This page) than a record page does (Open in). The rule is "open on the tab that has something to say about this page"; if the extension remembers the last tab instead, the notice must still appear on Open in as the one quiet line it has now, and the lookup field stays one click away.
- The shortcuts on a no-data page are still thirty tiles. They are behind a tab now rather than under the notice, and the landing has one useful thing to do instead of a wall, but the wall itself is not solved by this model.
- Dark: the filed tab sits on `--surface-filed`, near-black on the dark page, as the shipped popup does; it holds, but the filed tab is quieter than in light.

## If I were not bound to the assigned model

- I would put a lookup field at the end of This page on record pages too, not only on no-data pages. A field that appears only when the page has nothing looks like it went missing.
- I am not sure the Off status row on This page earns its 40px. It answers "is auto-redirect on?" at a glance, which is the only reason it stays; without that reason I would show the row only when on, with the pause.
- "This page" is the honest name, and it pairs with "Open in" as a phrase, but it is abstract until the tab has been opened once. "Record" is shorter and says what the card is; it fails on a no-data page. I kept This page.
- The one-line record card gives up the one-click copy of the aturi.to link, which is probably the single most common copy. If that regression shows up in use, a single copy glyph for the link on that line is the fix, at the cost of reintroducing the "same job in two places" the brief named.

## Hairlines

`measure.mjs` reports every bordered box's edges; after three rounds all top and bottom edges on every page are on whole pixels (the card head is 56px, ledger lines 40px, tall lines 69px, the band 38px, tiles 88px with 7px column gaps so the three columns are 108px each). The only fractional edges left are the right edges of the fit-content folder and drawer tabs, which are text-width and the same in the shipped popup.

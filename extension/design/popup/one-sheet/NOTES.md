# One sheet, no tabs

## The model

The popup is one scroll, read top to bottom like a card pulled from the catalog with its folder behind it. The top bar holds the brand and the settings glyph, nothing else. The first thing on the sheet is the page's record as an index card: who and what it is, its six identifiers as a ledger where every line copies on click, and one way out to aturi.to. Under the card is where to open the record: the recommended apps, then the five groups exactly as today. At the end of the sheet sit two things a user reaches for less often, filed a step below the page: the other records the page refers to, in a drawer that is closed until pulled, and the auto-redirect row. There is nothing to switch between. The three jobs are three regions of one page, in the order people want them: what is this, where can I open it, what else is here.

Files: `post.html`, `nopage.html`, `style.css` (overrides and `.os-*` additions, tokens only), `build.mjs` (writes the two pages from the fixtures and `icons.json`; `node build.mjs`), `render-extra.mjs` (the states `render.mjs` does not cover: the drawer pulled open, auto-redirect on, a group opened on the no-data page).

Renders: `post-light__view.png`, `post-light__full.png` (1920px), `post-dark__view.png`, `nopage-light__view.png` (600px, nothing to scroll); extras `post-end-open-light__view.png`, `post-redirect-on-light__view.png`, `post-redirect-on-end-light__view.png`, `nopage-group-open-light__view.png`.

## Regions

- **Top bar** (sticky, `data-sticky`): brand mark and "aturi" left; settings right. When auto-redirect is on, a moss shuffle mark appears beside settings; it jumps to the auto-redirect row at the end. Off, the bar is only the brand and settings.
- **Index card** (This page): the letter avatar, "Post by dame.is", then `app.bsky.feed.post · declared by the page`. The second half of that line is the where-label (`in the address bar`, `in structured data`, `in the page text`), so the user can see why the extension thinks this is the page's record. Then the ledger: AT URI, Link, DID, Handle, PDS, CID, one line each, 28px, hairlines between; the two long ones wrap at a slash so the record's full name is on the card. The whole line is the copy button; the glyph at the right is its affordance, and a copied line turns its label to "Copied" with a tick (the DID line in `post.html`). The card's foot is one band: "Open on aturi.to · record · raw JSON · PDS · links in".
- **Waypoints**: "Recommended for Posts", then Bluesky Clients, Bluesky Forks, Publications, Atmosphere, Dev Tools, unchanged (row opens, the hover glyph copies that app's link, absent rows dimmed). The new-waypoints banner keeps its slot between the card and the first drawer.
- **Filed drawer "Also on this page · 5"**: closed by default; the tab and the box take `--surface-filed`, a step below the page, and come up to white when pulled. The front says what it holds ("Posts this page refers to") and previews the handles. Pulled: one line per record, 36px: the handle, the post's preview text, and a copy-AT-URI glyph; the line itself opens the record on aturi.to.
- **Auto-redirect row**: the last thing on the sheet, a plain row with a hairline above, not sticky (the shell's min-height still pins it to the bottom edge on the short no-data page). Icon, "Auto-redirect", Off and the switch. On: "Posts open in Anisota" under the name, "Pause on this tab" beside the switch. Paused: the row alone goes amber, as today's strip did, but it is a row at the end, not the loudest thing in the popup.

## The three jobs, in clicks

- **Jump**: 1 click on a waypoint row. The two recommended rows are at y≈420 and y≈460 (1x) in the first 600px.
- **Copy**: 1 click on a ledger line. Keyboard: the popup gives focus to the AT URI line when it opens, so Enter copies the AT URI; Tab walks down the ledger, then to the band and the rows. That is the keyboard path the current popup lacks.
- **Hand off**: 1 click on the band at the foot of the card. For a referenced record: 2 clicks (pull the drawer, click the line), and the line's copy glyph is 2 clicks as well.

## Where Inspect's content went

- The identifiers: into the index card as the ledger. They are on the page's own record, in the first 600px, next to the record's name.
- The referenced records: to the end of the sheet as the filed drawer. They are about this page, but they are the rarest thing a user comes for, and putting them under the card would push the first jump row below y=500. The tab's count is the references only ("· 5"); the page's own record found two ways is one record, so the "7" the badge counts today becomes 5 here (the badge should count the same, or show a dot).
- Preview text, engagement counts, the breadcrumb, raw JSON, "PDS in Explorer": on aturi.to, behind the band. The owner's instinct (copies in the popup, information on the site) is the model's rule.
- "Scan again": kept on the no-data page's notice line, where a stale scan is the likeliest reason to be looking at it. The post page scans when it opens; if the owner wants it there too, the drawer front has room for a refresh glyph.

## Where the rest went

- **Auto-redirect**: the row at the end. It is global and rarely touched, so it should not hold the bottom edge of every page, but its state must be visible: scroll to the end, or, when it is on, the moss mark in the bar says so from anywhere and jumps to the row. The per-tab pause sits on that row, next to the state it pauses.
- **Theme**: dropped from the bar. The popup follows the system; the setting lives under Settings → Appearance for the people who want to pin it. One click more for a once-ever change, in exchange for a bar that holds only the brand and the way to settings.
- **Settings**: the bar's glyph, top right, reachable at any scroll.

## Dropped, and why

- The mode tabs and the Inspect count badge: one page's story in one place.
- The theme toggle in the bar: a setting changed once.
- The sticky footer: a global switch should not look like a per-page control.
- The page card's two buttons: the ledger does what they did and four more.
- The copy chips, the raw JSON disclosure, engagement, the breadcrumb, the per-card "Open in Explorer": the band, and aturi.to.
- The thirty tiles on the no-data page: the groups collapsed to a line each, with their marks.
- The three-paragraph no-data notice: one line.

## No-data page

A one-line notice (compass, "No Atmosphere data on this page", "Scan again"), then the one useful thing the popup never had: a lookup field (handle, DID or at:// URI → opens on aturi.to, the site's go-to field in the popup), then "Seen lately" (repos the extension has seen on pages recently: handle, PDS, how many pages; the row opens the profile on aturi.to), then "Jump to an app" as one box of five group fronts, each with the group's marks and a count of the rest; a front opens to its app rows (name, home host). The page fits in 600px with nothing to scroll; an app's home page is two clicks, anything typed is one. "Seen lately" needs a small local log the extension may not keep yet; without it the page is the field and the groups, which is still better than the wall.

## How it scales

- **40 references**: the tab says "· 40", the front previews the first handles; pulled, the drawer shows ten lines and a "Show 30 more" line (`.os-ref-more` is styled for it), so the drawer never runs past ~400px, and because it sits below the waypoints it never pushes a jump row down.
- **A profile page** (no rkey): the ledger has five lines, all one line tall: AT URI (`at://did:plc:…`), Link (`aturi.to/profile/dame.is`), DID, Handle, PDS; CID is omitted, or shows the profile record's. The head reads "dame.is" + `profile · in the address bar`. The card is ~60px shorter, so the fold shows the first group's four rows.
- **One group or six**: the sheet is as long as the groups; the model does not care.
- **Long handles and hosts**: the AT URI and Link lines wrap at a slash (a `did:web:` with a long domain wraps the same way); Handle and PDS end-truncate; a drawer line's handle takes at most 55% of the row and the preview the rest.
- **The compact preset**: the waypoint rows shrink as today; the ledger stays, since 28px lines are already compact.

## Trade-offs I accept

- The card costs ~300px of the first 600 (1x: the band ends at y=364, the first jump row starts at y≈420). I chose the identifiers whole over a tighter card because this is an index card and should name the record in full. If the owner wants the jumps higher, the ledger can start as AT URI + Link with a "4 more" line, which saves ~115px.
- The auto-redirect switch is at the end of a 1900px sheet. Turning it on is a once-ever act (settings is one click away and has it too); the mark in the bar covers "why was I redirected" and "pause this tab" without a scroll.
- A referenced record is two clicks, as it was (tab, then row), and the drawer's front line is a little explanatory text ("Posts this page refers to") that a repeat user will stop reading.
- The mock uses `<details>` with no script; the real popup would remember the drawer's state and the opened group on the no-data page.
- `:has()` colours the drawer's tab with the drawer; both target browsers support it.

## Where I would push back on the assignment

Only one place: the brief's "a compact ledger or row of the identifiers" tempts a chip row (six chips, 36px) to keep the jumps high. I built the ledger and would keep it: a row of chips says "copy something" but not what the record is, and the index card's whole point is that it names the record. The drawer's position at the end is right for the common case; if the owner wants the references discoverable from the top, the card's provenance line can end with "· 5 more on this page" as a jump link to the drawer, at no cost in height.

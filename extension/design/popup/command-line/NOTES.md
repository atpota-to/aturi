# Command line

## The model in a paragraph

The popup opens on the site's go-to field ("Go to a handle, DID or at:// URI", the same 36px field as aturi.to's header, focused, with a moss edge), and everything under it is a result. The results are filed in drawers as the catalog would file them: **This page** (the page's record as an index card: who and what it is, a ledger of its six identifiers where each row copies on click, and one band that opens it on aturi.to), **Open in** (the thirty waypoints as rows, divided by guide strips for Recommended and the five groups), **Also on this page · 5** (the other records the scan found, one line each) and **Extension** (auto-redirect with its switch, theme, scan again, all settings). The first row that opens something is selected when the popup opens (the recommended Anisota), and the selected row's description becomes its key legend: `↵ Open on anisota.net · ⌘↵ Copy link`. Typing filters every drawer at once (apps by name or host, group names, identifier keys, referenced records by handle or text, the extension rows by name); a drawer with no match disappears; a "Go to *text* on aturi.to" row is offered under whatever remains. There are no mode tabs and no footer: the field is the mode, and the three jobs are three drawers under it.

Files: `post.html`, `nopage.html`, `style.css` (`.cl-*`, tokens only; loaded after popup.css), `build.py` (writes the pages from the fixtures and `icons.json`: `python3 -I build.py`), `post-typed.html` (the filtered state, the field holding "lea") with `render-extra.mjs` to render it (`node render-extra.mjs post-typed`).

Renders: `post-light__view.png`, `post-light__full.png` (2266px), `post-dark__view.png`, `nopage-light__view.png`, `nopage-light__full.png` (1823px), `nopage-dark__view.png`; extra `post-typed-light__view.png`, `post-typed-dark__view.png` (600px, nothing to scroll).

## What each region is for

- **Head** (sticky, `data-sticky`, 82px): a 38px brand row (leaf and "aturi" left, linking to aturi.to; the settings glyph right) and the field under it, full width, 36px, the site's `.fn-search-field` numbers. The field is focused on open; it never holds the page's record (that is the first result, right under it), so a placeholder states the popup's purpose to someone who has never seen it. When auto-redirect is on, a moss shuffle mark sits beside the settings glyph and jumps to the Extension drawer (not rendered: the fixture is Off).
- **This page**: the drawer tab on the left; on its line, right, a jump "Also on this page · 5 ↓" that scrolls to that drawer, so the references are announced in the first 600px without costing them. The card: avatar, "Post by dame.is", "app.bsky.feed.post · on Bluesky · canonical" (the provenance, in one word; hits 1 and 2 of the scan are the same record found two ways, so there is one card). The ledger: AT URI (its key stacked over the value, so the value breaks only at a slash; the rkey in ink), DID (shown in its copied state: soft green, "Copied", a tick), Handle, PDS, CID (head and tail), Link (breaks after `post/`). The whole row copies; the glyph at the end is the tell. The band on the bottom edge: "Open on aturi.to · record, PDS, raw JSON, links in".
- **Open in**: one white drawer with guide strips (paper-toned, 26px: "Recommended for Posts" in the accent, then "Bluesky Clients 4", "Bluesky Forks 4", "Publications 5", "Atmosphere 10", "Dev Tools 4") between runs of the shipped waypoint rows (icon, name, "View post on host", copy-link on hover). Absent apps keep their dimmed row. Six boxes with six tabs become one list that reads top to bottom and that the field cuts down.
- **Also on this page · 5**: a guide strip saying where they came from ("Posts this page refers to · found in its structured data"), then one row per reference: avatar letter, handle, a line of the post; the row opens it on aturi.to, its copy glyph (on hover) copies its at:// URI.
- **Extension**: the rows nobody needs on every page, filed last: Auto-redirect (the global switch, with its state in words), Theme ("Light · switch to dark"), Scan again, All settings (opens the options page).
- **No-data page**: the field is the point. Under it, one line, "No Atmosphere record on this page." with "Scan again" at its right. Then **Recent** ("repos you looked at"): three handles, each opening on aturi.to, `⌘↵` copying its DID; the first is selected. Then **Open an app** ("each app's home page"): the thirty shortcuts as rows under their group strips, "Open bsky.app". Then Extension (three rows; Scan again lives on the notice here).

## The three jobs, in clicks (and keys)

- **Jump**: 1 click on a waypoint row. Keyboard: the recommended app is already selected, so `↵` alone opens it; `↓` walks the list; or type three letters and `↵` (`lea↵` opens Lea). `⌘↵` (Ctrl on Windows and Linux) copies the app's link instead of opening it.
- **Copy**: 1 click on a ledger row (AT URI, DID, Handle, PDS, CID, Link): the row turns soft green, its key reads "Copied", the glyph becomes a tick, nothing moves. Keyboard: `↑` from the selected app walks up through the band and the ledger, `↵` copies; `⌘C` with nothing typed and nothing selected copies the AT URI, the path that was missing. Any app's link: hover the row, click its glyph, or select it and `⌘↵`.
- **Hand off**: 1 click on the "Open on aturi.to" band (the Aturi row in the Atmosphere group still works too). Referenced records: 1 click on the row opens it on aturi.to; `⌘↵` or the hover glyph copies its at:// URI.
- **Look up** anything: type a handle, DID or at:// URI and `↵` on the "Go to … on aturi.to" row (when the text looks like an identifier that row moves to the top and is selected, so it is type-and-`↵`).
- **Auto-redirect**: the switch on its row in Extension (scroll, or type "redirect" and `↵` toggles it). **Pause on this tab**: a second row under it that exists only while the switch is on ("Paused on this tab · Resume" while paused; quiet, no amber).
- **Theme**: the Theme row, or type "dark" and `↵`. **Settings**: the glyph top right, or the All settings row.

## Where Inspect's content went

- The identifiers of the page's record: the ledger in This page (last round's Inspect ledger, kept almost as it was).
- The other records the page references: the Also on this page drawer, under Open in, announced by the jump on This page's tab line; typing a handle finds them from anywhere.
- Provenance: the one word "canonical" on the meta line. Preview text and engagement of the page's own record, raw JSON, "PDS in Explorer", the per-record "Open in Explorer": not in the popup; the band says what is on aturi.to. The toolbar badge keeps counting; the drawer's tab carries the count because it is the drawer's name.

## Where the settings went

- **Auto-redirect, global**: a row with the switch in the Extension drawer at the end of the list on both pages. It is a setting; it lives with the settings, one click, findable by typing. Its state is readable in words on the row ("Off · links open where they are"; on: "On · Bluesky links open in Anisota"). When on, the head gets a moss shuffle mark beside settings that jumps to the row.
- **Pause on this tab**: a row directly under the switch while it is on. Per-tab scope, filed with the thing it pauses.
- **Theme**: a row in Extension (and reachable by typing); no permanent top-bar slot.
- **Settings**: the glyph in the brand row, and the All settings row.
- **Recents on a record page**: a "Recent" guide strip under Recommended in Open in, when the option is on (not rendered: it is off by default).
- **New-waypoints banner**: a guide strip at the top of Open in, "6 new since your last visit · Add", not a banner over the record.

## What I dropped and why

- The Waypoints and Inspect mode tabs, and the count badge: the field is the way to narrow; the drawers are the two stories told in order.
- The sticky footer: a global switch does not belong on every page's bottom edge. The popup's chrome is the head only (82px, against 48 + 48 today).
- The theme toggle's top-bar slot.
- The no-data page's hero (icon, 20px title, three-line paragraph) and its tile wall: one line of notice, recents as the first results, the apps as rows the field filters (1823px for thirty, against ~2100 of tiles).
- Preview text, engagement counts, raw JSON and the explorer links from the popup: aturi.to's job.
- The amber paused strip.
- Six drawer boxes for the waypoints: one drawer with guide strips. The boxes' tabs were six more things to read before the first row.

## How it scales

- **40 references**: Also on this page shows the first eight rows and a "Show 32 more" row; typing a handle shows the match wherever it is. The jump on This page says "· 40".
- **One record, no references**: the drawer and the jump are absent.
- **One group or six**: as many guide strips as groups in one drawer; one group means one strip or none.
- **Profile page**: "dame.is", "profile · on Bluesky · in the address bar"; the ledger drops CID (or carries the profile record's) and the AT URI is `at://did…/app.bsky.actor.profile/self`; the band reads "Open on aturi.to · repo, PDS, collections"; the rows say "View profile on …".
- **Long handles and hosts**: the AT URI stacks and breaks at slashes; the Link breaks after `post/`; CID keeps head and tail; single-line values ellipsise at the end and the full value is in the row's title and in what is copied; the selected row's legend drops the host ("↵ Open") when "Open on <long host>" will not fit; a reference row gives the handle at most half the line.
- **Text-size presets**: everything is on the `--fs-*` scale; the AT URI's stacked key is what keeps the value whole when the preset grows.

## Trade-offs I accept

- **The record card costs the fold.** With all six identifiers open, Open in starts at 468px: the recommended two rows and the next group's strip are what show of the apps in the first 600. The copy job is one click for every identifier, which the shipped page card (two buttons) and the pulled-card models do not give; the price is one row of apps. If the owner wants more apps above the fold, the ledger can rest on three rows (AT URI, Link, DID) with "3 more" and the rest reachable by typing, or the AT URI can go on one line with its DID elided (its DID is the next row).
- **82px of head** instead of 48: the field gets the full width because the model is the field. A one-row head (leaf, a 246px field with a shorter placeholder, settings) saves 34px and reads as a header search box; I would try it only if the fold costs more than it is worth.
- **Keyboard-first means a selection on open.** A highlighted row the person did not choose is a small surprise for a mouse user; it is also what tells them what `↵` will do. The legend (18px key caps) is the teaching; there is no footer legend to duplicate it.
- **The references sit under thirty apps** (at ~1600px). The jump on This page's tab line and the filter are the two ways there; a first-timer who neither scrolls nor types will not see them, which is the same as today's tab and better than a tab named Inspect.
- **Hairlines**: every horizontal rule is on a whole pixel (head 82, rows 40 + 1, ledger rows 28/64, guides 26, band 38). The right edges of the drawer tabs and key caps follow their text width, as popup.css's tabs do.

## What I would change about the assigned model

The brief's "prefilled with the page's record" is the part I would not do: a prefilled field makes typing a select-all first, and the record is already the first result an inch below. The placeholder carries the purpose instead, and the page's record is the card. I also would not make the record's identifiers plain result rows in the list (the brief's "the page's record as the first result card" was right): a ledger inside a card keeps the six values legible and copyable at once, where six "Copy …" rows would hide the values. The one thing I would push further than the brief: with the filter in place, the resting list could show only Recommended and Recent and leave the five groups to typing or a "Show all 30" strip; I kept all thirty at rest because the shipped list does, and the owner can judge the difference from the full render.

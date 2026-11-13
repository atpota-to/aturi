# Copy menu and hand off

## The model in a paragraph
The popup is one sheet with no tabs. At the top of the drawer sits one index card, "This page", that names the record the page is about and carries exactly two controls: **Copy**, which opens a small floating ledger of the page's identifiers (AT URI, DID, handle, PDS, aturi.to link, each with its value in mono beside the label), and **Open on aturi.to**, which hands the record to the site where everything else lives (raw JSON, CID, PDS, inbound links, the author's repo). Below the card the waypoint drawers follow as today: a recommended drawer, then the user's groups, each a box of rows. The other records the page references are not listed in the popup at all; one quiet line closes the drawer, "5 more records on this page · See them on aturi.to". The top bar holds the brand, the global auto-redirect switch and settings; what concerns only this tab (the pause) sits on this tab's card. Nothing floats except the menu, so it is the only thing with a shadow.

## Regions
- **Top bar** (sticky): brand mark top-left; on the right the global **Auto-redirect** switch (icon, label, small pill) and the settings button. No mode tabs, no theme toggle.
- **This page** (an index card with a folder tab): avatar, "Post by dame.is", `app.bsky.feed.post · on Bluesky`, then one row of two equal outlined buttons, Copy ▾ and Open on aturi.to ↗. When auto-redirect is on, a band on the card's bottom edge says "Auto-redirect is on · Pause on this tab"; paused, the same band goes amber: "Auto-redirect is paused on this tab · Resume".
- **Copy menu** (floating, spans the button row): five rows, label column then value in mono. A copied row flashes the accent-soft family, its label reads "Copied" and a tick lands on the right; the menu stays open so a second identifier is one more click; Esc or a click outside closes it.
- **Waypoint drawers**: "Recommended for Posts" (accent tab), then Bluesky Clients, Bluesky Forks, Publications, Atmosphere, Dev Tools, rows as shipped (icon, name, "View post on host", copy-link on hover, absent rows dimmed).
- **Hand-off line**: the last line of the drawer, `--text-tertiary`, with the link in the accent.
- **No-data page**: the same card becomes a lookup field ("Go to a handle, DID or at://" with a Go cell) under a one-line note, with a "Recent" row of handle chips the extension has seen lately; then "Jump to an app" and the same drawers as rows (name, host), a step shorter.

## The three jobs, in clicks
- **Jump**: 1 click on a row. The recommended drawer is the first thing under the card.
- **Copy**: 2 clicks, Copy then a row. Keyboard: Tab to Copy, Enter opens with AT URI focused, Enter copies, so the URI is Tab · Enter · Enter; arrows reach the others. Copying a second identifier is 1 more click because the menu stays open.
- **Hand off**: 1 click on Open on aturi.to (the universal link, which the site resolves to the record page).
- Lookup on the no-data page: type, Enter; or 1 click on a recent chip. The field hands off to aturi.to too (the site's resolver takes a handle, a DID or an at:// URI).

## Where Inspect's content went
- The page's own identifiers: into the Copy menu. Six became five; the CID is on aturi.to.
- The other records the page references (5 here): out of the popup entirely, into the hand-off line at the end of the drawer. The popup says how many and where to see them; it does not list them.
- Source tags, breadcrumbs, previews, engagement counts, raw JSON: on aturi.to. The card's meta line keeps the one fact that matters here, what kind of record and on which app.
- Scan again: gone from the popup; the extension rescans when the page changes. If a manual rescan is still needed it belongs in the settings button's menu, not on the card.

## Where auto-redirect, the pause, theme and settings went
- **Auto-redirect** (global): the top bar, as a labelled switch beside settings, since the top bar is the one region that is about the extension rather than this page. It is quieter than the old 48px footer band and it reads the same on every page.
- **Pause on this tab** (per tab): the card's bottom band, only when auto-redirect is on. Paused is amber on the card, not across the whole popup, so the loudest thing is never a strip you cannot act on. The band should name the favourite once the fixture knows it ("Links open in Anisota").
- **Theme**: Settings → Appearance (light, dark, follow system). The toggle held a permanent top-bar slot for a setting changed once.
- **Settings**: the top bar's right end, as today.

## What I dropped and why
- The Waypoints/Inspect tabs: one page has one story; the card tells it and the drawers follow.
- The Inspect cards (and the last round's ledger): the copy jobs fit in a menu; the rest is the site's job.
- The CID from the copy set: nobody copies a CID without also wanting the record it hashes, which is on aturi.to. Add it back as a sixth row if dev users ask.
- The theme toggle from the top bar.
- The sticky footer: nothing global is left at the bottom, so the popup ends where the drawer ends.
- The count badge on a tab: the toolbar badge already counts; the hand-off line answers it in words. The badge should count unique records (6), not hits (7).
- Scan again, the notice paragraph on the no-data page (one line does it), and the tile wall (rows, same furniture as the post page).

## Scale
- **40 references**: the line reads "40 more records on this page · See them on aturi.to"; the popup's height does not change at all.
- **Profile page** (no rkey): "dame.is", `profile · on Bluesky`; the menu loses nothing (AT URI is `at://did:…`, DID, handle, PDS, link). A list or feed works the same with its own collection.
- **One group or six**: the drawers are the shipped ones; the card and the line are fixed height.
- **Long handles and hosts**: the card title ellipsises; menu values truncate in the middle so the rkey stays visible (hand-cut in the mock; the AT URI row shows it, the Link row shows the CSS fallback); row descriptions ellipsise as today.

## Trade-offs I accept
- Copying is two clicks, not one. The old card copied two things in one click; this copies five in two, and the second copy is one.
- The referenced records are a sentence, not a list. A user who wanted to copy a quoted post's URI from the popup now goes to the site for it.
- The hand-off line needs a destination the site does not have yet: a page that lists what a given URL references. Until it exists, "See them on aturi.to" opens the page's own record, whose links section shows the quoted posts.
- The Aturi row in the Atmosphere drawer repeats the card's Open on aturi.to. Groups are the user's, so the row stays; the extension could hide it when the card already has the hand-off.
- The menu covers the recommended drawer while open (see `post-light__view.png` against `post-closed-light__view.png`).
- "Auto-redirect" in the top bar is a word a first-time user has to learn; the switch's tooltip and the settings page explain it. The old footer had the same word with more room.

## What I would change (built as assigned, shown as variants)
- **Move the hand-off line under the card** (`post-footnote-light__view.png`): "5 more records on this page" is a fact about this page and answers the toolbar badge; at the end of a 1,650px drawer nobody sees it. As the card's footnote it costs 22px of the first 600 and sits exactly where the eye asks the question.
- **Consider a split Copy button**: one click copies the AT URI (or the user's chosen default), the chevron opens the menu. The common copy becomes one click again without a second button.
- **Name the favourite on the band** when auto-redirect is on, and keep a "Pause" affordance one click away on the no-data page too (a line under the lookup card), since a paused tab can be any tab.

## Files
- `post.html` (menu open, DID copied), `nopage.html`, `style.css`, `NOTES.md`; `build.mjs` generates the HTML from `../icons.json` and `../waypoints.json`.
- Extra states, rendered by `render-extra.mjs`: `post-closed` (resting card), `post-on` (auto-redirect on, pause band), `post-paused` (amber band), `post-footnote` (hand-off line under the card).
- Light post page height: 1659px (1655px with the footnote variant); no-data page 1559px.

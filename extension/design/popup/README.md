# Popup design, October 2026

Mockups, notes and panel verdicts for the extension's popup. The copy-menu-v2 direction is now built (see "Built" below); the mockups stay as the design record. They render on the extension's own stylesheets (`entrypoints/shared.css` and `entrypoints/popup/popup.css`), and those stylesheets now carry the built classes rather than the mockups' `cm2-*` ones, so a fresh render of these folders will drift from the committed renders.

## The decision

The owner chose the **copy-menu model combined with three additions**, built and reviewed in `copy-menu-v2/`:

- The record card carries two verbs, **Copy** (unfolds a ledger of the six identifiers: AT URI, aturi.to link, DID, handle, PDS host, CID; the whole row copies; a copied row is tinted with a tick) and **Open on aturi.to** (the hand-off; the site shows the record, raw JSON, PDS and inbound links). The old Inspect tab, its cards, previews, engagement counts and raw-JSON disclosure go away.
- **Each record on the page is a folder tab on the card**: "This page" first (the page's own record, pinned), then one tab per referenced record labelled by its author's handle; the strip scrolls with a fade, caps at twelve, and a trailing "+N" tab opens a "Records on this page" list under the card. Opening a reference tab swaps the card to that record (title, kind, where found, a two-line preview, its own Copy and Open).
- **Seen lately**: repos the extension has seen recently (handle, PDS host, page count; a row opens the repo on aturi.to), under the header search and on the no-data page.
- **A search glyph in the top bar** that drops the site's go-to field ("Go to a handle, DID or at:// URI") under the bar over a dimmed page, with Seen lately beneath it and a "Go to … on aturi.to" row when typing; Esc, the close or a click outside dismisses it.
- The auto-redirect switch stays in the top bar with its label; when on, a band on the card says so and offers "Pause for this page". The theme toggle moves to the options page. The no-data page is a one-line notice with the field focused, Seen lately, then the app shortcuts as rows.

States rendered in `copy-menu-v2/renders/`: the record page at rest, Copy open with the AT URI copied, a reference tab open, the "+N" list, the header search open and typed, the no-data page, forty references, auto-redirect on, dark, and the full scroll. `copy-menu-v2/NOTES.md` has the model, clicks per job, the keyboard map, how it scales, what the critics asked for and what was taken, and the open questions.

Open questions for the implementer and owner: whether the Copy ledger should float over the list instead of unfolding in the card (one positioning change); whether the "+N" tab should count hidden tabs or just say "More"; whether "This page" should read the handle when the page's author is also a reference; whether the records list closes after a pick; Seen lately needs a small local log of repos the extension does not keep yet.

## What else is here

- `BRIEF.md`, `BRIEF-ROUND-2.md`: the briefs the designers worked from (the extension, its jobs, what was awkward, the system, the materials).
- `one-sheet/`, `pulled-card/`, `drawers/`, `copy-menu/`, `command-line/`, `two-tabs-renamed/`: the six models of round 1, each a whole popup in two contexts with its notes and two renders; `compare-record-page.png` and `compare-no-data-page.png` show them side by side with the current popup.
- `inspect-ledger/`: the earlier round, which redesigned the Inspect tab alone as an index-card ledger. Superseded by the combined model, kept because its ledger (path wrapping, flush ellipsis, label column, copied state) is what the Copy ledger reuses.
- `VERDICTS.md`: the judges' scores and recommendations for every round.
- `REVIEW-2026-10.md`: the plan from the extension-wide review that preceded this, most of which shipped in the "Bring the browser extension in step with the site's redesign" commit.
- `data.json` (the sample post page's detected URIs as the extension resolves them), `waypoints.json` (what the Waypoints tab lists on that page and on a no-data page), `icons.json` (the real waypoint marks as SVG strings, generated from `src/utils/waypointIcons.tsx`), `icons.html` (UI glyph paths).

## Rendering

Playwright is needed (the cloud session had it preinstalled at `/opt/node-tools`; adjust the `createRequire` path at the top of the render scripts if yours lives elsewhere).

```
cd extension/design/popup
node render.mjs copy-menu-v2            # every state in that folder
node render.mjs copy-menu-v2 post post-ref
node render-inspect.mjs inspect-ledger  # the older body-only frame
```

Each state renders at 380x600 CSS pixels at 2x, light and dark, plus a flow-order full-page capture when it is taller than the popup. The generated `*.index.html` pages and the fresh renders are ignored by git; the committed renders live under each folder's `renders/`.

## Built

Implemented in `entrypoints/popup/` (`App.tsx`, `RecordCard.tsx`, `Search.tsx`) with `lib/pageRecords.ts` (the record model: references, labels, joints, the +N count) and `lib/seenLately.ts` (the log). The mockups' `cm2-*` rules live in `popup.css` under `popup-*` names. The Inspect tab, the theme toggle and the auto-redirect footer are gone; Settings lost its "Default view" and "Remember last-used view" rows.

How the open questions were answered:

- **Copy ledger**: unfolds inside the card, as drawn. It stays open across tab switches; a copy lasts 1.5s and clears on a tab switch.
- **+N**: counts the references not fully in view, recomputed on scroll and resize, as drawn. With nothing hidden there is no +N tab and no list.
- **"This page"**: stays "This page" even when the page's author is also a reference; the tab's title names the record.
- **Records list**: stays open after a pick (a disclosure, like the ledger). Picking scrolls the run sideways only, so the popup does not jump back up from deep in a long list.
- **Seen lately**: built on the local history the Inspect tab already kept (same storage key, so existing entries carry over), extended with DID, handle and PDS host, and counting pages rather than popup opens (a hash of the last page counted, never the address). Written when the popup opens on a page with records; read before that write, so the current page does not head its own suggestions. Entries for one account seen by handle and by DID merge onto the DID once the popup resolves it. Clearing or turning off history in Settings removes it. The drawer shows five, the no-data sheet eight; there is no "All recent repos on aturi.to" row, since the site has no such page.

Decisions the mockups did not cover:

- **Waypoints follow the open tab.** With a reference open, the drawers under the card open that record (and the page's own app is no longer filtered out, since the reference is not on it).
- **Open on aturi.to goes to the explorer** (`/explore/<repo>/<collection>/<rkey>`), the view with the record, raw JSON, PDS and inbound links. The mockups' link pointed at the `/profile/…` universal link, which is what the ledger's Link row copies.
- **A page with references but no record of its own** gets the tab strip with a "This page" sheet saying so, over the go-to field; opening a reference shows its card and waypoints. On a known app with no record (bsky.app's home) the notice reads "No record on this page."
- **The per-page band** also shows on the no-data card while auto-redirect is on, since the pause is per tab and not per record.
- **References wait for the page's DID** (up to 1.5s) before they show, so the page's own record, often declared by DID while the address names a handle, does not flash up as a reference.
- **Pending ledger rows** read "Looking up…" and are disabled; a value the lookups could not supply drops its row.

Checked in the built popup (`npm run build`, then `.output/chrome-mv3/popup.html` driven by Playwright with stubbed `chrome.*` APIs and fixture atproto responses): every state above at rest, dark, small and xlarge presets; the search drawer's keys (`/`, arrows, Enter, Esc twice, scrim click); the tab strip's arrows, Home/End and wheel; Tab · Enter · Enter to copy the AT URI and Esc back to Copy; forty references with a pick from deep in the list; pause and resume on the band. Not checked: the real extension in Chrome or Firefox against live pages, and Firefox's popup.


# Popup design, October 2026

Mockups, notes and panel verdicts for the next version of the extension's popup. Nothing here is built into the extension; it is the design the next implementation session works from. Everything renders on the extension's own stylesheets (`entrypoints/shared.css` and `entrypoints/popup/popup.css`), so the mockups drift only when those do.

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

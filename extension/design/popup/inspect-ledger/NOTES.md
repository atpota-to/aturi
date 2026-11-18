# Inspect, final: the index card, grafted

## The idea

Index-card's skeleton, kept whole: the page's own record is one catalog card under the lead drawer tab ("This page"), with a title line that says what it is and whose ("Bluesky post by dame.is"), a provenance sentence beneath (hits 1 and 2 folded: "Declared by the page as canonical · also in the address bar"), a ruled ledger of identifiers in which the whole row is the copy button, and one band out to aturi.to. Everything else the page references sits a step below in a second drawer ("Also on this page · 5"), one line per record: handle, rkey, one copy of its AT URI. What changed is inside the ledger and inside the reference row.

The ledger now has two kinds of entry. A token (DID, handle, PDS host, CID) sits beside its label, in Plex Mono at `--fs-md`, one step up from index-card. A path (the AT URI, the aturi.to link) runs under its label on the card's full width, so it breaks at a slash instead of losing its middle, and carries its own hierarchy: the repo part (`at://did:plc:…/`, `aturi.to/profile/`) in tertiary, the collection a tone up in secondary, the slashes faint, the record's own identifiers (the rkey, the handle inside the link) at 500 in ink. The DID is whole on its own row at every preset. The CID keeps head and tail with the ellipsis flush against the tail.

A reference row opens. Its main area is the disclosure (chevron at the start, `aria-expanded`), and the opened row holds the same ledger at a smaller size on `--surface-subtle`, six identifiers plus the record's one "Open on aturi.to" line. So a reference's DID, handle, PDS, link and CID are copyable inside the popup, and the row no longer ends in two unlabelled glyphs: the one visible control at rest is the shipped row copy button (AT URI), and the way to the website is inside the drawer the row pulls out.

**Light page height: 1004px** with the @bjkeefe.bsky.social row open (the state rendered); **731px** with every row closed. The first 600px holds the whole card (six copies), the band, the second drawer's tab and its first row. One hit renders at 600px with no scroll.

## Mock states in body.html (static classes)

- `.fi-row.is-copied` on the page card's DID row: the label reads "Copied" in the accent, the glyph becomes a tick on `--accent-soft`. Same cells, same widths, nothing moves. This is the one copy control shown copied.
- `.fi-ref.is-open` on the @bjkeefe.bsky.social reference (hit 4): chevron turned and in the accent, `aria-expanded="true"`, its `.fi-ref-body` not `hidden`. Chosen because it carries the long handle and a long PDS host.
- The frame's Inspect badge reads 6 (the folded count) through a one-line script at the end of body.html that stands in for the frame change; the real change is in the extension (see the implementation note).
- No hover state is faked.

## Grafts taken, and from where

- **two-layers, the opening row.** A reference row discloses a ledger of its own: index-card's `.fi-row` at a 28px line (path rows 60px), no rules between lines, on `--surface-subtle`, with "Open on aturi.to" as its last line and the external-link glyph in the action column.
- **two-layers, the flush middle ellipsis.** `.fi-mid { width: calc(round(down, 100%, 1ch) + 0.5px) }` on the DID and CID wrappers; the ellipsis lands against the tail (zoom-ledger.png). Without `round()` the row is auto width and only the gap returns.
- **two-layers, `--fs-md` mono.** Every value is 13px at the medium preset; the DID (249.6px) fits its 262px column with 12px to spare, and still fits at the 370px content width a classic scrollbar leaves (stress-narrow__view.png).
- **two-layers, the shipped band and rescan.** `.inspect-cta` with the compass, plus the hint "record, PDS, raw JSON, links in" in `--text-tertiary` (a profile page says "profile, PDS, collections"); `.inspect-rescan` on the tab line. The custom `.ic-open` and `.ic-rescan` are gone.
- **strip-cards, the path hierarchy and wrap rule.** The AT URI reads `at://did:plc:…/` quiet, `app.bsky.feed.post` secondary, `/` faint, `3mypi5zkyps2i` at 500 in ink; `<wbr>` after the DID's slash and after the collection's slash, so the break always falls at the first slash and the collection and rkey move together. The link gets the same treatment (`aturi.to/profile/` quiet, handle in ink, `/post/` quiet, rkey in ink), breaking after the handle's slash.
- **strip-cards and two-layers, the folded count.** The badge says 6 and the drawer tab says 5 because both count distinct URIs.
- **two-layers, gen.mjs.** body.html is generated from ../data.json, so the folding rule (same URI merges; the canonical or address-bar sighting is the page's record) is code and no fixture string can drift. The stress bodies come from the same generator.

## Must-fixes, resolved

| Flag | Resolution |
|---|---|
| LINK row cut the handle to one letter | The link is a path row: full width, wraps after the handle's slash, handle whole and in ink. |
| AT URI showed five characters of the DID | Path row, two lines at the DID's slash, hierarchy on the segments; the whole URI is readable. |
| ~1ch gap before the tail | `round(down, 100%, 1ch)` snap on `.fi-mid`; measured 0px gap. |
| Values at `--fs-sm` | `--fs-md` everywhere, including the opened reference ledger (two-layers dropped there to 12px; this does not). |
| Label column at `--fs-xs`, width unverified at XL | Labels are 12px/700 (`--fs-sm`) and the column is `max-content` through subgrid, so it is exactly the widest label at every preset; verified at small, medium, large-equivalent and XL (stress-xlarge__full.png). |
| Two unlabelled glyphs on a reference row | The row's main area is the disclosure; the one glyph at rest is the shipped copy button; "Open on aturi.to" lives inside the opened ledger. |
| PDS row showed the host, copied the URL | The row shows and copies the host (`pds.atpota.to`); the row is labelled PDS, its accessible name "Copy PDS host". The site keys its PDS page by host too (`/explore/pds/pds.atpota.to`). |
| Badge said 7 | Reads 6; the badge follows the folded count. |
| Custom rescan and band | Replaced by `.inspect-rescan` and `.inspect-cta`. |
| 40-hit and profile states only described | Rendered: stress-forty__full.png, stress-profile__full.png. |
| "Bluesky post" repeated on every reference row | The kind is shown on a row only when the drawer holds more than one kind (the profile stress shows the mixed case). |
| Handle shown two ways | One form everywhere: bare. See below. |
| Copied state silent to a screen reader | A visually hidden `aria-live="polite"` region (`.fi-live`) is in the markup; the implementation writes "DID copied" into it on each copy. |

## Where the judges disagreed, and why I chose as I did

**Should a reference row open, or stay a link to aturi.to?** Judge 1 made the opening row a graft and a must-fix; Judge 2 called it optional and preferred the row-as-link as simpler and truer to "send people to the website". I took the opening row. The owner asked for two things, quick copies and a hand-off to the site, and index-card's row-as-link gave a reference the second without the first: its DID, handle and PDS were uncopyable without leaving the popup, which both judges listed as the winner's one functional gap. The opened ledger is index-card's own component at a smaller size, so it adds no new idiom, and it also dissolves the double-glyph row Judge 1 flagged. The cost is that opening a reference on the website is two clicks instead of one; the page's own record, which is what people open the popup for, keeps its one-click band.

**The handle: `@dame.is` or `dame.is`?** Judge 2 wanted the @ in the title and the row with a bare clipboard; Judge 1 preferred the row to show exactly what it copies. The Waypoints tab settles it: its page card already says "Post by dame.is" (ext/after/shots/post-light__view.png). So the handle is bare everywhere here, in the title, the ledger and the reference rows, which satisfies Judge 2's "pick one form", Judge 1's "the row shows what it copies", and the product's own convention.

**Uppercase eyebrow or sentence-case label?** Judge 1 wanted the system's 12px/700 eyebrow instead of index-card's 11px, and read two-layers' sentence-case labels as off-system. The site has two label styles: the kicker over a section (`.fn-kicker`: 12px/700, 0.06em, uppercase) and the label beside a value in the explorer's definition lists (`.fn-dt`: 12px, tertiary, sentence case). The ledger's label sits beside a value, so it takes the second idiom at the brief's 700 weight. There is also an arithmetic reason: a tracked uppercase HANDLE at 12px is 53px, which pushes the 13px DID off its row at the medium preset (and at any preset with a classic scrollbar); sentence-case "Handle" is 39px and the DID stays whole everywhere.

**The AT URI: wrap, or keep the tail `/collection/rkey`?** Judge 2 offered the tail as the cheaper fix. The ledger's value column is 262px at medium, 33 characters, and `/app.bsky.feed.post/3mypi5zkyps2i` is 33; it would fit with nothing to spare and clip for any longer collection. A path under its label has 320px, the 38-character `at://did:plc:…/` line fits at every preset, and the second line reads whole. So paths wrap, and only paths.

## Kept, demoted, dropped

Kept and promoted: the six identifiers (AT URI, DID, handle, PDS host, CID, aturi.to link), one click each, 13px mono, both ends of a DID and CID; the title line and provenance; the drawer tabs; one band out per record; "Scan again" on the tab line; the folded count.

Demoted: the references, from 330px cards to 36px rows that open on demand; the PDS, from two links to one copyable host (the band's hint says the site has the PDS page); "where found" for a reference, to the row's `title`.

Dropped: the preview text, the engagement row, the raw-JSON disclosure and link, the four-segment breadcrumb, the "Copy JSON" chip, the per-card kind label, the "7 AT URIs on this page" heading. The band's hint names what the website holds instead.

## Things to notice

- One action column: the six ledger glyphs, the band's outward glyph, the row copy buttons, the opened ledger's glyphs and its "Open on aturi.to" glyph all centre 20px from the card's inner edge, the same x as the Waypoints rows' copy buttons.
- Whole pixels: ledger rows are 32px content over a 1px rule (content-box), path rows 64, the band 38 over its rule, nested lines 28 and 60, reference heads 36; every glyph box lands on an integer y (measured: 161, 210, 243, 276, 309, 358, 410).
- One hairline, two tones: the card and list sheets carry `--border-medium`; rows are ruled with `--border-subtle`; the band and the opened drawer sit on `--surface-subtle`; hover is one tone down. No other edges are drawn.
- Dark is tokens only (dark__view.png, stress-dark-full__full.png).
- Keyboard: every copy is a `<button>` with an `aria-label` and the full string in `data-copy`; every open is an `<a>`; the row disclosure is a button with `aria-expanded` and `aria-controls`; focus rings draw inside the clipped sheets.

## Implementation note for the developer

**Reused from popup.css as shipped:** `.popup-root`, `.inspect-root`; the drawer tabs `.popup-section.is-sheet > .popup-section-label` (lead tab `.is-highlighted`); `.popup-waypoints` for the references sheet; `.popup-waypoint-copy` for the reference row's copy button (visible at rest here because it is not inside `.popup-waypoint`, so the hover-only rule does not apply); `.inspect-rescan` (positioned absolute on the tab line by `.fi-rescan`); `.inspect-cta` (made flush by `.fi-cta`: `margin: 0`, no radius, the card has no padding to undo); `.popup-mode-tab-badge` unchanged.

**New (style.css, ~330 lines, all tokens):** `.fi-card`, `.fi-head`, `.fi-title`, `.fi-declared`; the ledger `.fi-ledger` (grid, `max-content minmax(0,1fr) 34px`) and `.fi-row` (subgrid, with a `6em` fallback column), `.fi-label` with its `.fi-label-done` overlay, `.fi-value` with `.is-dots` (wrap before a dot) and `.is-path` (full-width path), `.fi-mid` / `.fi-mid-head` / `.fi-mid-tail`, the path tones `.fi-dim` / `.fi-coll` / `.fi-sep` / `.fi-id`, `.fi-glyph`; `.fi-cta-hint`; the reference row `.fi-ref`, `.fi-ref-head`, `.fi-ref-main`, `.fi-ref-chev`, `.fi-ref-handle`, `.fi-ref-kind`, `.fi-ref-rkey`, `.fi-ref-body`, `.fi-ledger.is-nested`, `.fi-ref-open`, `.fi-ref-more`; `.fi-live`. Browser support needed: subgrid (Chrome 117) and `round()` (Chrome 125); both degrade (fixed label column; a 1ch ellipsis gap).

**Behaviour:** fold hits by `uri`; the record with a sighting where `where === 'url'` or `relation === 'canonical'` is the page's own, the rest are references in scan order. The badge (`inspectCount` in App.tsx, today `inspectScan.hits.length`) becomes the folded count. A row copies `data-copy`, adds `.is-copied` for about 1.5s, and writes "<Label> copied" into `.fi-live`. A reference row toggles `.is-open` and `aria-expanded` and unhides its `.fi-ref-body`. Show the kind on reference rows only when the references hold more than one kind. Labels: AT URI, DID, Handle, PDS, CID, Link; accessible names "Copy AT URI", "Copy DID", "Copy handle", "Copy PDS host", "Copy CID", "Copy aturi.to link". Display forms: DID and CID as head + last six characters in `.fi-mid`; handle and host with `<wbr>` before each dot (a `*.host.bsky.network` host only before `.host`); the AT URI as `at://` + DID + `/` + `<wbr>` + collection + `/` + `<wbr>` + rkey with the tones above; the link without `https://`, `<wbr>` after `profile/` and after the handle's slash.

**How the other cases render (all in this directory):**
- *1 hit* (stress-one__view.png): the card alone, no second section, 600px, nothing scrolls. Badge 1.
- *40 hits* (stress-forty__full.png): the card unchanged; the drawer tab reads "Also on this page · 39"; the list shows eight 36px rows and a last row "Show 31 more" (`.fi-ref-more`, chevron-down, accent) that reveals the rest in place; 879px before expanding. The stress body repeats the five real references to reach 39, so no strings were invented.
- *Profile page, no rkey* (stress-profile__full.png): the title reads "Profile · dame.is" (the kind, a middle dot, the handle; "by" is for records), the provenance "In the address bar"; the ledger has no CID row and its AT URI is `at://` quiet + the DID in ink on one line; the link is `aturi.to/profile/dame.is`; the band's hint reads "profile, PDS, collections". A profile reference row shows the handle, the kind (because the drawer is then mixed) and no rkey, and opens into a five-line ledger. The `puffball.us-east` / `.host.bsky.network` wrap is visible in that render.
- *Text presets*: small at 360px (stress-small__view.png) and extra-large at 460px (stress-xlarge__full.png) keep every row on its lines; the AT URI breaks at the same slash at all four presets. With a classic 10px scrollbar (stress-narrow__view.png) the DID still fits whole and the CID loses one more character.
- *Dark*: dark__view.png, dark__full.png, stress-dark-full__full.png.

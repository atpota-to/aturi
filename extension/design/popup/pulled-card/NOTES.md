# Pull the card

## The model in a paragraph

The popup is one sheet, no mode tabs: the page's index card on top, the waypoint drawers under it, and a filed settings row last. The card is labelled "This page" on its left tab, as every drawer is named, and carries a second tab on its right edge, "Details ⌃", in the accent: the pull. At rest the card holds what people do most (the two copy buttons and one "Open on aturi.to" band on its bottom edge). Pulling it brings the whole card forward: a sheet slides up over the list, the list steps back under a paper-toned scrim, and the card shows its ledger of six identifiers with a copy control on each, the same hand-off band, and the other records the page references as a short list. "Back" on the sheet, the scrim, or Esc file it again. Inspect is gone as a place; its two kinds of content (this record's identifiers, the other records on the page) are the two halves of the pulled card.

Files: `post.html` is the pulled state (the deliverable); `rest.html` is the resting state and `rest-on.html` the resting state with auto-redirect on, rendered with `render-rest.mjs` to `rest-light__view.png`, `rest-light__full.png`, `rest-dark__view.png` and `rest-on-light__view.png`. `build.py` generates the three pages from the fixtures and `icons.json`.

## What each region is for

- **Top bar** (48px, sticky): brand mark and name, left. Right: a look-up glyph (reveals a handle / DID / at:// field in the bar, same as the site's header go-to) and settings. No mode tabs, no theme toggle.
- **This-page card**: the record's tab-end in the drawer. Head (avatar, "Post by dame.is", collection and host), two copy buttons (aturi.to link, at:// URI), and the "Open on aturi.to" band with a note of what is over there (record, PDS, raw JSON, links in). Its left tab names it; its right tab pulls it.
- **The pulled card** (the sheet): Back + title and provenance ("Bluesky post · declared by the page"); the ledger (AT URI, DID, Handle, PDS, CID, Link; the long two stack their key above the value so the value breaks only at a slash; the CID keeps head and tail); the hand-off band; "Also on this page · 5" with one line per referenced record (handle, what it says, copy its AT URI; the row opens it on aturi.to).
- **Drawers**: Recommended for Posts (accent label) then the five groups, exactly the shipped rows.
- **Filed last**: the Auto-redirect row with its global switch.
- **Strip** (only when auto-redirect is on, sticky bottom, 40px): "Auto-redirect is on for Atmosphere links · Pause on this tab". Paused: "Paused on this tab · Resume", same tone, no amber.
- **No-data page**: the same "This page" card says there is no record and offers the one useful thing, a look-up field that opens on aturi.to; a Recent drawer (three records, when recents are on); "Jump to an app" as chips in the five group drawers (1183px for thirty apps, against ~2100 of tiles); the Auto-redirect row last.

## The three jobs, in clicks

- **Jump**: 1 click on a waypoint row (Anisota and Blacksky are in the first 600 at rest; the drawers scroll). Copy a waypoint's link: hover the row, 1 click.
- **Copy**: aturi.to link or at:// URI: 1 click at rest. DID, handle, PDS, CID: pull (1) + the row's copy (1) = 2. Keyboard: Tab past the two buttons to the pull, Enter, Tab to the row, Enter; Esc puts the card back.
- **Hand off**: 1 click on the card's "Open on aturi.to" band at rest; the same band sits in the pulled card. The Aturi row in the Atmosphere drawer still works too.
- Referenced records: pull (1) + row (opens on aturi.to) or its copy = 2.
- Look up: no-data page, type and Enter; on any page, the top-bar glyph then the field.
- Auto-redirect: the switch on the filed row (scroll to the end, or settings); pause: 1 click on the strip when on.

## Where Inspect's content went

- Identifiers of the page's record: the pulled card's ledger. The two most-copied stay one click away on the resting card.
- Other records on the page: "Also on this page" in the pulled card, one line each, after the ledger and the band.
- Provenance (declared by the page / in the address bar): the sheet's subtitle. Hits 1 and 2 are the same record found two ways, so the card is one card, not two.
- Preview text, engagement counts, raw JSON, "PDS in Explorer", "Scan again": dropped from the popup (see below).

## Where the settings went

- **Auto-redirect, global switch**: filed last on the sheet (both pages), a row with the switch. It is a global setting, so it lives with the other filed things, not in a sticky strip on every page.
- **Pause on this tab**: the strip at the bottom edge, which exists only while auto-redirect is on. Per-tab scope, per-tab place.
- **Theme**: the options page (Appearance); the popup follows the system by default. One more click for a setting changed once.
- **Settings**: the glyph top-right, as today.
- **New-waypoints banner**: between the card and the Recommended drawer at rest, as today; behind the scrim while pulled.
- **Recents** on a record page: a drawer under Recommended when enabled (I would move it below Recommended, not above).

## What I dropped and why

- The Inspect tab and its badge: the toolbar badge already counts; the pull is the way in.
- Preview text and engagement of the page's own record: the person is on the page; aturi.to shows the counts and the links in.
- Raw JSON disclosure, "PDS in Explorer" and "Raw JSON" links: folded into "Open on aturi.to"; the band's note says what is there. Dev Tools rows still reach the raw record directly (PDSls, atp.tools).
- "Scan again": the scan runs when the popup opens. If it is needed, it is a text action on the "Also on this page" line.
- The theme toggle in the top bar.
- The tile wall on the no-data page: chips in drawers, a third the height, same marks and names.
- The amber paused strip: paused is quiet. The person asked for it; it is not a warning.

## How it scales

- **40 references**: the list shows the first eight and a "Show all 40" row; the sheet scrolls under its own head; the ledger and band stay first. The count in the label tells the size before scrolling.
- **One record, no references**: the "Also on this page" block is absent; the sheet is shorter than the popup and stops where its content stops (still anchored at the bottom edge).
- **Profile page**: title "dame.is", meta "profile · on Bluesky"; ledger without CID (or with the profile record's); AT URI and Link still stack; the band reads "Open on aturi.to · repo, PDS, collections".
- **One group or six**: drawers as today; chips in as many drawers on the no-data page.
- **Long handles and hosts**: stacked values wrap at a slash (`overflow-wrap: anywhere` as the fallback); inline values and the ref rows truncate with an ellipsis, the copy still copies the whole value; the ref row gives the handle at most half the line.
- **Font presets**: everything is on the `--fs-*` tokens; the peek is a fixed 96px and the sheet's minimum height is derived from the 600 cap.

## Trade-offs I accept, and what I would change

- A second layer inside a 380×600 popup. The pull is a real step and a real animation; people who want the DID will pay a click more than a one-sheet model asks. In return the resting sheet stays short and the identifiers get a fixed, scannable ledger.
- The peek costs 96px of the sheet. It is what makes the state legible (the card came from there, the list is still there). It could be 50px (tabs only) if the ledger needs the room at the large preset.
- The sheet repeats the title under the dimmed one. I kept it: when the sheet scrolls, the dimmed title stays and the sheet's own head is what labels the dialog.
- Turning auto-redirect on takes a scroll or a trip to settings. I think that is right for a global switch, but if the owner wants it one click from anywhere, the settings glyph could open a small menu (theme, auto-redirect, all settings) instead of the options page; the strip would stay as it is.
- The pull could instead grow the card in place, without a scrim, like a disclosure. It would feel less modal and keep one scroll, but the ledger would then push the waypoints down rather than float over them, and "the list behind" would be lost. Of the two, I would still ship the sheet, with the scrim as the back affordance and Esc wired.
- Dropping the preview from the page's own record loses the one line that confirmed "this is the post I think it is" when a page declares a different canonical. If that matters, it goes as a one-line italic under the sheet's subtitle, nowhere else.

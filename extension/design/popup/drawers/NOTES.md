# Drawers

## The model

The popup is a card catalog: a column of drawers, each with a drawer tab standing on its front, that pull open and push closed and remember how you left them. Every drawer has a **face** that always shows (the top row of the card inside) and a **body** that pulls out under it, so a closed drawer is still useful at a glance and the whole stack can be read with everything shut. On a page about a record the stack is: **This page** (what the record is, its six identifiers as a ledger, and the band that opens it on aturi.to), **Open in** (the apps; the recommended ones are the face, the six groups are the body, divided by guide strips), **Also on this page · 5** (the other records the scan found; the face names their authors), and **Auto-redirect** (the switch in the face; the per-tab pause, an explanation and a Settings link in the body). The top bar is the brand mark and Settings, nothing else; there is no footer and no mode tabs. Two tabs that split one page's story become one stack that tells it top to bottom.

## Regions

- **Top bar**: brand (links to aturi.to) and the Settings button. The theme toggle and the mode tabs are gone.
- **This page** (open on post.html): tab line with a quiet *Scan again*; face = `Bluesky post by dame.is` and where the scan found it; body = the ledger (AT URI, Link, Handle, DID, PDS, CID) and the *Open on aturi.to* band along the bottom edge. The AT URI row carries a `⌘C` hint: with the popup focused, ⌘C/Ctrl+C copies the AT URI, the keyboard path that was missing.
- **Open in** (open on post.html): face = *Recommended for posts* strip and its rows (Anisota, Blacksky); body = the five groups as runs of the shipped waypoint rows, each run under a paper guide strip with the group's name and count. Absent apps keep their dimmed row. A new-waypoints notice would be one more strip at the top of the body (`6 new since your last visit · Add`), not a banner over the record.
- **Also on this page · 5** (closed on post.html): face = `Posts by kyefox.com, bjkeefe.bsky.social, …`, ellipsised; body = one row per reference (handle, a line of the post, copy-AT-URI on hover; the row opens it on aturi.to), under a strip that says where they came from.
- **Auto-redirect** (closed): face = shuffle mark, `Off · links open where they are` (On: `On · Bluesky links open in Anisota`), the switch; body = a sentence on what it does, *Pause on this tab* (disabled while off), and a band to *Choose favourites in Settings*. Paused takes the amber tokens on the face only, not a strip across the popup.
- **No-data page**: This page's face says *No Atmosphere data on this page* and why; its body is the one useful thing, a lookup field (handle, DID or at:// URI → opens on aturi.to) with recent repos as chips. The second drawer becomes *Jump to an app* with the note *Shortcuts open each app's home page* on its tab line, and the same grouped rows with each app's home host. There is no *Also on this page* drawer. Auto-redirect is the same closed drawer.

## The three jobs, in clicks

- **Jump**: one click on a row in Open in (the recommended two are in the face, so one click even when the drawer is closed). Other groups: scroll, or open the drawer if it was shut, then one click.
- **Copy**: one click on a ledger row (the whole row is the button; the glyph is its tell); the row turns soft green, the label reads *Copied*, the glyph becomes a tick, nothing moves. Keyboard: ⌘C for the AT URI, or Tab to a row and Enter. Any waypoint's link: hover the row, click its copy glyph, as today.
- **Hand off**: one click on *Open on aturi.to* at the foot of This page.

## Where things went

- **Inspect's content**: the identifiers are the ledger in This page; the referenced records are the *Also on this page* drawer; raw JSON, engagement counts, PDS explorer and links-in are not in the popup, they are what *Open on aturi.to* is for (the band's note says so). The toolbar badge can keep counting the references; the drawer's tab repeats the count because it is the drawer's name.
- **Auto-redirect and the pause**: their own drawer at the foot of the stack, with the switch in the face so it is one click without opening, and the pause inside because it only means anything once the switch is on.
- **Theme**: Settings → Appearance. **Settings**: the top bar's one button, plus the band inside Auto-redirect.

## Dropped, and why

- The Waypoints/Inspect mode tabs: one page, one story.
- The page card's two copy buttons: the ledger covers them and four more.
- The theme toggle from the top bar: a setting changed once.
- The sticky footer: the switch lives in a drawer that names its scope.
- The no-data tile wall: rows in a drawer the user can shut, under a lookup field.
- The Inspect card per hit with preview, counts, JSON and five chips: the popup copies, the site explains.

## Scaling

- **40 references**: the face still reads `Posts by a, b, c…`; the body lists the first ten rows and ends in a `Show all 40` row that extends the drawer. The tab says `· 40`.
- **Profile page (no rkey)**: face `Bluesky profile · dame.is`; the ledger loses CID and the AT URI row shows `at://did…/app.bsky.actor.profile/self` (or just the DID row when there is no record to name); the band still opens the profile on aturi.to; Open in's recommended strip reads *for profiles*.
- **One group or six**: the body is one run or six; a single group drops its guide strip.
- **Long handles and hosts**: ledger values on one line ellipsise; a value that will not fit flips to the stacked, wrapping row like the AT URI; the face's source line and the refs face ellipsise; waypoint rows truncate as they do today.
- **Font-size presets**: everything is on the `--fs-*` scale and integer line heights, so the ledger rows and tabs grow together.

## Trade-offs I accept

- Each closed drawer still costs a tab line plus a face row (about 68px). That is the price of a stack whose shut drawers are still legible; a bare "drawer front" bar would be cheaper but a second kind of drawer.
- With Open in pulled out the post page is as long as today's (1982px). The drawers remember, so a user who wants the short popup shuts Open in once and keeps the recommended two in its face; I would ship it that way once the recommendations prove themselves.
- The auto-redirect state is at the bottom of the stack, so with Open in open it is off-screen until you scroll. It is a global setting changed rarely, and the toolbar badge can carry its state. If the owner wants it always in view, the Auto-redirect drawer's face can be the one sticky thing in the popup (the face only, bottom-pinned) without changing the model; I did not do that, because it brings the footer back in a drawer's clothing.
- The recommended face shows two rows; a user whose client is in a group below scrolls or shuts the ledger. Recents, if on, would become rows in the face under their own strip, which fixes this for regulars.

## Would I change part of the assignment?

Not the stack, nor the face/body split. The one thing I would reconsider is the *Also on this page* face: naming authors is honest but says little about why the user would open it. If the scan can tell what kind of references they are (quotes, replies, a thread), the face should say `5 quoted posts` instead of listing handles.

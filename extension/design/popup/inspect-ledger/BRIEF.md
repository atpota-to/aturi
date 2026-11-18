# Inspect tab redesign: brief for the mockup designers and judges

The aturi browser extension's popup has two folder tabs: Waypoints (open the current record in another client) and Inspect (the AT URIs the extension found on the page). This brief is about the Inspect tab only.

## What the owner asked for
"Make it more legible and less messy/complicated. Ideally we send people to the website to see the full info and focus mostly on providing quick copies to the data like DID, AT URI, etc."

So the tab's job becomes: (1) show what Atmosphere records this page is about, (2) let the user copy the identifiers they need in one click, (3) hand off to aturi.to for everything deeper. It is not a reader or a dashboard.

## The popup
380px wide at the medium text preset (360 small, 420 large, 460 extra large), and Chrome caps it at 600px tall: `frame.html` is that window, with the real top bar (brand, the Waypoints/Inspect folder tabs, theme and settings buttons) and the sticky auto-redirect footer. The body between them scrolls. Everything between `<main class="popup-body">` and `</main>` is yours.

The design system is the site's "Field Notes": paper page, white cards behind one `--border-medium` hairline, two radii (`--radius-card` 12px, `--radius-control` 8px, `--radius-pill`), flat (no gradients, glows, or shadows except `--shadow-pop` on floating things), moss as the only accent (`--accent-moss` fills, `--text-accent` text, `--accent-soft` pale pill with `--accent-soft-fg`), Figtree for UI, IBM Plex Mono for identifiers (`--font-mono`), eyebrow labels 12px/700. Tokens are in `tokens.css` (light default, `[data-theme='dark']`; `--fs-xs/sm/md/base/lg/xl` scale with the text preset). `popup.css` is the shipped popup stylesheet: its classes are available to you (the `.inspect-*` rules draw today's layout; `.popup-section.is-sheet > .popup-section-label` is the drawer tab the Waypoints tab uses; `.popup-page`, `.popup-page-btn`, `.popup-waypoint` rows, `.popup-tile` tiles, `.inspect-chip` copy chips) and you may reuse, override or ignore them. Prefer tokens over raw values so dark works for free.

The motif the owner wants leaned into: a card catalog. The panel is the open folder, folder tabs stand on its edge, drawer tabs name each box, filed things sit a step below the page. One hairline, two tones, three pixels.

## What the extension knows about each detected URI (`data.json`)
`hits` are the real scan of the Bluesky post page named in the file, resolved the way the extension resolves them:
- `uri` (the AT URI), `where` (how it was found: `url` address bar, `at-tags` declared by the page with a `relation` such as canonical/author, `head`, `meta`, `link`, `jsonld` structured data, `text`), `whereLabels` gives the current wording.
- resolved identity: `handle`, `did`, `pds` (URL) and `pdsHost`.
- parsed: `collection` and its friendly `kind`, `rkey`.
- the record, when it was fetched: `cid`, a text `preview`, and for posts `engagement` (replies, reposts, likes, quotes) plus `linksIn` (inbound links across the Atmosphere).
- links: `universalLink` (the aturi.to share link), `explorer` (the record on aturi.to), `pdsExplorer` (the PDS on aturi.to), `rawJson` (the record's JSON straight from the PDS).
Copyable today: AT URI, DID, PDS, Link (universal), JSON (whole record), CID. The handle is not copyable today but could be.

Note hits 1 and 2 are the same record found two ways; hits 3-7 are other posts the page references in its structured data. A page can have one hit or forty; a profile page has no rkey and no record; a non-Atmosphere page has none (that empty state is out of scope).

## What is wrong today (see `current/inspect-light__view.png`, `current/inspect-light__full.png`, `current/inspect-dark__view.png`)
Each hit is a tall card: a source tag and a kind label, a four-segment breadcrumb of deep links, the post text, an engagement row, a "Copy" row of five chips, a raw-JSON disclosure, a cid chip beside two more links, and an "Open in Explorer" footer. Seven cards, roughly 330px each: 2,600px for one page, every card the same weight whether it is the page's own record or a passing reference, and six different kinds of control in each. The identifiers themselves (what the user came to copy) are the smallest text on the card.

## What a good mockup does
- Puts the identifiers and their copy actions first: large enough to read, one click to copy, a clear copied state. Decide which identifiers earn a place by default (AT URI, DID, handle, PDS host, the aturi.to link, CID?) and which can live behind one more step.
- Gives the page's own record (canonical / address bar) more weight than the references, and folds duplicates (hits 1 and 2) into one.
- Hands off to aturi.to with one obvious action per record (and possibly one for the PDS); the preview text, engagement counts, raw JSON and deep-link breadcrumb are candidates to drop or demote, since the website shows them better.
- Fits the first 600px with something useful: the page's record and its copies, and a sense of how many more there are.
- Scales: 1 hit, 7 hits, 40 hits; no rkey (a profile); long handles (`bjkeefe.bsky.social`), long PDS hosts (`puffball.us-east.host.bsky.network`), long DIDs. Identifiers in mono, truncated with care (the start and end of a DID both matter; an rkey is short; a handle should stay whole).
- Stays in the system: tokens, hairlines, the two radii, the motif. In-character ideas (an index card, a ledger, a drawer, a filed stack) are welcome; generic dashboard moves are not.
- Keyboard: every copy and open is a button or link; a copied state that does not shift the layout.

## Deliverable (designers)
In your directory: `body.html` (the markup that goes inside `<main class="popup-body">`; static, show the state with the 7 hits from data.json; you may also show one chip in its copied state and one row hovered by adding a class, as long as you label it in NOTES.md), `style.css` (your rules; loaded after popup.css), and `NOTES.md` (the idea in a paragraph, what you kept, demoted and dropped and why, how it scales to 1/40 hits and to a profile page, and anything you want the judges to notice). Render with `node ../render.mjs <your-dir>` (run from the inspect directory: `cd <inspect dir> && node render.mjs <your-dir>`), look at `light__view.png`, `light__full.png` and `dark__view.png`, and iterate until it is right. Use the fixture strings exactly. Icons: `icons.html` has lucide paths to copy.

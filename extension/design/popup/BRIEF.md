# aturi browser extension popup: brief for a design exploration

The owner asks two things: "how could the browser extension's design and UX be better?" and "I'm not sure the Inspect tab is the best way for this to work; give me more options." This round explores the popup's whole model, not one tab's layout. Each designer builds one model as a complete popup, in two page contexts, and a panel compares them. The owner will look at the renders and pick a direction; nothing here ships as is.

## What the extension is
A Chrome/Firefox extension for the AT Protocol "Atmosphere" (Bluesky and the apps around it). On any page it works out which Atmosphere record the page is about (a post, a profile, a list, a feed), by reading the address bar, the page head, meta and link tags, structured data and at:// links in the text. Its popup then lets the user:
1. **Jump**: open that record in another client (30 "waypoints" in 6 groups: Bluesky clients, Bluesky forks, publications, Atmosphere apps, dev tools; the extension recommends one or two for the record's kind and dims apps that hold no records for this author).
2. **Copy**: the record's identifiers: the AT URI, the author's DID and handle, the PDS host, the aturi.to universal link, the record's CID.
3. **Hand off**: open the record on aturi.to, where the website shows everything (the record, raw JSON, the PDS, inbound links, the author's whole repo).
4. **Auto-redirect**: a global setting that sends links straight to the user's favourite client; the popup shows its state, and when on, a per-tab pause.
5. Reach settings (the options page: groups, custom waypoints, redirect favourites, appearance), and switch theme.
On a page that is about nothing (example.com) it offers shortcuts to every app's home page. A page can also reference other records (a thread page references the posts it quotes): the scan finds those too (7 on the sample post page: the page's own post twice, found two ways, plus 5 posts it references).

## The current popup (`current/`)
380px wide, Chrome caps it at 600px tall; the top bar and the auto-redirect footer are sticky. Top bar: brand, two folder tabs (Waypoints, Inspect with a count badge), theme toggle, settings. **Waypoints tab** (`post-waypoints-light__view.png`, `__full.png`): a page card ("Post by dame.is", "app.bsky.feed.post · on Bluesky", two buttons: Copy aturi.to link, Copy at:// URI), then "Recommended for Posts" and the five groups as drawer-tabbed boxes of rows (icon, name, "View post on host", a copy-link button on hover). **Inspect tab** (`post-inspect-light__view.png`): one card per detected URI with source tag, breadcrumb, preview text, engagement counts, five copy chips, raw JSON, cid, links; a redesign of that tab as a ledger was mocked up last round (`inspect-mockup-final-light__view.png`): a "This page" index card with a ledger of the six identifiers and one "Open on aturi.to" band, the other records filed in a second drawer. **No-data page** (`nopage-light__view.png`, `__full.png`): a notice, then "Jump to an app" with every app as a tile in group panels. **Footer**: Auto-redirect with an On/Off switch (`post-redirect-on-light__view.png` shows On with "Pause on this tab"). **Banner** (`post-newwp-light__view.png`): new waypoints since last visit, between the card and the list.

## What is awkward today (observations to design against; agree or argue in NOTES.md)
- Two tabs split one page's story. "Waypoints" is where to go; "Inspect" is what this is and what to copy. The page card on the Waypoints tab already copies two identifiers, so the same job lives in two places, and the Inspect tab's real content (the other records the page references) is hidden behind a tab whose name does not say so.
- The footer is a global switch (auto-redirect for the whole extension) shown on every page in the place a per-page control would be; "Pause on this tab" only appears once it is on, and the amber strip when paused is the loudest thing in the popup.
- The theme toggle holds a permanent top-bar slot for a setting changed once.
- The no-data page is a wall of thirty tiles; the useful part (a way to look something up, or recent repos) is absent or buried.
- Thirty rows in six groups is a long scroll every time; the recommended row helps; recents exist but are off by default and sit above the recommendation.
- There is no way to look up a handle or DID from the popup (the site's header has a go-to field), and no keyboard path to copy the URI.
- The toolbar badge counts detected URIs and the Inspect tab repeats the count.

## Materials
- `waypoints.json`: exactly what the Waypoints tab lists on the sample post page (recommended, groups, hosts, absent rows) and on the no-data page; the page card's text; the redirect footer's states.
- `data.json`: the sample post page's 7 detected URIs with every identifier the extension resolves (AT URI, DID, handle, PDS, CID, universal link, explorer link, preview, engagement). Hits 1 and 2 are the same record; 3-7 are references.
- `icons.json`: the real waypoint marks as inline SVG strings keyed by waypoint id (paste the `svg` string into your markup inside `<span class="popup-waypoint-icon">…</span>`; popup.css sizes them at 16px in rows and 20px in tiles). `icons.html`: lucide paths for UI glyphs.
- `tokens.css` (the design tokens: light default, `[data-theme='dark']`; text presets `--fs-xs/sm/md/base/lg/xl`; `--radius-card` 12px, `--radius-control` 8px; Figtree and IBM Plex Mono) and `popup.css` (the shipped popup stylesheet: `.popup-shell`, `.popup-topbar`, `.popup-mode-tabs/.popup-mode-tab` folder tabs, `.popup-page` card, `.popup-section.is-sheet > .popup-section-label` drawer tabs, `.popup-waypoints` boxes and `.popup-waypoint` rows, `.popup-tiles/.popup-tile`, `.inspect-chip`, `.popup-redirect` footer, `.popup-update-banner`, `.popup-icon-btn`, `.aturi-switch`). Reuse, override or ignore; stay on tokens so dark works.
- `frame-open.html`: your file is the whole `<body>`: you own the top bar, the body and the footer. `render.mjs` renders `post.html` and `nopage.html`.

## The system
"Field Notes": paper page, white cards behind one `--border-medium` hairline, two radii, flat (no gradients, glows; shadows only on floating things), moss as the only accent, Figtree for UI, Plex Mono for identifiers. The motif the owner wants leaned into: a card catalog. Folder tabs stand on the edge of the open folder; drawer tabs name each box; filed things sit a step below the page. Flat, one hairline, two tones, three pixels. An index card, a ledger, a drawer, a filed stack, a pulled card are all in character; a dashboard, a hero, a gradient button are not.

## What a good model does
- Makes the three jobs (jump, copy, hand off) each one obvious step on the page's own record, in the first 600px.
- Decides what Inspect's content becomes: identifiers on the page's record, and the other records the page references; whether that is a tab, a card, a drawer, a disclosure, a menu or a hand-off to the site. The owner's instinct: copies belong in the popup, the full information belongs on aturi.to.
- Gives the auto-redirect state and the per-tab pause a home that fits their scope.
- Handles the no-data page without a wall, and gives it one useful thing to do.
- Scales: one waypoint group or six; a page with one record, or one plus 40 references; a profile page (no rkey); long handles and hosts.
- Keeps settings and the brand reachable; keep the brand mark top-left.
- Stays in the system and reads as the same product as aturi.to.

## Deliverable
In your directory: `post.html` (the whole popup on the sample post page, in your model; show the identifiers your model exposes, with one copy control in its copied state; static), `nopage.html` (the whole popup on a page with no Atmosphere data), `style.css` (your rules, loaded after popup.css), `NOTES.md` (the model in a paragraph; what each region is for; how the user does each of the three jobs, in clicks; where the referenced records went; where auto-redirect, the pause, theme and settings went; what you dropped and why; how it scales to 40 references and to a profile page; the trade-offs you accept). Render with `cd <this dir> && node render.mjs <your-dir>` and look at `post-light__view.png`, `post-light__full.png`, `post-dark__view.png`, `nopage-light__view.png`. Iterate at least twice. Use the fixture strings and the real icons. Mark any sticky region with `data-sticky` on the element so the full-page render can un-stick it.

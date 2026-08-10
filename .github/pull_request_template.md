## What this changes

<!-- What the code does differently now. One or two sentences. Not a restatement of the diff. -->

## Why

<!-- Link the issue if there is one. If there isn't, say what prompted this. -->

## How I verified it

<!-- What you actually ran and looked at. Be specific: which page, which record, which browser.
     "Loaded aturi.to/profile/alice.bsky.social/app.bsky.feed.post/3k7… in Firefox and confirmed
     the picker lists Grain" is useful. "Tested locally" is not. -->

## Checks

Tick what you ran. Leave the rest unticked; an unticked box is information, not a failure.

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `cd extension && npm run compile && npm test`
- [ ] `cd packages && npm run sync:check && npm test && npm run build`

If you edited any of `src/utils/waypoints.data.ts`, `uriParser.ts`, `reverseParsers.ts`, `upstreamFetch.ts`, `waypointIcons.tsx`, or `src/components/AnisotaLogo`:

- [ ] Ran `cd packages && npm run sync` and committed the regenerated copies

If this adds a waypoint:

- [ ] Added to `WAYPOINT_DESTINATIONS_DATA` **and** `WAYPOINT_ORDER`
- [ ] Added an icon to `WAYPOINT_ICONS`
- [ ] Set `redirectCompat` (empty array if the app should never be an auto-redirect target)
- [ ] Live links below, one per record type listed in `supportedTypes`

<!-- Paste the links here so a reviewer can click them. -->

## AI assistance

- [ ] An AI agent wrote some or all of this

If ticked:

- [ ] I ran the result, not only the tests
- [ ] The diff contains no unrequested refactors, renames, or reformatting
- [ ] I can explain every line, and I checked the URL patterns and NSIDs against the live app rather than trusting the model

Disclosing this does not count against the PR. It tells the reviewer where to look.

## Anything unresolved

<!-- Failing checks you could not explain, decisions you were unsure about, things you deliberately
     left out. Say it here rather than hoping it goes unnoticed. -->

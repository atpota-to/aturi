# Aturi lexicons

Lexicon schemas for the records Aturi writes to a user's PDS. They live here so
other Atmosphere developers can read them, validate against them, and — for the
public ones — build on them without depending on Aturi at all.

Each schema is also served over HTTP, e.g.
[`aturi.to/lexicons/to.aturi.actor.preferredClients.json`](https://aturi.to/lexicons/to.aturi.actor.preferredClients.json).

## `to.aturi.actor.preferredClients`

**Public. Meant to be read by other apps.** A declaration of which client
interfaces the account holder wants records opened in — "show me Bluesky posts
in Blacksky, Tangled records in Tangled, everything else in PDSls."

Right now the ecosystem default is to link every `app.bsky.feed.post` to
bsky.app, which is a guess about the reader that is often wrong. This record
replaces the guess with an answer the reader wrote down themselves. If your app
links out to Atmosphere records and knows who it's linking on behalf of, you can
read this record for that account and honor it.

```jsonc
{
  "$type": "to.aturi.actor.preferredClients",
  "preferences": [
    {
      "scope": "app.bsky.feed.post",
      "clients": [
        { "id": "blacksky", "name": "Blacksky", "homepage": "https://blackskyweb.xyz" },
        { "id": "bluesky", "name": "Bluesky" }
      ]
    },
    {
      "scope": "sh.tangled.*",
      "clients": [{ "id": "tangled", "name": "Tangled" }]
    },
    {
      "scope": "*",
      "clients": [{ "id": "pdsls", "name": "PDSls" }]
    }
  ],
  "createdAt": "2026-08-07T17:04:11.000Z",
  "updatedAt": "2026-08-07T17:04:11.000Z"
}
```

### Matching

A rule's `scope` is one of:

| Form | Example | Matches |
| --- | --- | --- |
| Collection NSID | `app.bsky.feed.post` | exactly that collection |
| Namespace wildcard | `app.bsky.*` | every collection under that prefix |
| Record kind | `post`, `profile`, `list`, `record` | any record of that kind |
| Catch-all | `*` | everything |

When several rules match, **the most specific wins**: exact NSID, then the
longest namespace wildcard, then the record kind, then `*`. Array order is not
significant. Within the winning rule, `clients` is ordered — use the first entry
you can build a link for.

### Reading it

The matching, validation, and link-building are implemented for you in the
MIT-licensed [`@aturi.to/waypoints`](../packages/waypoints/README.md):

```ts
import { fetchPreferredClients, preferredWaypointFor } from '@aturi.to/waypoints';

const record = await fetchPreferredClients('alice.bsky.social');
const choice = preferredWaypointFor(record, {
  type: 'post',
  handle: 'bob.bsky.social',
  collection: 'app.bsky.feed.post',
  rkey: '3k7qw...',
});
// { client: { id: 'blacksky', name: 'Blacksky' }, url: 'https://blackskyweb.xyz/profile/…' }
```

Or without installing anything, let the hosted resolver apply it:

```
GET https://aturi.to/api/resolve?atUri=at://…&actor=alice.bsky.social
```

Never got a record back? That's the common case — fall back to whatever you do
today. The record is an override, not a requirement.

### Writing one

[The guided setup](https://aturi.to/welcome) is the short path. It asks three
questions (which client you read Bluesky in, which reader you use for
publications, which explorer you want for raw records) and writes the matching
rules: `app.bsky.*` and `profile` from the first, `pub.leaflet.*` and
`site.standard.*` from the second, `*` from the third. Settings → Clients is the
long path, with any scope, any fallback order, and off-catalog clients carrying
their own URL templates.

Publishing is opt-in either way, and switching it off deletes the record rather
than leaving a stale declaration behind. An account that stops declaring should
read as "no preference", not as "still prefers whatever it said in 2026".

## `to.aturi.actor.preferences`

Aturi's own app settings — waypoint groups, custom waypoints, pinned lexicons,
color scheme, explorer layout. Personal configuration for the Aturi surfaces
rather than an interop point, so it has no published schema; the shape is
documented inline in
[`src/utils/atproto/preferencesPds.ts`](../src/utils/atproto/preferencesPds.ts).

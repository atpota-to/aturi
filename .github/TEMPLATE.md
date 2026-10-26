# Forking aturi.to

The app is GPL-3.0-or-later, so you can run your own instance: a waypoint catalog curated for one community, a different default client, your own branding. This is what to change.

If you only want the waypoint catalog and URI resolution in an app of your own, do not fork. Install [`@aturi.to/waypoints`](../packages/waypoints/README.md), which is MIT and carries no copyleft obligations.

## Setup

```bash
git clone https://github.com/atpota-to/aturi.git your-fork
cd your-fork
nvm use
npm install
cp .env.example .env.local
npm run dev
```

## What to customize

**Branding and domain** live in `.env.local`. Copy `.env.example` and set `NEXT_PUBLIC_DOMAIN`, `NEXT_PUBLIC_SITE_NAME`, `NEXT_PUBLIC_SITE_DESCRIPTION`, `NEXT_PUBLIC_AUTHOR_NAME`, `NEXT_PUBLIC_AUTHOR_URL`, and `NEXT_PUBLIC_REPO_URL`. `NEXT_PUBLIC_SITE_URL` is detected on Vercel and only needs setting elsewhere.

**The waypoint catalog** is `src/utils/waypoints.data.ts`. Trim `WAYPOINT_ORDER` to the clients your community uses, reorder it to change what surfaces first, or add your own entries. The [waypoint walkthrough in CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-waypoint) explains the shape of an entry and the three other places a new one has to be registered.

**Colors and styling** are CSS variables in `src/app/globals.css` alongside Tailwind v4 utilities.

**Redirects** in `vercel.json` are specific to this deployment; the `altsky.app` rule points at aturi.to and should be removed or replaced in a fork.

## Deploying

Import the repository in Vercel and deploy. The OpenGraph route needs the Edge Runtime, which is why the app targets Vercel; other hosts work if they support it. Set your `NEXT_PUBLIC_*` variables in the project's environment settings.

## What the license requires

GPL-3.0-or-later, so:

- Keep the [LICENSE](../LICENSE) file, and license your fork under the same terms
- Publish your source
- State that you changed it, and when

Attribution to the original project is appreciated but not required beyond what the license says. Note that `packages/` is MIT rather than GPL; those two libraries can be reused under either license.

Built something for a specific community? Say so at [aturi@atpota.to](mailto:aturi@atpota.to) or [@aturi.to](https://bsky.app/profile/aturi.to) and it can be featured.

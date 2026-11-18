# Plan: account checks in the Explorer

Status: in progress.

Labels and Visibility (the shadowban checker) run by themselves for every
account the Explorer opens, and show on the account card in all three
layouts (Workbench, Files, Classic), with a full view one click away. Lists
and verifications, the activity calendar and the repo archive move to a
quieter Tools list in the sidebar. The tool pages under `/tools` keep
working on their own.

The design record is the round 2 mockup page
(claude.ai/artifact/SuSqMwnkBTJg5TuMrPUEn2). This file tracks the build.
Each milestone ends in a commit pushed to `testing`, so the work survives a
session ending part way.

## Decisions

Taken from the round 2 mockups where the review left a question open.

- **D1 (AppView):** the card checks Bluesky's AppView for everyone. The
  Visibility view keeps the checker's AppView switch (Bluesky, Blacksky, any
  host) for the view only, so the card's answer stays comparable from one
  account to the next.
- **D2 (Classic tools):** in Classic, Lists and verifications, Activity
  calendar and Repo archive are links to their tools from a Tools list under
  the account card. Classic's views live in its main-column tabs, and two
  more tabs would crowd them. In Workbench and Files, Lists and Activity
  open in the main pane and Repo archive opens its tool.
- **D3 (Bluesky moderation labels):** an active label from Bluesky's own
  moderation service leads the card's Labels row in amber, and turns the
  folded card's label badge amber, so it shows on every page of the account.
- **D4 (no Bluesky profile):** when Bluesky's AppView answers "Profile not
  found", both rows say "No Bluesky profile" and the visibility check does
  not run. The label check's first request is what finds this out, so it
  costs nothing extra. A suspended account still runs the visibility check,
  which reports the suspension.
- **D5 (cost):** one run per tool and account, kept ten minutes and shared
  by the card, the views and the tool pages. Visibility starts after the
  label check's first answer (a few hundred milliseconds), which keeps it
  out of the way of the page's own first requests. Leaving the account
  aborts runs nothing else is waiting on.

## Milestones

### M0. Plan

- [x] This file.

### M1. Shared runs and summaries (pure, tested)

- [x] `src/lib/tools/runCache.ts`: a keyed store of runs. One run per key,
      joined by every caller; results kept for a TTL; an unsettled run
      aborted when its last subscriber leaves (after a short grace, so a
      remount does not restart it); `rerun` replaces the entry.
- [x] `useSharedToolRun` beside `useToolRun`, with the same return shape
      plus when the result settled.
- [x] `src/lib/tools/accountChecks.ts`: `labelSummary` (active count,
      sources, Bluesky moderation labels first), `visibilitySummary` (the six
      dot states and a short verdict), `profileAbsence` (reads the AppView's
      wording: missing, suspended, deactivated).
- [x] Tests for all three in `src/lib/tools/__tests__/`.

### M2. Tools that can be embedded

- [ ] `ToolShell` gains an embedded mode: no head card or form, an "Open in
      <tool>" link, and an optional row of controls.
- [ ] `LabelChecker`, `ShadowbanChecker`, `Memberships`, `ActivityCalendar`
      take an optional `subject`. Given one, they read it instead of the
      query string and draw embedded.
- [ ] The label checker's two runs and the shadowban checker's run go
      through the shared cache, keyed so the explorer and the tool page
      share a run for the same DID.
- [ ] Tool pages behave exactly as before (verified in a browser).

### M3. The card rows (all three layouts)

- [ ] `AccountChecks`: Labels and Visibility rows inside `AccountCard`,
      which the workbench rail, the Files rail and Classic's sidebar all
      draw.
- [ ] Loading states: skeleton while asking Bluesky; count, bar and
      "n of 611" while scanning; six dots filling as each visibility check
      returns; pills when done.
- [ ] End states: clear, no labels, Bluesky moderation label (amber),
      missing replies / left out of search (amber with dots), not shown
      (red), no Bluesky profile, could not ask (Retry), seen before (age).
- [ ] Each row links to its view.
- [ ] Badges in the folded rail header: label count (ring while
      scanning), eye (spinner while running, then green, amber or red).

### M4. Views in Workbench and Files

- [ ] `labels`, `visibility`, `lists` and `activity` in `ACCOUNT_TABS`.
- [ ] Rail nav: Overview, Labels, Visibility, Backlinks, Graph, with badges
      on Labels (count, ring while scanning) and Visibility (spinner, then a
      tone).
- [ ] Rail Tools list: Lists and verifications, Activity calendar (views),
      Repo archive (link to `/tools/car`).
- [ ] `AccountView` draws each check view with the embedded tool.
- [ ] The button row under "Repo at a glance" is removed.
- [ ] Rail skeleton matches the new rail.

### M5. Classic

- [ ] Labels and Visibility tabs after Collections on the repo page, with
      the same badges.
- [ ] Tools list under the account card on the repo and collection pages,
      replacing the button row.
- [ ] Author card on record pages: the author's two rows, linking to the
      repo page's tabs.

### M6. Verification and wrap-up

- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- [ ] `cd extension && npm run compile && npm test` (it imports
      `src/utils`; nothing there should change, but run it).
- [ ] Browser pass in all three layouts: an ordinary account, an account
      with no Bluesky profile, light and dark, desktop and phone widths.
- [ ] This file marked done, with anything left over listed below.

## Left over

Nothing yet.

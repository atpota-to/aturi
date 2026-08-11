# CLEANER.md

Instructions for coding agents on removing AI tells from code, comments, copy, and interface design.

An AI tell is rarely a style violation on its own. It is evidence that a choice was defaulted instead of made: a comment that narrates because nobody decided what was worth explaining, a violet gradient because nobody picked a color, an em dash because the sentence was never given a structure. Cleaning up means going back and making the decision.

This file is project-agnostic and deliberately opinionated about defaults. The project you are working in outranks it. If a codebase puts JSDoc on every export, keep writing JSDoc. If its section labels are uppercase, keep them uppercase. Read the surrounding file first and match it. What follows is what to do when nothing local tells you otherwise.

## What to clean, and what to leave alone

Clean the output you just produced. That is the diff you are about to hand back, the copy you just wrote, the screen you just built.

Do not open files you were not asked to touch in order to fix their comments. Do not reformat neighboring code. Do not strip em dashes out of prose a human wrote; they are ordinary punctuation, and the tell is the machine's frequency and its rhetorical uses, not the character existing in someone's writing. A cleanup that turns a 40-line feature into a 900-line diff has made the review harder, which is the opposite of the goal.

Four things this document is not asking for:

- Not zero comments. Fewer comments, each carrying something the code cannot.
- Not zero defensive code. Validate at real boundaries: network responses, user input, parsed text, anything crossing a trust line. Delete guards against states the type system already rules out.
- Not a banned-word filter. Removing "leverage" from a paragraph that still has nothing specific in it produces the same slop with a smaller vocabulary.
- Not a house style overriding the project's. When this document and the codebase disagree, the codebase wins.

## Code

**Guards against impossible states.** Defensive scaffolding accumulates around values that were never in doubt. A non-optional parameter does not need a null check, an array typed as an array does not need `Array.isArray`, and `.length` does not throw.

```ts
// Before
function getCount(items?: Item[] | null): number {
  if (!items) return 0;
  if (!Array.isArray(items)) return 0;
  try {
    return items.length;
  } catch {
    return 0;
  }
}

// After
function getCount(items: Item[]): number {
  return items.length;
}
```

Same family: `obj?.prop` where `obj` is always defined, `value ?? fallback` where `value` is non-nullable, and a `default:` branch returning a placeholder from a switch that is already exhaustive over a union. A `default:` that asserts exhaustiveness (`const _never: never = value`) is doing real work; keep that one.

**Abstractions with one caller.** A wrapper that forwards its arguments to one function, a constant used once three lines below its declaration, a `types.ts` holding a single interface, an `index.ts` re-exporting two modules. Extract on the second use, not in anticipation of one.

```ts
// Before
function getUserDisplayName(user: User): string {
  return formatDisplayName(user.name, user.handle);
}

function formatDisplayName(name: string, handle: string): string {
  return name || `@${handle}`;
}

// After
const displayName = user.name || `@${user.handle}`;
```

**Compatibility shims for code with no other callers.** Keeping the old function as a deprecated alias, accepting both the old and new argument shapes, adding a flag to switch between the old and new behavior. Check whether anything else actually calls it. In a repository you can see all of, if the answer is no, delete the old path. Published APIs are the exception, and there the deprecation belongs in a release note rather than an inline comment.

**Reimplementations of things that already exist.** Hand-rolled `debounce`, `clamp`, `deepClone`, `formatDate`, `uuid`, and `groupBy` show up constantly. Check the standard library, the framework, and the project's own utilities before writing one. Searching the codebase for the concept takes less time than the function does.

**Names that describe their own type.** Length is not clarity. Long names are usually a sign the thing was named from its context rather than its job.

| Generated | Better |
| --- | --- |
| `handleButtonClickEvent` | `onSubmit` |
| `userDataResponseObject` | `profile` |
| `isUserAuthenticatedAndActive` | `canPost` |
| `getFormattedDisplayNameString` | `displayName` |
| `processData`, `handleData`, `doWork` | name the operation: `parseUri`, `mergePrefs` |
| `data`, `result`, `item`, `temp` | name the thing: `records`, `parsed`, `record` |

**Error messages that only restate the function name.** An error is read once, in production, by someone who cannot reproduce it. It should carry the operation and the input.

```ts
// Before
throw new Error('Failed to fetch user data');

// After
throw new Error(`getProfile(${did}) failed: ${res.status} ${res.statusText}`);
```

**Type escape hatches used to silence a checker.** `as unknown as Foo`, `@ts-ignore`, `any` on a value whose shape is known, a non-null `!` added because the build complained. Each one converts a compile-time error into a runtime one. Fix the type or narrow the value. If a cast is genuinely unavoidable, the comment above it explains what guarantees it.

**Tests that assert the mock.** Mocking a module and then checking that it returns what the mock was told to return tests nothing. So does asserting that a component rendered, that a constant equals itself, or that the framework works. Test names should state the case, not the aspiration: `it('should work correctly')` becomes `it('returns null for an at:// URI with no rkey')`.

**Leftovers.** Before handing back a diff, remove debug logging you added for your own benefit, commented-out code, unreachable branches, unused parameters kept "for extensibility", and `TODO` comments with no owner and no issue number. Also read the diff for lines that are not the change: reordered imports, changed quote style, added trailing commas, a reformatted function you happened to scroll past.

## Comments

A comment earns its place by holding information the code cannot hold. Everything else is maintenance debt, because a comment that duplicates the code will eventually contradict it.

Delete these outright:

- Narration. `// Loop through the users` above a `for` loop, `// Set loading to false`, `// Return the result`.
- Banner dividers. `// ===== HELPERS =====`, `// --- State ---`, boxed ASCII headers, file-top blocks listing the file's own contents.
- Doc comments that restate the signature. `@param userId The user ID` adds nothing to `userId: string`.
- Changelog notes. `// Updated to use the new API`, `// NEW:`, `// Fixed bug where the handle was undefined`, `// was: getUser(id)`. Version control already holds this, with dates and authorship.
- Comments addressed to the reviewer rather than the reader. `// As requested, this now handles the empty case`.
- Self-assessment. `// This is a bit hacky but it works`, `// Not the cleanest approach`, `// Note: may need revisiting`. If it needs revisiting, say what would trigger that, or fix it.
- Emoji, in comments and in log output alike.

Write these instead:

- Why the obvious approach fails. This is the single most valuable kind of comment, and almost the only one worth adding unprompted.
- Units, ranges, and encodings. `// milliseconds`, `// 0 to 1, not a percentage`, `// base32, lowercase`.
- The upstream bug or spec being worked around, with a link.
- An invariant the caller has to maintain, where the type system cannot enforce it.
- Where a magic value came from.

The difference in practice:

```ts
// Before
// Retry up to 3 times
const MAX_RETRIES = 3;

// After
// The upstream rate limiter uses a 5s window and returns 429 without a
// Retry-After header, so three spaced attempts cover one full window.
const MAX_RETRIES = 3;
```

The test for any comment you are about to write: delete it and reread the code. If nothing was lost, it was narration.

## Prose and UI copy

Word substitution is the shallow half of this. The rhetorical patterns survive it, and they are what readers actually recognize.

**The em dash.** The most commented-on tell in AI prose, and the easiest to grep for. It reads as machine output because models reach for it to join two clauses that were never given a relationship. A period, a semicolon, a colon, or a restructured sentence all work. The spaced hyphen and the en dash used the same way are the same tell wearing a different character.

**Antithesis as a default sentence shape.** "It's not just faster, it's smarter." "This isn't about tooling, it's about trust." "More than a library, it's a foundation." The construction promises a distinction and then delivers an adjective. State the thing directly.

**Decorative triads.** "Fast, simple, and reliable." "Built for developers, teams, and enterprises." Three items appear because three sounds complete, not because there are three. Two real items beat three where the third is filler.

This applies to negative-space lists too, but with a caveat worth stating: "No accounts. No tracking. Just links." is slop when the items are vibes, and is good copy when each one is a checkable claim about the product. The pattern is not the problem. Padding it out is.

**Openers that delay the fact.** "In today's fast-paced world", "It's worth noting that", "At its core", "When it comes to", "Let's dive in", "Whether you're a hobbyist or a professional". Start on the fact instead.

**The closing restatement.** A final paragraph that summarizes the three paragraphs above it. Readers who got that far already have it. Stop when you are done.

**Stacked hedges.** "This may potentially help to reduce the number of cases where errors might occur." Either it does something or it does not. More than about three hedges in a paragraph means the claim was never made.

**Every bullet as bold lead plus sentence.** A list where all twelve entries are `**Term.** One sentence.` reads as a filled-in template. Use the form where the bolded word is a real label being defined, and write plain sentences the rest of the time.

**Rhetorical questions as headings or transitions.** "So what does this mean for you?" "Why does this matter?" Replace with the answer.

Words to cut or replace:

| Category | Cut |
| --- | --- |
| Verbs | delve, leverage, utilize, foster, bolster, underscore, unveil, streamline, empower, unlock, harness, elevate, revolutionize, supercharge, navigate (metaphorical) |
| Adjectives | robust, comprehensive, seamless, pivotal, cutting-edge, world-class, best-in-class, powerful, intuitive, effortless, meticulous, curated, game-changing |
| Intensifiers | significantly, dramatically, extremely, truly, incredibly, remarkably, vastly |
| Transitions | Furthermore, Moreover, Additionally, That being said, In conclusion, Overall, Ultimately |
| Nouns | landscape, realm, tapestry, testament, journey, ecosystem (when it just means "set of things") |

Intensifiers are the useful case to understand, because the fix generalizes. "Significantly faster" is a placeholder for a measurement. Put the measurement in, or drop the claim.

Interface copy has its own set. Error messages should say what failed and what the reader can do, so "Oops! Something went wrong" becomes "Could not reach the server. Check your connection and try again." Buttons name their action, so "Get Started" becomes "Create an account". Cut "simply", "just", and "easily" from instructions, since they only ever tell a stuck user that they should not be stuck. Match the product's existing capitalization rather than introducing Title Case. Drop exclamation marks and emoji unless the product already uses them.

## Visual design

The tells below are the visual equivalent of filler words: choices no one made. They are described in Tailwind terms because that is where they most often appear, but they are framework-independent.

### Typography

The uppercase eyebrow is the most recognizable AI design trope in current use: a small, letter-spaced, muted label sitting above a heading, typically `text-xs uppercase tracking-widest text-muted-foreground`. The same treatment shows up as a section divider inside a page, and as CSS `font-variant: small-caps`. It appears because it looks designed without requiring a design decision. Unless the project already uses it as an established pattern, delete it. The heading alone is usually enough; where a category label genuinely helps, set it at body size in the project's normal case.

Other typographic defaults to reverse: Title Case headings in a product that uses sentence case, an added webfont when the project already has one, `font-bold` on everything that needs emphasis where a weight step or a color change would do, and centered alignment on paragraphs longer than a line or two.

### Color and surface

- Violet, indigo, and purple as the default accent, most often as an indigo-to-pink or blue-to-violet gradient.
- Gradient-clipped heading text (`bg-clip-text text-transparent` over a gradient fill).
- Glassmorphism by reflex: translucent white fills, `backdrop-blur`, hairline white borders on panels that are not floating over anything.
- Hardcoded hex values and stock palette colors where the project has design tokens or CSS variables. Use the tokens.
- Dark mode added as a guessed variant, producing dark grey text on slightly-less-dark grey. If you add dark styles, check the contrast rather than assuming it.

### Layout and components

Wrapping every block of content in a rounded, shadowed, bordered card is the most common structural tell, and it flattens hierarchy: when everything is elevated, nothing is. Related patterns include nested rounded corners with unrelated radii, `shadow-lg` on static content, and pill badges ("New", "Pro", "Beta") scattered for texture.

The generic marketing page assembles itself the same way every time: centered hero, subheadline, a primary button next to a ghost "Learn more", then exactly three feature cards, each with an icon in a rounded square above a bold title and two lines of description. Behind it, blurred gradient blobs, a mesh gradient, or a faint dot grid. If the brief did not call for a landing page, do not build one.

Also worth reversing: emoji standing in for an icon set, `transition-all duration-300 hover:scale-105` applied to every interactive element, entrance animations on content that was already on screen, skeleton loaders and spinners in front of operations that complete instantly, and a toast for every state change.

### Placeholder content

This one can do real damage, because fabricated content ships. Do not invent testimonials, customer names, company logos, star ratings, user counts, or "Trusted by 10,000+ teams" banners. Do not generate faces or avatars for people who do not exist. If a layout needs to show a testimonial, mark the slot as a placeholder in obviously unusable text and say so in your summary. The same goes for benchmark figures, pricing, and any number in an interface: if you did not measure it or read it from real data, it does not go on the screen.

Leave no lorem ipsum, no `href="#"`, and no dead buttons in anything presented as finished.

### What to do instead

Read the project's tokens, its existing components, and two or three screens it already ships, then build from those. When there is no design system to follow, stay plain: one accent color, one border radius, one shadow level, the system font stack, and the spacing scale you started with. Plain and consistent survives review. Decorated and defaulted does not.

## Files, commits, and pull requests

Do not create summary documents. `IMPLEMENTATION_NOTES.md`, `SUMMARY.md`, `CHANGES.md`, `MIGRATION_GUIDE.md`, and a "Recent updates" section appended to the README are all artifacts of the agent's process rather than the project's needs. The diff is the record of what changed. Write a documentation file when someone asks for one, or when a real user of the project needs it.

Commit subjects state what changed, in the tense and format the repository already uses; check `git log` before writing the first one. Skip the enumerated list of touched files, the emoji prefix the project does not use, and phrasings like "Enhanced the parser to provide improved handling of edge cases" that describe an improvement without naming it. A pull request body says what changed and what you verified. It is not the place for your reasoning trace, an implementation-phase breakdown, or a restatement of the diff in prose.

Clean the working tree too. Scratch scripts, `.bak` and `.orig` files, one-off test harnesses at the repository root, and screenshots you took while working should not be in the commit.

## The pass before you hand it back

1. Search everything you wrote for the em dash character. Rewrite each sentence that has one.
2. Read the diff top to bottom. Delete every line that is not the change you were asked to make.
3. For each comment you added: delete it mentally and reread the code. If nothing was lost, delete it for real.
4. For each new function, constant, type, or file: count the call sites. One means inline it.
5. For each error thrown or logged: does it name the operation and the input that failed?
6. For each guard you added: can the state it protects against actually occur? Keep it at trust boundaries, cut it elsewhere.
7. For every number, name, logo, quote, and rating in the interface: is it real? Remove anything you invented.
8. For every color, radius, font, and spacing value: did it come from the project's tokens?
9. Check that you did not create a file nobody asked for, and that no debug output survived.
10. Read the prose aloud. Any phrase you would not say to a colleague gets rewritten.

The test that covers all ten: could a specific person have written this, for this specific project, having made each of these choices on purpose? If the answer is that anyone could have produced it for anything, it is not finished.

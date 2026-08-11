# CLEANER.md

Instructions for coding agents on removing AI defaults from code, comments, copy, and interface design.

An AI tell is rarely a style violation on its own. It is evidence that a choice was defaulted instead of made: a comment that narrates because nobody decided what was worth explaining, an indigo button because nobody picked a color, a package import nobody checked, a grey nobody measured. Cleaning up means going back and making the decision.

Every rule here is either measured or attributed. Where a popular belief turned out to be folklore, this document says so rather than repeating it. Sources are listed at the end.

This file is project-agnostic. The project you are working in outranks it. If a codebase puts JSDoc on every export, keep writing JSDoc. If its section labels are uppercase, keep them uppercase. Read the surrounding file first and match it. What follows is what to do when nothing local tells you otherwise.

## What to clean, and what to leave alone

Clean the output you just produced: the diff you are about to hand back, the copy you just wrote, the screen you just built.

Do not open files you were not asked to touch in order to fix their comments. Do not reformat neighboring code. A cleanup that turns a 40-line feature into a 900-line diff has made the review harder, which is the opposite of the goal.

**These are editorial rules, not detection evasion.** The goal is work that is correct, specific, and decided. It is not text that scores well on an AI detector, and you should not optimize for one. Commercial detectors misclassified more than half of TOEFL essays by non-native English writers as machine-written, an average false-positive rate of 61.3%, while being near-perfect on US eighth-grade essays. Writing to beat a detector penalizes plain vocabulary and adds nothing a reader wants.

Five things this document is not asking for:

- Not zero comments. Fewer comments, each carrying something the code cannot. Under an earlier draft of this document, agents wrote zero comments on modules that needed them. That is a failure, not compliance.
- Not less defensive code. Generated code is measurably *under*-defended at its edges and over-defended in its middle. Cut guards against states the type system already rules out; add the validation at the entry point that was skipped.
- Not shorter names. Descriptive names are measurably faster to read. Cut redundancy, not meaning.
- Not a banned-word filter. Removing "leverage" from a paragraph that still says nothing produces the same emptiness with a smaller vocabulary.
- Not a house style that overrides the project's. When this document and the codebase disagree, the codebase wins.

## Code

### Correctness before tidiness

This section comes first because the measured failures of generated code are correctness failures, and the rest of this document is about tidiness. Do not tidy code you have not checked.

**Validate at the entry point.** Across 230 Java tasks and four code models, 43.1% of generated code was less robust than its human counterpart. Of the robustness defects analyzed, 90% were missing conditional checks, and 70% of those sat on the **first line** of the function. In 69% of those cases the model had ranked the missing `if` in its own top three predictions and skipped it anyway. So: for every function you write, look at its first line and ask what enters from outside. Null, empty, out-of-range, and wrong-type inputs crossing a trust boundary need a check. This is the opposite of the rule two sections down, and both are true. Guards belong at boundaries, not in the middle of typed code.

**Verify every third-party import.** Roughly one package reference in twenty from a current frontier model names a package that does not exist. Attackers register those names, a practice now called slopsquatting. Check every new dependency against the lockfile or the registry before you hand back code that imports it. Never introduce a dependency to solve a problem the standard library already solves.

**Do not claim the code is secure.** Model syntax pass rates rose from about 50% to 95% between 2023 and 2026 while security pass rates stayed flat at 45% to 55%. Cross-site scripting passes 15% of the time and log injection 13%. Model size barely moves it: 20B and 400B models cluster at the same 55%. In a controlled study, participants with an AI assistant wrote less secure code on nearly every task and were *more* confident it was secure. Treat four sites as unresolved until you have looked at them directly: HTML and template interpolation, SQL and shell and path construction, log lines, and anything else built by concatenating user input.

### Structure and shape

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

Same family: `obj?.prop` where `obj` is always defined, `value ?? fallback` where `value` is non-nullable, and a `default:` branch returning a placeholder from a switch already exhaustive over a union. A `default:` that asserts exhaustiveness (`const _never: never = value`) is doing real work; keep that one.

Read this rule together with the entry-point rule above. Delete the guard that cannot fire. Add the one at the door.

**Padding that looks like complexity.** In a matched comparison of 19,816 generated files against 36,467 human files in the same repositories, languages, and size bands, generated functions averaged 8.20 statements against 5.59, and 35% deeper maximum nesting, while cyclomatic complexity was almost identical (2.62 against 2.47). The extra bulk carries no extra logic. When a function is long and deeply nested but its branching is simple, the structure is padding: flatten to guard clauses, drop unreachable branches, and inline variables used once.

**Extract on the third occurrence, not the second, and never in anticipation.** Two similar blocks are cheaper than one abstraction with a boolean parameter, and the second occurrence is where you find out whether the similarity was real. Duplication is far cheaper than the wrong abstraction. If an existing helper is being kept alive by added flags and conditionals, inline it back into its callers, delete the conditionals, and re-extract from what is actually there.

A wrapper that forwards its arguments to one function is not an abstraction. Neither is a constant used once three lines below its declaration, a `types.ts` holding a single interface, or an `index.ts` re-exporting two modules.

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

**Compatibility shims for code with no other callers.** Keeping the old function as a deprecated alias, accepting both the old and new argument shapes, adding a flag to switch between old and new behavior. Check whether anything else calls it. In a repository you can see all of, if the answer is no, delete the old path. Published APIs are the exception, and there the deprecation belongs in a release note.

**Reimplementations of things that already exist.** Hand-rolled `debounce`, `clamp`, `deepClone`, `formatDate`, `uuid`, and `groupBy` show up constantly. Check the standard library, the framework, and the project's own utilities first. Searching the codebase for the concept takes less time than the function does.

**Names that repeat their own type.** `Data`, `Info`, `Object`, `Response`, `Manager`, and `Helper` inside a name usually restate what the type declaration already says. Cut the redundancy, not the meaning. Shortening is not the goal: in a study of 88 developers, descriptive compound names let readers locate a semantic defect about 14% faster than shorter, less descriptive ones. Single letters and clipped abbreviations are the worse failure.

| Generated | Better | Why |
| --- | --- | --- |
| `userDataResponseObject` | `profile` | `Data`, `Response`, `Object` all restate the type |
| `handleButtonClickEvent` | `onSubmit` | names the mechanism, not the intent |
| `isUserAuthenticatedAndActive` | `canPost` | names the check, not the answer |
| `processData`, `doWork` | `parseUri`, `mergePrefs` | says nothing |
| `d`, `res`, `tmp` | `records`, `parsed`, `record` | too short is worse than too long |

The one long name worth suspecting is the compressed comment: a single-caller helper called something like `isLeastRelevantMultipleOfLargerPrimeFactor`. That is a sentence forced into an identifier. Inline it and write the sentence.

**Error messages that only restate the function name.** An error is read once, in production, by someone who cannot reproduce it. Carry the operation and the input.

```ts
// Before
throw new Error('Failed to fetch user data');

// After
throw new Error(`getProfile(${did}) failed: ${res.status} ${res.statusText}`);
```

**Type escape hatches used to silence a checker.** `as unknown as Foo`, `@ts-ignore`, `any` on a value whose shape is known, a non-null `!` added because the build complained. Each converts a compile-time error into a runtime one. Fix the type or narrow the value. If a cast is genuinely unavoidable, the comment above it explains what guarantees it.

**Tests that assert the mock.** Mocking a module and then checking it returns what the mock was told to return tests nothing. Neither does asserting a component rendered, or that the framework works. Name the case, not the aspiration: `it('should work correctly')` becomes `it('returns null for an at:// URI with no rkey')`.

**One kind of change at a time.** Behavior changes and structure changes are separate commits. Never both at once. Beyond correctness, this is about whether anyone reads the result: 100 lines is a reasonable change to review and 1000 is usually too large, and 61% of AI-authored pull requests in one survey of 33,596 drew no review activity at all. A diff nobody reads has not been reviewed, whatever its checkmarks say.

**Leftovers.** Remove debug logging you added for yourself, commented-out code, unreachable branches, unused imports and variables, parameters kept "for extensibility", and `TODO` comments with no owner and no issue number. Then read the diff for lines that are not the change: reordered imports, changed quote style, added trailing commas, a function you reformatted in passing.

## Comments

A comment earns its place by holding information the code cannot hold. Delete the rest because it is noise, not because it will rot. Comments largely do get updated alongside the code they sit on: in a study of three large projects, 97% of comment changes happened in the same revision as the code change. What stale comments mostly are is uninteresting, not misleading.

Do not justify cutting comments with the claim that generated code is over-commented. It is not. Matched-file comparison puts comment density at 18.01% for AI files against 17.96% for human files, which is the same number. The problem is what the comments say.

The one rule the two loudest authorities on this subject agreed on, after agreeing on nothing else: **implementation code needs a comment only when the code is nonobvious.**

Delete outright:

- Narration. `// Loop through the users` above a `for` loop, `// Set loading to false`, `// Return the result`.
- Banner dividers. `// ===== HELPERS =====`, boxed ASCII headers, file-top blocks listing the file's own contents.
- Changelog notes. `// Updated to use the new API`, `// NEW:`, `// was: getUser(id)`. Version control holds this, with dates and authorship.
- Comments addressed to the reviewer rather than the reader. `// As requested, this now handles the empty case`.
- Self-assessment. `// This is a bit hacky but it works`, `// Note: may need revisiting`. If it needs revisiting, say what would trigger that.
- Emoji.

Interface documentation is the exception to "fewer comments", and the place generated code is genuinely thin. `@param userId The user ID` is worthless. `@param timeout Milliseconds; null disables the timeout` is the most valuable comment class there is, because units, null semantics, boundaries, and ownership cannot be read off a type. Write those. The matching prohibition: interface docs describe the contract, never the implementation.

Otherwise, write comments that record:

- Why the obvious approach fails. The most valuable kind, and almost the only one worth adding unprompted.
- Units, ranges, and encodings. `// milliseconds`, `// 0 to 1, not a percentage`, `// base32, lowercase`.
- The upstream bug or spec being worked around, with a link.
- An invariant the caller must maintain that the type system cannot enforce.
- Where a magic value came from.

```ts
// Before
// Retry up to 3 times
const MAX_RETRIES = 3;

// After
// The upstream rate limiter uses a 5s window and returns 429 without a
// Retry-After header, so three spaced attempts cover one full window.
const MAX_RETRIES = 3;
```

The test: delete the comment and reread the code. If nothing was lost, it was narration.

## Prose and UI copy

### What is actually measured

Word substitution is the shallow half of this, and the popular tells are not the measured ones. These four are:

**Verbosity and thin punctuation.** A comparison of 55,940 sentences and 1.2 million words across professional journalism, four models rewriting it, and novels from 1950 to 2022 concluded that the clearest signals of machine text are verbosity and *light* use of punctuation. Models write longer sentences with fewer commas, semicolons, and parentheses than human writers. Cutting punctuation moves your text toward the machine distribution, not away from it. Cut words instead.

**Trailing participial clauses.** The single most measured construction. Of the excess style words that appeared in scientific abstracts after 2022, 66% were verbs and participles, a break from every prior year. The shape is a sentence that ends by tacking on an `-ing` clause commenting on itself: "...reducing latency and improving reliability", "...highlighting the need for further work", "...ensuring consistency across environments". Cut the clause or promote it to its own sentence with a subject.

**Three-item parallel constructions.** Measured at 7.13 per document in model text against 3.73 for human experts, replicated across four models. This is the strongest measured signal in this section. "Fast, simple, and reliable." "Built for developers, teams, and enterprises." Three items appear because three sounds complete, not because there are three. Two real items beat three where the third is filler.

The exception worth stating: a negative triad like "No accounts. No tracking. Just links." is filler when the items are vibes and good copy when each is a checkable claim about the product. The pattern is not the problem. Padding it is.

**Avoiding the plain verb.** "Serves as", "stands as", "functions as", "represents", "boasts", "features", "offers", and "holds the distinction of being" where "is" or "has" would do. This shows up as a named category in editorial cleanup catalogs and independently in the measured excess-word lists.

Vocabulary, ranked by how strongly each is measured rather than alphabetically. The top of this list is drawn from a corpus study of 15 million abstracts, where "delves" appeared at 28 times its pre-2022 rate:

| Tier | Words |
| --- | --- |
| Measured excess | delve, underscore, showcase, pivotal, intricate, meticulous, realm, seamless, bolster, garner, encompass, notably, comprehensive |
| Marketing register | leverage, utilize, empower, unlock, harness, elevate, streamline, revolutionize, supercharge, cutting-edge, world-class, best-in-class, effortless, game-changing |
| Placeholder intensifiers | significantly, dramatically, extremely, truly, incredibly, remarkably, vastly |
| Filler transitions | Furthermore, Moreover, Additionally, That being said, In conclusion, Overall, Ultimately |
| Empty nouns | landscape, tapestry, testament, journey, ecosystem (when it just means "set of things") |

Intensifiers are the useful case, because the fix generalizes. "Significantly faster" is a placeholder for a measurement. Put the measurement in, or drop the claim.

### Constructions

**Antithesis as a default sentence shape.** "It's not just faster, it's smarter." "This isn't about tooling, it's about trust." The construction promises a distinction and delivers an adjective. State the thing.

**Openers that delay the fact.** "In today's fast-paced world", "It's worth noting that", "At its core", "When it comes to", "Let's dive in", "Whether you're a hobbyist or a professional". Start on the fact.

**The closing restatement.** A final paragraph summarizing the three above it. Readers who got that far already have it.

**Stacked hedges.** "This may potentially help to reduce the number of cases where errors might occur." Either it does something or it does not.

**Every bullet as bold lead plus sentence.** A list where all twelve entries are `**Term.** One sentence.` reads as a filled template. Use it where the bolded phrase is a real label being defined; write plain sentences otherwise.

**Headings that ask instead of tell.** "Why does this matter?" as a heading makes the reader open the section to find out. Put the answer in the heading, front-loaded, so the page still makes sense read as headings alone. This is a scanning rule, not a machine tell: measured across human and model writing, people use rhetorical questions more than twice as often as models do, so one inside running prose is fine. Stripping them makes prose sound more generated, not less.

**Em dashes doing emphasis the sentence did not earn.** The popular claim that this character marks machine text does not survive measurement. In the 1.2-million-word comparison above, only one of four models used em dashes more often than professional human writers, and one used them less than any human corpus tested. Expert annotators who identify machine text reliably treat dashes as a *human* signal. Two narrow things are still worth fixing: unspace them, since a spaced " — " is a formatting default rather than typography, and cut the one propping up a parallelism the sentence never earned, which is the antithesis rule wearing punctuation. More than one per paragraph, or one standing where a comma or full stop would do, means the sentence was never given a structure. Fix the sentence, not the character. If your project bans the character as house style, follow the project; just do not justify the ban with the detection claim.

### Residue

Two categories that reach production more often than any of the above, because they are invisible to a spellcheck and obvious to a reader.

Assistant conversation leaking into the artifact: "Certainly!", "I hope this helps", "You're absolutely right", "Let me know if you'd like...", "Here's a detailed breakdown of...", "Would you like me to...". None of this belongs in a file, a commit, a comment, or a page.

Unfilled template brackets shipping as content: `[Insert company name]`, `[Your Name]`, `{{description}}`, `Lorem ipsum`, `href="#"`, a `TODO` inside user-facing copy. Search for `[`, `{{`, and `TODO` in anything you are about to hand over.

### Interface copy

Error messages say what failed and what the reader can do, so "Oops! Something went wrong" becomes "Could not reach the server. Check your connection and try again." Buttons name their action, so "Get Started" becomes "Create an account". Cut "simply", "just", and "easily" from instructions, since they only tell a stuck user they should not be stuck. Match the product's existing capitalization rather than introducing Title Case. Drop exclamation marks.

Emoji have a specific reason to stay out beyond taste: shown the *same* emoji rendering, people disagreed about whether its sentiment was positive, neutral, or negative 25% of the time, and disagreement widened across platform renderings. Screen readers also announce the full Unicode name, so a decorative sparkle becomes spoken words in the middle of a sentence.

## Visual design

### The default accent

The best-documented AI visual default, and the one a vendor already patched at the prompt layer. Tailwind UI put `bg-indigo-500` on every button years ago; its author publicly apologized in 2025 for "leading to every AI generated UI on earth also being indigo"; and the v0 system prompt carries the line "v0 DOES NOT use indigo or blue colors unless specified in the prompt."

Grep for `indigo-`, `violet-`, `purple-`, `#6366f1`, `#4f46e5`, `#8b5cf6`, `#7c3aed`, `#a855f7`, and any gradient whose two stops are adjacent hues on the blue-to-purple arc. If the project has no brand reason for that hue, it is a default. Use the semantic token (`bg-primary`) rather than the palette class, so the color is changeable in one place.

Do not blame the component library: shadcn/ui's default primary is `oklch(0.205 0 0)`, zero chroma, and every base color it ships is achromatic. Purple on a shadcn project means someone wrote `bg-indigo-500` instead of `bg-primary`.

### Contrast, measured

Low-contrast text is the most common accessibility failure on the web by a wide margin, found on 83.9% of a million home pages scanned in 2026, ahead of missing alt text at 53.1%. Generated interfaces land in it by reflex, because muted grey on white looks calm in a screenshot.

The thresholds are fixed: **4.5:1** for body text, **3:1** for text at 24px or larger (or 18.5px bold), and **3:1** for the boundary of any interactive component and for meaningful graphics. Against white, the common Tailwind greys measure:

| Token | Hex | Ratio on white | Verdict |
| --- | --- | --- | --- |
| `gray-300` | `#d1d5db` | 1.47:1 | fails everything |
| `gray-400` | `#9ca3af` | 2.54:1 | fails body text |
| `gray-500` | `#6b7280` | 4.83:1 | passes on white, **fails at 4.39:1 on a `#f3f4f6` card** |
| `gray-600` | `#4b5563` | 7.56:1 | passes AAA |

`gray-400` for secondary text and `gray-500` on a tinted card are the two most common ways generated UI fails. Chrome's default placeholder color measures 2.35:1 and fails outright.

Treat `backdrop-filter: blur()` under any body text as a defect until checked. Contrast has to hold against the darkest and lightest pixel that can appear behind the panel, not the average, and a blur under about 25px does not neutralize a busy background. Either commit to a heavy blur over a solid tint or drop the effect. The same check applies to gradient-clipped headings and to white text over a photograph.

### Typography

The small uppercase letterspaced label above a heading, the eyebrow or kicker, is worth examining but not on typographic grounds. Letterspacing on caps is *correct*: the rule is 5% to 12% extra tracking with caps and none with lowercase, so `uppercase tracking-widest` is good typography, and removing the tracking makes it worse. The defect is semantic. Delete the eyebrow when it carries no information the heading does not already carry, which is what `FEATURES` above a features heading does, and never apply the same eyebrow treatment to every section on a page. Keep it where it locates the reader in a real taxonomy.

Other defaults to reverse: Title Case headings in a product that uses sentence case, an added webfont when the project already has one, `font-bold` everywhere a weight step or color change would do, and centered alignment on paragraphs longer than a line or two.

Two measurable floors. Line length belongs between 45 and 90 characters; WCAG caps it at 80 for the AAA criterion and also requires line spacing of at least 1.5 within paragraphs. Interactive targets need at least **24 by 24 CSS pixels** to meet AA, and 44 by 44 for AAA. Generated icon buttons routinely ship at 16px.

Do not use a placeholder as a label. The text disappears on focus, which strains short-term memory, defeats proofreading, forces users to clear the field to reread the hint, and makes filled-looking fields get skipped. Label the field.

### Layout and components

Wrapping every block in a rounded, shadowed, bordered card is the most common structural tell, and it flattens hierarchy: when everything is elevated, nothing is. Related: nested rounded corners with unrelated radii, `shadow-lg` on static content, and pill badges scattered for texture.

The generic marketing page assembles itself the same way every time. Centered hero, subheadline, a primary button beside a ghost "Learn more", then exactly three feature cards, each with an icon in a rounded square above a bold title and two lines of description, over blurred gradient blobs or a faint dot grid. If the brief did not ask for a landing page, do not build one.

Also worth reversing: emoji standing in for an icon set, `transition-all duration-300 hover:scale-105` on every interactive element, entrance animations on content already on screen, skeleton loaders in front of operations that complete instantly, and a toast for every state change.

One measured caution about the first thing you produce. Given the same brief, generated designs cluster tighter than human ones on every axis measured, and observers noticed the sameness within half an hour. Your first layout is the centroid of the training distribution. Treat it as a draft to move away from, not a starting point to polish.

### Fabricated content

This is a legal exposure, not a taste question. Since 2024, US federal rule 16 CFR Part 465 prohibits testimonials that misrepresent themselves as coming from someone who does not exist, explicitly including AI-generated fake reviews, with civil penalties available per violation.

Do not invent testimonials, customer names, company logos, star ratings, user counts, uptime figures, or "Trusted by 10,000+ teams" banners. Do not generate faces for people who do not exist. If a layout needs a testimonial slot, fill it with text that is obviously unusable and say so when you hand it over. The same holds for benchmark numbers, pricing, and any figure in an interface: if you did not measure it or read it from real data, it does not go on the screen.

### What to do instead

Read the project's tokens, its existing components, and two or three screens it already ships, then build from those. When there is no design system, stay plain: one accent color, one border radius, one shadow level, the system font stack, and the spacing scale you started with. Plain and consistent survives review. Decorated and defaulted does not.

## Files, commits, and pull requests

Do not create summary documents. `IMPLEMENTATION_NOTES.md`, `SUMMARY.md`, `CHANGES.md`, `MIGRATION_GUIDE.md`, and a "Recent updates" section appended to the README are artifacts of your process rather than the project's needs. The diff is the record. Write documentation when someone asks for it, or when a real user of the project needs it.

Commit subjects state what changed, in the format the repository already uses; read `git log` before writing the first one. Skip the enumerated file list, the emoji prefix the project does not use, and phrasings like "Enhanced the parser to provide improved handling of edge cases" that describe an improvement without naming it. A pull request body says what changed and what you verified, not your reasoning trace or an implementation-phase breakdown.

Clean the working tree: scratch scripts, `.bak` and `.orig` files, one-off harnesses at the repository root, and screenshots taken while working do not belong in the commit.

## What to say when you hand it back

The largest measured gap in AI-assisted work is not in the diff. It is between what was verified and what gets claimed.

In a randomized trial, experienced developers using AI on real tasks in repositories they knew well were **19% slower**, and afterward still believed they had been sped up by 20%. Scope that result honestly, since it covers 16 developers on mature codebases with early-2025 tools and the same researchers now report conflicting figures. But the direction of the error is the point: the feeling of speed is not evidence of speed, and it is not evidence of correctness either.

So, in the handback message:

- Say what you ran and what it printed. A check you did not run is not a check that passed.
- Name what you did not verify. Untested paths, unverified integrations, figures that are placeholders.
- Do not claim performance, security, or correctness improvements you did not measure.
- Do not describe the work as fast, clean, comprehensive, or production-ready. Describe what it does.

The developer frustration reported most often with AI output, by 66% of 49,000 survey respondents, is code that is "almost right, but not quite". Almost-right code that arrives with a confident summary costs more than code that arrives with an honest list of gaps.

## The pass before you hand it back

Ordered by what it costs to get wrong, not by what is easiest to check.

**Ships broken or unsafe:**

1. Every new third-party import: does the package exist? Check the lockfile or registry.
2. Every new function's first line: what enters from outside, and is it checked? Most missing-validation defects live here.
3. Every place user input reaches HTML, SQL, a shell, a path, or a log line.
4. Every number, name, logo, quote, and rating in the interface: is it real? Remove anything invented.
5. Every text and control color: does it clear 4.5:1, or 3:1 for large text and component boundaries?

**Costs a reviewer their time:**

6. Read the diff top to bottom. Delete every line that is not the change you were asked to make.
7. Behavior and structure in the same commit? Split them.
8. Each new function, constant, type, or file: count the call sites. One means inline it.
9. Each comment you added: delete it mentally and reread the code. If nothing was lost, delete it for real. Then check the reverse: does any exported function lack its units, null semantics, or ownership note?
10. Each guard: at a boundary, keep it; inside typed code where the state cannot occur, cut it.
11. Colors, radii, fonts, spacing: from the project's tokens?

**Reads as generated:**

12. Sentences ending in a trailing `-ing` clause, three-item lists where the third is filler, "not just X but Y", and the measured excess vocabulary.
13. Assistant chatter, unfilled brackets, `Lorem ipsum`, `href="#"`.
14. Cut words, not punctuation. Thin punctuation is itself a signal.

15. Read the prose aloud. Any phrase you would not say to a colleague gets rewritten.

The test that covers all fifteen: could a specific person have written this, for this specific project, having made each of these choices on purpose? If anyone could have produced it for anything, it is not finished.

## Sources

Rules above are grounded in these. Where a claim is contested, the document says so rather than picking the convenient side.

- **Robustness.** "Enhancing the Robustness of LLM-Generated Code", arXiv:2503.20197. 230 tasks, four models; 43.1% less robust than human counterparts, 90% of defects missing checks, 70% on the first line.
- **Structure and comments.** "A Large-Scale Empirical Study of AI-Generated Code in Real-World Repositories", arXiv:2603.27130. Matched 19,816 AI files against 36,467 human files: 8.20 vs 5.59 statements, near-identical cyclomatic complexity, comment ratio 18.01% vs 17.96%, and *lower* duplication in AI files.
- **Security.** Veracode GenAI Code Security, 2025 and Spring 2026. Syntax rose from 50% to 95%, security flat at 45-55%. Perry, Srivastava, Kumar & Boneh, ACM CCS 2023 (arXiv:2211.03622): assisted participants wrote less secure code and were more confident in it.
- **Hallucinated packages.** Spracklen et al., USENIX Security 2025 (arXiv:2406.10279): 205,474 unique fake package names across 576,000 samples. Frontier re-evaluation arXiv:2605.17062: 4.62-6.10%. Do not quote the older 21.7% figure.
- **Comments.** Fluri, Würsch & Gall, WCRE 2007: 97% of comment changes land in the same revision as the code. John Ousterhout, *A Philosophy of Software Design* and the Ousterhout/Martin discussion at github.com/johnousterhout/aposd-vs-clean-code, source of the "nonobvious" rule.
- **Abstraction.** Don Roberts' Rule of Three via Fowler, *Refactoring*. Sandi Metz, "The Wrong Abstraction" (2016).
- **Naming.** Schankin et al., ICPC 2018. 88 developers; descriptive compound names located defects ~14% faster.
- **Diff size and change type.** Kent Beck, *Tidy First?* Google eng-practices, "Small CLs". "These Aren't the Reviews You're Looking For", arXiv:2605.02273: 61.38% of 33,596 AI-authored PRs drew no review.
- **Excess vocabulary.** Kobak, González-Márquez, Horvát & Lause, *Science Advances* 11(27), 2025. 15M+ PubMed abstracts; 66% of 2024 excess style words were verbs; "delves" at 28x its prior rate.
- **Tricolons, rhetorical questions.** arXiv:2604.19768. 225 documents, four models: three-item constructions 7.13 vs 3.73 per document; rhetorical questions 2.28 for models vs 5.55 for human experts.
- **Verbosity and punctuation, em dashes.** The Economist, "How to spot AI writing", 30 July 2026. 55,940 sentences, 1.2M words. Russell, Karpinska & Iyyer, ACL 2025: expert annotators treat dashes as a human marker.
- **Detectors.** Liang et al., *Patterns* 4(7), 2023: 61.3% average false-positive rate on TOEFL essays by non-native writers.
- **Contrast and accessibility.** WebAIM Million 2026: 83.9% of home pages have low-contrast text. W3C WCAG SC 1.4.3, 1.4.11, 1.4.8, 2.5.5, 2.5.8. NN/g, "Glassmorphism" (2024) and "Placeholders in Form Fields Are Harmful" (2014).
- **Typography.** Matthew Butterick, *Practical Typography*: 5-12% letterspacing on caps, 45-90 character line length.
- **The indigo default.** Adam Wathan, August 2025. The leaked v0 system prompt. shadcn/ui default primary `oklch(0.205 0 0)`.
- **Design convergence.** Chen et al., arXiv:2502.05870: 96 generated designs vs 105 award winners, tighter clustering on every measured axis.
- **Fabricated reviews.** FTC final rule, 16 CFR Part 465 (2024).
- **Self-assessment.** Becker, Rush, Barnes & Rein, arXiv:2507.09089 (METR): 19% slower, believed 20% faster. See METR's February 2026 update for the walk-back. 2025 Stack Overflow Developer Survey, 49,000+ respondents: 66% cite "almost right, but not quite".

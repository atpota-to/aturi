# CLEANER.md

Instructions for coding agents on removing AI defaults from code, comments, copy, and interface design.

An AI tell is rarely a style violation on its own. It is evidence that a choice was defaulted instead of made: a comment that narrates because nobody decided what was worth explaining, an indigo button because nobody picked a color, a package import nobody checked, a grey nobody measured. Cleaning up means going back and making the decision.

Every rule here is either measured or attributed. Where a popular belief turned out to be folklore, this document says so rather than repeating it. Where a rule in an earlier draft was tested and failed, that is said too. Sources are listed at the end.

This file is project-agnostic. The project you are working in outranks it. If a codebase puts JSDoc on every export, keep writing JSDoc. If its section labels are uppercase, keep them uppercase. Read the surrounding file first and match it. What follows is what to do when nothing local tells you otherwise.

## What to clean, and what to leave alone

Clean the output you just produced: the diff you are about to hand back, the copy you just wrote, the screen you just built.

Do not open files you were not asked to touch in order to fix their comments. Do not reformat neighboring code. A cleanup that turns a 40-line feature into a 900-line diff has made the review harder, which is the opposite of the goal.

**Cleaning must not remove capability.** This is the failure mode of every rule below, and it is invisible in review: a deleted feature produces no defect to find and no tell to flag, so it reads as tidiness. When this document was tested, agents applying an earlier draft silently dropped a dark-mode palette, an annual pricing option, and a per-request timeout. The timeout was the worst of the three, because removing it left a retry module that hangs forever on a stalled connection, which is the exact failure it existed to handle. The next draft carried that warning as prose and deleted two of the three again. So it is a procedure now rather than a caution.

Before you change anything you were handed, write down what it already does: every option, every callback, every timeout and limit, every cleanup and invalidation path, every dependency a caller can substitute, every mode it responds to. That list is the floor. You may improve how any item on it is expressed. You may not hand back fewer of them, and "the brief did not emphasize it" is not a reason. When you hand back, account for each item as kept, replaced by something you name, or dropped for a stated reason. An item you cannot account for was not a decision.

Austerity is not taste. On this document's own test set, the draft that produced the smallest output had the worst defect rate per kilobyte, 1.77 against 1.15 for work produced with no document at all. It scored well because there was less to inspect, not because less was wrong. Size is not the variable you are moving.

**A cut is legitimate when the reader loses no fact and no option.** Delete the thing, then ask what someone can no longer do. If the answer is nothing, it was filler. If the answer is that they no longer know the size limit, or that the interface now says nothing when half the batch fails, you cut substance and called it editing. Rewriting nine words into four is editing. Deleting the nine words is not. When a line resists tightening, that usually means it is carrying something, and the fix is a better line rather than no line.

**These are editorial rules, not detection evasion.** The goal is work that is correct, specific, and decided, not text that scores well on a detector. Commercial detectors misclassified TOEFL essays by non-native English writers as machine-written at an average false-positive rate of 61.3%, while being near-perfect on US eighth-grade essays. Writing to beat one penalizes plain vocabulary and adds nothing a reader wants.

Five things this document is not asking for:

- Not zero comments. Fewer comments, each carrying something the code cannot. Under an earlier draft, agents wrote zero comments on modules that needed them. That is a failure, not compliance.
- Not less defensive code. Generated code is measurably *under*-defended at its edges and over-defended in its middle. Cut guards against states the type system already rules out; add the validation at the entry point that was skipped.
- Not shorter names. Descriptive names are measurably faster to read.
- Not a banned-word filter. Removing "leverage" from a paragraph that still says nothing produces the same emptiness with a smaller vocabulary.
- Not a house style that overrides the project's. When this document and the codebase disagree, the codebase wins.

**The numbers here are floors or observations, and none of them is a score.** The floors are 4.5:1 and 3:1 for contrast, 24 by 24 pixels for a target, 45 to 90 characters for a line. Clear them. The observations describe where reasonable work already lands: comment density near 18%, statement counts near 5.6 per function, three-item constructions near 3.7 per document. Moving a ratio toward one of those numbers improves nothing on its own. If you are adding a comment to raise a density or deleting one to lower it, you have started editing the measurement instead of the work. The size of what you hand back is not a score either. In testing it tracked the judges' machine-tell scores closely enough to be worth naming as a trap: the shortest output scored best and was the worst work per unit.

## Code

### Correctness before tidiness

This section comes first because the measured failures of generated code are correctness failures, and the rest of this document is about tidiness. Do not tidy code you have not checked.

**Validate at the entry point.** Across 230 Java tasks and four code models, 43.1% of generated code was less robust than its human counterpart. Of the robustness defects analyzed, 90% were missing conditional checks, and 70% of those sat on the **first line** of the function. In 69% of those cases the model had ranked the missing `if` in its own top three predictions and skipped it anyway.

So: for every function you write, look at its first line and ask what enters from outside. There are three doors, not one. Arguments from callers you do not control. Deserialized payloads, which is the door everyone misses, because a response body annotated with your domain type crossed a trust boundary and was never checked, and `const doc: Doc = await res.json()` is a cast wearing a type annotation. Environment and configuration read at startup. Null, empty, out-of-range and wrong-type values through any of the three need a check, and that check is one line each, not four. A value your own typed code hands to itself is not crossing a boundary. Guards belong at doors, not in the middle of typed code.

**Verify every third-party import.** Roughly one package reference in twenty from a current frontier model names a package that does not exist. Attackers register those names, a practice now called slopsquatting. Check every new dependency against the lockfile or the registry before you hand back code that imports it. Never introduce a dependency to solve a problem the standard library already solves.

**Do not claim the code is secure.** Model syntax pass rates rose from about 50% to 95% between 2023 and 2026 while security pass rates stayed flat at 45% to 55%. Cross-site scripting passes 15% of the time and log injection 13%. Model size barely moves it: 20B and 400B models cluster at the same 55%. In a controlled study, participants with an AI assistant wrote less secure code on nearly every task and were *more* confident it was secure.

Treat these as unresolved until you have looked at them directly: HTML and template interpolation; SQL, shell, filesystem paths, and URLs you build by interpolation; log lines and error messages. The last two are where generated code lands. An identifier dropped into a URL path can carry a separator and address a route you did not mean, so validate its shape where it enters and interpolate the validated value. Server-supplied text put into a log line or an error message can carry newlines and forge entries, so collapse whitespace before you include it.

### Structure and shape

**Guards against impossible states.** Defensive scaffolding accumulates around values that were never in doubt. A non-optional parameter does not need a null check, an array typed as an array does not need `Array.isArray`, and `.length` does not throw. Same family: `obj?.prop` where `obj` is always defined, `value ?? fallback` where `value` is non-nullable, and a `default:` branch returning a placeholder from a switch already exhaustive over a union. A `default:` that asserts exhaustiveness (`const _never: never = value`) is doing real work; keep that one.

Read this rule together with the entry-point rule above. Delete the guard that cannot fire. Add the one at the door.

**Runtime controls are not defensive scaffolding.** A timeout, a retry ceiling, a backoff, a cache eviction, a size or rate cap, a cancellation path, a pagination bound: these are behavior, and they sit next to the guards above while being their opposite. A guard rules out a state the type system already rules out. A control bounds a resource that nothing else bounds. Cutting one gives you code that is shorter, reviews clean, and hangs in production, which is what happened when an earlier draft of this file removed a per-attempt timeout from inside a retry loop and left four attempts that never run. After every edit, name the thing that bounds each wait, each collection, and each queue. If you cannot name it, you deleted it.

Two more questions belong to anything that crosses a process boundary. If a retry can send the same request twice, say whether twice is safe, and if you cannot know, do not retry it. And name the one dependency a test has to replace, then let an argument replace it, because a module you can only test by patching a global does not get tested.

**Padding that looks like complexity.** In a matched comparison of 19,816 generated files against 36,467 human files in the same repositories, languages, and size bands, generated functions averaged 8.20 statements against 5.59, and 35% deeper maximum nesting, while cyclomatic complexity was almost identical (2.62 against 2.47). The extra bulk carries no extra logic. When a function is long and deeply nested but its branching is simple, the structure is padding: flatten to guard clauses, drop unreachable branches, and inline variables used once.

**Extract on the third occurrence, not the second, and never in anticipation.** Two similar blocks are cheaper than one abstraction with a boolean parameter, and the second occurrence is where you find out whether the similarity was real. Duplication is far cheaper than the wrong abstraction. If an existing helper is being kept alive by added flags and conditionals, inline it back into its callers, delete the conditionals, and re-extract from what is actually there.

A wrapper that forwards its arguments to one function is not an abstraction. `getUserDisplayName(user)` returning `formatDisplayName(user.name, user.handle)` is ``user.name || `@${user.handle}` `` wearing two names. Neither is a constant used once three lines below its declaration, a `types.ts` holding a single interface, or an `index.ts` re-exporting two modules.

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
throw new Error(`getProfile(${userId}) failed: ${res.status} ${res.statusText}`);
```

**Type escape hatches used to silence a checker.** `as unknown as Foo`, `@ts-ignore`, `any` on a value whose shape is known, a non-null `!` added because the build complained. Each converts a compile-time error into a runtime one. Fix the type or narrow the value. If a cast is genuinely unavoidable, the comment above it explains what guarantees it.

**Tests that assert the mock.** Mocking a module and then checking it returns what the mock was told to return tests nothing. Neither does asserting a component rendered, or that the framework works. Name the case, not the aspiration: `it('should work correctly')` becomes `it('returns null when the range has no end date')`.

**One kind of change at a time.** Behavior changes and structure changes are separate commits. When the handback is a file rather than a commit, this rule is about what you report, not what you split. Beyond correctness, this is about whether anyone reads the result: 100 lines is a reasonable change to review and 1000 is usually too large, and 61% of AI-authored pull requests in one survey of 33,596 drew no review activity at all.

**Leftovers.** Remove debug logging you added for yourself, commented-out code, unreachable branches, unused imports and variables, parameters kept "for extensibility", and `TODO` comments with no owner and no issue number. Then read the diff for lines that are not the change: reordered imports, changed quote style, added trailing commas, a function you reformatted in passing.

## Comments

A comment earns its place by holding information the code cannot hold. Delete the rest because it is noise, not because it will rot. Comments largely do get updated alongside the code they sit on: in a study of three large projects, 97% of comment changes happened in the same revision as the code change. What stale comments mostly are is uninteresting, not misleading.

Matched-file comparison puts comment density at 18.01% for AI files against 17.96% for human files, so volume is not the problem and cutting to hit a lower number fixes nothing. What the comments say is the problem.

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

One calibration, because this section overcorrects in both directions. An earlier draft produced zero comments on a module with a non-obvious contract and a five-minute staleness window nobody was told about. Its replacement produced a twenty-five line function carrying a ten-line interface block and three separate inline justifications. No whole-file ratio separates those two, and you cannot check a whole-file ratio while writing a function anyway. So count decisions, not lines.

The budget. Every exported symbol gets its interface doc, which is a floor rather than a ceiling. Every function body gets at most one comment, for the decision a careful reader could reasonably have made differently. A constant gets a comment when the value came from somewhere. Needing a second comment in one body means the body is doing two things, so split it or move the explanation to the commit message. Moving a justification into the interface doc does not spend less of the budget; it moves the words into the block this section exempts, which is how a forty-five line file reaches 86%.

## Prose and UI copy

### What is actually measured

Word substitution is the shallow half of this, and the popular tells are not the measured ones. These four are:

**Verbosity and thin punctuation.** A comparison of 55,940 sentences and 1.2 million words across professional journalism, four models rewriting it, and novels from 1950 to 2022 concluded that the clearest signals of machine text are verbosity and *light* use of punctuation. Models write longer sentences with fewer commas, semicolons, and parentheses than human writers. Cutting punctuation moves your text toward the machine distribution, not away from it. Cut words instead.

**Trailing participial clauses.** The single most measured construction. Of the excess style words that appeared in scientific abstracts after 2022, 66% were verbs and participles, a break from every prior year. The shape is a sentence that ends by tacking on an `-ing` clause commenting on itself: "...reducing latency and improving reliability", "...highlighting the need for further work". Cut the clause or promote it to its own sentence with a subject.

**Three-item parallel constructions.** Measured at 7.13 per document in model text against 3.73 for human experts, replicated across four models. The strongest measured signal in this section.

Fix the last item, not the count. When this was tested, agents satisfied the rule by adding a fourth item: "Filter by status code, provider, or error" became "Filter by provider, event type, status code, or a string in the payload", which is the same padding one item longer. Ask what the last item is doing. If it is there for closure, cut it and stop at two. If every item is a distinct thing the reader can use, keep them all, four included.

The exception worth stating: a negative triad like "No accounts. No tracking. Just links." is filler when the items are vibes and good copy when each is a checkable claim about the product.

**Avoiding the plain verb.** "Serves as", "stands as", "functions as", "represents", "boasts", "features", "offers", and "holds the distinction of being" where "is" or "has" would do.

Vocabulary, ranked by how strongly each group is measured. A corpus study of 15 million abstracts found "delves" at 28 times its pre-2022 rate, alongside underscore, showcase, pivotal, intricate, meticulous, realm, seamless, bolster, garner, encompass, notably, and comprehensive. Below that sit the marketing register (leverage, utilize, empower, unlock, harness, elevate, streamline, revolutionize, cutting-edge, world-class, effortless), the placeholder intensifiers (significantly, dramatically, extremely, truly, incredibly, remarkably, vastly), the filler transitions (Furthermore, Moreover, Additionally, That being said, In conclusion, Overall, Ultimately), and the empty nouns (landscape, tapestry, testament, journey, ecosystem when it just means "set of things"). Not one of these fired in testing, including in output written with no document at all, so run the list as a spellcheck and spend your attention on the constructions above and the formats below. Intensifiers are the case where the fix generalizes: "significantly faster" is a placeholder for a measurement. Put the measurement in, or drop the claim.

**Formats picked by reflex.** These reached the page more often in testing than any word on the list above. A horizontal rule between every section. Numbered headings in a document nobody will cite by number. An arrow inside a button label. A headline shaped as "Stop [verb]ing [noun]". A time-to-value claim you did not time, such as "in under five minutes". A list that ends by waving at everything it did not name, such as "and anything else that speaks HTTP". One unguided draft of a single landing page carried five of the six, and eleven horizontal rules disappeared between rounds with no rule instructing it, which is compliance with the theme of a cleanup document rather than with anything it said. Cut the rules, number nothing, name the destination on the button, and either time the claim or drop it.

### What to put in

**Say one thing the brief did not tell you.** Correct copy and copy a reader believes are different products, and the gap is domain knowledge. Every section of body copy should carry at least one fact that came from knowing the subject rather than from the brief: the failure people actually hit, the thing that breaks at the boundary, the workaround everyone writes and nobody mentions. On one webhook brief, a clean draft said "your verification code runs the same path it will in production." The better draft said that and then added: "No `if (env === 'development') return true` in the handler to hide a signature bug until launch week." Only someone who has shipped a webhook handler writes the second one, and that is why it reads as written by a person.

The line this must not cross: the world is yours to be specific about, the product is not. Say what the domain does, what breaks, what a user tries first, what the incident looks like. Do not say what the product costs, how fast it is, who uses it, or which vendors it works with unless you were told. One unsteered draft crossed that line three times on a single page, with a five-minute setup claim, a free tier, and four named integrations, none of them given. Reading the fabricated-content rules as a ban on specificity is the mistake to avoid. They ban invented facts about the product, not knowledge of the subject.

**Sentence length is a sequence, not an average.** Verbosity is one of the four measured signals above, and the shape it takes is a plateau: sentence after sentence at the same weight, because each was built to the same specification. Under an earlier draft of this document a landing page came back with sentences of 17, 12, 21, 18, 17, 17, 17, 17, 26, 15, 35, and 8 words. Five at exactly 17, and one under ten in the whole page. The unsteered draft of the same page ran 25, 7, 17, 6, 19, 9, 15, which is the shape of a writer making a claim and then landing it.

So count them. In each section, at least one sentence under eight words, and no three consecutive sentences within two words of each other. Put the thing you most want believed in the short one. Do not reach this by chopping: splitting a 22-word sentence into two 11-word sentences moves the average and keeps the plateau, and a page of six-word sentences is the same defect facing the other way. The variation has to come from some sentences genuinely carrying more than others.

### Constructions

**Antithesis as a default sentence shape.** "It's not just faster, it's smarter." "This isn't about tooling, it's about trust." The construction promises a distinction and delivers an adjective. State the thing.

**Openers that delay the fact.** "In today's fast-paced world", "It's worth noting that", "At its core", "When it comes to", "Let's dive in", "Whether you're a hobbyist or a professional". Start on the fact.

**The closing restatement.** A final paragraph summarizing the three above it. Readers who got that far already have it.

**Stacked hedges.** "This may potentially help to reduce the number of cases where errors might occur." Either it does something or it does not.

**Every bullet as bold lead plus sentence.** A list where all twelve entries are `**Term.** One sentence.` reads as a filled template. Use it where the bolded phrase is a real label being defined; write plain sentences otherwise.

**Headings that label instead of claim.** A heading that names its section leaves the reader no better off for having read it. "Replay on demand" and "Capture everything, lose nothing" are labels. "Signature checks still run" and "Bursts replay as bursts" are claims a reader can agree or disagree with, which is what makes a page worth scanning. Write each heading as a sentence you would defend, front-loaded, so the page still argues its case read as headings alone. The question form is the same defect with a question mark. This is a scanning rule, not a machine tell: measured across human and model writing, people use rhetorical questions more than twice as often as models do, so one inside running prose is fine. Stripping them makes prose sound more generated, not less.

**Em dashes doing emphasis the sentence did not earn.** The popular claim that this character marks machine text does not survive measurement, and expert annotators who identify machine text reliably treat dashes as a *human* signal. Two narrow things are still worth fixing: unspace them, since a spaced " — " is a formatting default rather than typography, and cut the one propping up a parallelism the sentence never earned, which is the antithesis rule wearing punctuation. Fix the sentence, not the character. If your project bans the character as house style, follow the project; just do not justify the ban with the detection claim.

### Residue

Assistant conversation leaking into the artifact: "Certainly!", "I hope this helps", "You're absolutely right", "Let me know if you'd like...", "Here's a detailed breakdown of...". None of this belongs in a file, a commit, a comment, or a page.

Unfilled template brackets shipping as content: `[Insert company name]`, `[Your Name]`, `{{description}}`, `Lorem ipsum`, `href="#"`, a `TODO` inside user-facing copy. Search for an opening bracket with nothing behind it, meaning a `[` whose closing bracket is not followed by `(` or `[`, plus `{{`, `Lorem ipsum`, and `TODO`. A markdown link is not a placeholder, and neither is an interpolation you documented in the same file. Under a bare grep for `[`, an agent handed back a page whose only two calls to action had been flattened from links into bold text, which is a worse defect than the `href="#"` this rule bans by name.

### Interface copy

Error messages say what failed and what the reader can do, so "Oops! Something went wrong" becomes "Could not reach the server. Check your connection and try again." Buttons name their action, so "Get Started" becomes "Create an account". Cut "simply", "just", and "easily" from instructions, since they only tell a stuck user they should not be stuck. Match the product's existing capitalization rather than introducing Title Case. Drop exclamation marks.

Emoji have a specific reason to stay out beyond taste: shown the *same* emoji rendering, people disagreed about whether its sentiment was positive, neutral, or negative 25% of the time, and disagreement widened across platform renderings. Screen readers also announce the full Unicode name, so a decorative sparkle becomes spoken words in the middle of a sentence.

**Numbers you were not given: parameterize them, then show them filled.** A copy deck needs concrete values to be readable and the brief almost never supplies them. Two failures follow. The first is writing the invented value into the strings. The second feels like honesty and is worse: one tested draft opened with "limits and formats shown here are placeholders for the real values" and then hardcoded 25 MB into eight strings below it, including the screen reader label and three error messages. The note satisfied the writer, and the wrong copy shipped anyway.

Do both halves. Put the value in a named token, give the tokens a table listing each one's source and format, and under each state show one line of what it renders as with a plausible value filled in.

> Message: `{fileName}` is `{fileSize}`. The limit is `{maxSize}` per file.
> Renders as: annual-review-2025.pdf is 41.2 MB. The limit is 25 MB per file.

The token keeps the copy correct when the limit changes. The rendered line is what lets anyone judge the truncation, the rhythm, and whether the sentence reads at all. A deck that is fully tokenized and never shown filled is the other failure, and it is why one otherwise correct draft read thinner than the one it replaced.

Capability disappears from copy as states rather than as words. Under an earlier draft a file upload deck lost five between versions: partial success where some files uploaded and some failed, the difference between a server error and a dropped connection, the scan-in-progress state, the screen reader label on the file input, and the difference between an empty list and a search that matched nothing. Every surviving string was better than its predecessor and the deck was shorter, and two drafts later three of the five have not come back. Nothing in review catches this, because a missing state has no bad sentence to point at. Before you hand back a deck, list the states the feature can enter and check each has a string. Then check the four that go missing most: the partial result, the slow but not failed state, what a screen reader hears, and empty versus filtered-to-nothing.

## Visual design

One pattern governs the specific defaults below. The things that get cut in a cleanup pass are the ones with no pixels. Between two test rounds the same pass removed four things from one 200-line page: the dark palette, the `@media (prefers-reduced-motion: reduce)` block, the `:active` state on the button, and `role="list"` on lists set to `list-style: none`, which is what stops Safari announcing them as lists. It kept the 120ms transition the reduced-motion block existed to guard. None of the four appears in a screenshot, so none appears in a review, so cutting them looks free. It is not free, and it is one bias rather than four accidents. Before you remove anything from a stylesheet or a template, name who it was for. `prefers-reduced-motion` is for a reader whose vestibular disorder turns your transition into a symptom. `role="list"` is for a reader hearing the page. If you can name the person, keep it. If you cannot, cut it and say so.

### The default accent

The best-documented AI visual default, and the one a vendor already patched at the prompt layer. Tailwind UI put `bg-indigo-500` on every button years ago; its author publicly apologized in 2025 for "leading to every AI generated UI on earth also being indigo"; and the v0 system prompt carries the line "v0 DOES NOT use indigo or blue colors unless specified in the prompt."

Grep for `indigo-`, `violet-`, `purple-`, `#6366f1`, `#4f46e5`, `#8b5cf6`, `#7c3aed`, `#a855f7`, and any gradient whose two stops are adjacent hues on the blue-to-purple arc. If the project has no brand reason for that hue, it is a default. Use the semantic token (`bg-primary`) rather than the palette class, so the color is changeable in one place.

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

Treat `backdrop-filter: blur()` under any body text as a defect until checked: contrast has to hold against the darkest and lightest pixel that can appear behind the panel, not the average, and a blur under about 25px does not neutralize a busy background. The same check applies to gradient-clipped headings and to white text over a photograph.

Two extensions to the table. The ratios above are against white, and a dark panel inside a light page needs its own measured set, because the muted grey that passed on the page will not pass on the panel and the accent that read as warm will read as mud. Name those tokens for the surface they belong to rather than the color they are. Second, a mark drawn as a `background-color` behind a CSS `mask` disappears in Windows High Contrast Mode, which repaints backgrounds and leaves a blank where your checkmark was, and the meaning of the list goes with it. Draw any mark that carries meaning with `border`, with `currentColor`, or with an `<svg>` that inherits color.

### Typography

Default to no eyebrow. The small uppercase letterspaced label above a heading is a semantic problem, not a typographic one, so apply it in that order. Delete the one that carries no information the heading does not already carry, which is what `FEATURES` above a features heading does, and never give every section on a page the same treatment. Keep one only where it names a field the reader is comparing across repeated units, the way `INCLUDED EVENTS` does above three different numbers in three columns, and where the columns stack on a narrow screen so the label has to repeat inside each block. If you keep one and it is set in caps, track it 5% to 12%, because caps at normal tracking are worse than no caps at all. Read that last clause as a repair instruction for a label you have already justified. Added on its own to an earlier draft, it brought uppercase labels straight back into output that had correctly dropped them.

Other defaults to reverse: Title Case headings in a product that uses sentence case, an added webfont when the project already has one, `font-bold` everywhere a weight step or color change would do, and centered alignment on paragraphs longer than a line or two.

Two measurable floors. Line length belongs between 45 and 90 characters; WCAG caps it at 80 for the AAA criterion and also requires line spacing of at least 1.5 within paragraphs. Interactive targets need at least **24 by 24 CSS pixels** to meet AA, and 44 by 44 for AAA. Generated icon buttons routinely ship at 16px.

Do not use a placeholder as a label. The text disappears on focus, which strains short-term memory, defeats proofreading, forces users to clear the field to reread the hint, and makes filled-looking fields get skipped. Label the field.

### Layout and components

Wrapping every block in a rounded, shadowed, bordered card is the most common structural tell, and it flattens hierarchy: when everything is elevated, nothing is. Related: nested rounded corners with unrelated radii, `shadow-lg` on static content, and pill badges scattered for texture.

**Repeated units are read across, not down.** Three pricing tiers side by side get compared price to price and limit to limit. If those facts do not land on the same line, the reader does the layout work you skipped. Two ways this goes wrong. The first is not aligning at all. The second is faking it: under an earlier draft an agent got the rows to line up with `min-height: 2.9em` and `min-height: 4.6em`, numbers tuned to the text that happened to be there and unset again at the first breakpoint. That is a guess with a unit on it. Put the structure in the grid instead, with `grid-template-rows: subgrid` on the repeated child or a row-per-fact grid on the container, so it holds when one tier's description runs two lines longer. Then decide what happens when the columns stack: a reader who can no longer scan across needs the field name repeated inside each block.

**Every control ships five states and every collection ships four.** For a control: rest, hover, `:focus-visible`, active, disabled. Hover alone is the generated default, and it is the one state a keyboard user and a touch user never see. Give focus an indicator that clears 3:1 against whatever sits behind it, including the dark panel. A disabled control says why, somewhere the reader can reach. For a list, a table, or any view fed by a request: populated, empty, loading, failed. The empty state is the first screen a new user sees and the one most often left as blank space. If you keep a transition, wrap it in `@media (prefers-reduced-motion: reduce)`.

**Operate the control, do not just style it.** One unguided round assembled a billing toggle from a single checkbox and two `<label for>` elements pointing at it, so clicking Annual while already on Annual switched the reader back to Monthly, and a screen reader announced the whole thing as one checkbox named "Monthly Annual Save 20%". It looked right in a screenshot. Anything built out of inputs, labels, and sibling selectors is a control: tab to it, operate it with the keyboard, and state its accessible name and its state when you hand it back. Two mutually exclusive options are radios, not a checkbox.

The generic marketing page assembles itself the same way every time. Centered hero, subheadline, a primary button beside a ghost "Learn more", then exactly three feature cards, each with an icon in a rounded square above a bold title and two lines of description, over blurred gradient blobs or a faint dot grid. If the brief did not ask for a landing page, do not build one.

Also worth reversing: emoji standing in for an icon set, `transition-all duration-300 hover:scale-105` on every interactive element, entrance animations on content already on screen, skeleton loaders in front of operations that complete instantly, and a toast for every state change.

One measured caution about the first thing you produce. Given the same brief, generated designs cluster tighter than human ones on every axis measured, and observers noticed the sameness within half an hour. Your first layout is the centroid. Do not answer that by being different, which buys novelty with no argument behind it. Answer it by writing down the centroid for the page type in front of you before you build. For a pricing page that is three columns, the middle one highlighted with a badge, checkmark bullet lists, an "Everything in X, plus" carry line, and "Talk to sales" in the last column. Take each convention in turn and decide whether a reader of this product needs it. Keeping one on purpose is a decision. Keeping the set is the centroid with extra steps.

This file has a centroid too, and you are probably sitting on it. Two runs under two drafts of these rules produced pricing pages sharing eight CSS declarations the unguided run had none of: a 1080px container, an 8px radius, a 120ms background transition, a 2px focus outline offset, negative tracking on the display size, the system font stack, hairline column dividers, and a 62ch measure. Plain and consistent is the floor these rules get you to, not the finish. Once the page is plain, make the one decision the brief pays for: what the reader is comparing, and what the layout does to make that comparison easy.

### Fabricated content

Never invent social proof: testimonials, customer names, company logos, star ratings, user counts, uptime figures, review text, or faces for people who do not exist. There is no acceptable placeholder version of these, and since 2024 US federal rule 16 CFR Part 465 prohibits testimonials that misrepresent themselves as coming from someone who does not exist, explicitly including AI-generated fake reviews. If a layout needs a testimonial slot, fill it with text that is obviously unusable and say so when you hand it over. Benchmark results and performance figures belong on this side too: if you did not measure it, it does not go on the screen.

Product data is the other class and takes a different rule. A pricing page cannot be built without prices and a chart cannot be drawn without numbers, so invent what the brief needs, keep every figure consistent with every other figure on the page, and list each invented one in the handback with the element it sits on. A number you invented and flagged is a placeholder. The same number unflagged is a claim.

### What to do instead

Read the project's tokens, its existing components, and two or three screens it already ships, then build from those. When there is no design system, build the smallest one you can defend and write it down as tokens: an accent and its counterpart on dark surfaces, one radius, one shadow level, the system font stack, one spacing step. Consistency is the goal, not scarcity. A second accent because the featured column is dark is a decision. A second accent because the first one looked flat is a default.

Theme is part of that system, not a decoration on top of it. If the page you are editing already answers `prefers-color-scheme`, it still answers it when you hand it back, in every token you touched, and adding a color without adding its dark counterpart breaks the mode for the whole component without showing up in your screenshot. If you are building new and the project has no theme system, you are not obliged to write one, but you are obliged to say which mode the page is: set `color-scheme` on `:root` so the browser paints scrollbars, form controls, and the canvas to match. A page that declares nothing is the broken case. Plain and consistent survives review. Decorated and defaulted does not.

## Files, commits, and pull requests

Do not create summary documents. `IMPLEMENTATION_NOTES.md`, `SUMMARY.md`, `CHANGES.md`, `MIGRATION_GUIDE.md`, and a "Recent updates" section appended to the README are artifacts of your process rather than the project's needs. The diff is the record. Write documentation when someone asks for it, or when a real user of the project needs it.

Commit subjects state what changed, in the format the repository already uses; read `git log` before writing the first one. Skip the enumerated file list, the emoji prefix the project does not use, and phrasings like "Enhanced the parser to provide improved handling of edge cases" that describe an improvement without naming it. A pull request body says what changed and what you verified, not your reasoning trace or an implementation-phase breakdown.

Clean the working tree: scratch scripts, `.bak` and `.orig` files, one-off harnesses at the repository root, and screenshots taken while working do not belong in the commit.

## What to say when you hand it back

The largest measured gap in AI-assisted work is not in the diff. It is between what was verified and what gets claimed.

In a randomized trial, experienced developers using AI on real tasks in repositories they knew well were **19% slower**, and afterward still believed they had been sped up by 20%. The feeling of speed is not evidence of speed, and it is not evidence of correctness.

So, in the handback message:

- Say what you ran and what it printed. A check you did not run is not a check that passed.
- Account for the capability inventory: what you kept, what you replaced, what you dropped and why.
- Name what you did not verify. Untested paths, unverified integrations, figures that are placeholders.
- Do not claim performance, security, or correctness improvements you did not measure.
- Do not describe the work as fast, clean, comprehensive, or production-ready. Describe what it does.

Disclosure is not a substitute for a fix. Four things may never be disclosed in place of being fixed: an unbounded cache or queue, a missing timeout, a missing retry ceiling, and user input reaching HTML, SQL, a shell, a path, a URL, or a log without escaping. Fix those, or hand back code that does not contain them. For everything else the trigger is grammatical, because that is the only kind of check that still works after the code is written: a line in your handback or your doc comment reading "is never swept", "grows with", "for the lifetime of the process", or "callers should be aware" is a bound you decided not to write. Write it. Then disclose only what genuinely remains. A well-worded limitation reads as craft and reviews as craft, which is what makes it the cheapest way to move a defect past a reader who is inclined to trust you.

The developer frustration reported most often with AI output, by 66% of 49,000 survey respondents, is code that is "almost right, but not quite". Almost-right code that arrives with a confident summary costs more than code that arrives with an honest list of gaps.

## The pass before you hand it back

Ordered by what it costs to get wrong, not by what is easiest to check.

**Ships broken or unsafe:**

1. Nothing the brief asked for, and nothing the version you started from did, is missing. Account for each item as kept, replaced by something you name, or dropped for a stated reason. Removing a capability is a product change and needs the permission any product change needs.
2. Every new third-party import: does the package exist? Check the lockfile or registry.
3. Every value crossing a trust boundary on the way in, meaning a network body, a request parameter, a file, an environment variable, another team's API: is it checked on the first line of the function that receives it? A value your own module hands to itself is not crossing a boundary, and its type is already the check.
4. Every place user input reaches HTML, SQL, a shell, a path, a URL, or a log line.
5. Every network call, wait, lock, cache, queue, and growing collection: what bounds it? A timeout, a maximum size, a maximum age. One you documented is still unbounded.
6. Every number, name, logo, quote, and rating in the interface: invented social proof comes out, and invented product data goes in the handback with the element it sits on.
7. Every text and control color, measured against the surface it actually sits on: 4.5:1 for body text, 3:1 for large text, for component boundaries, and for the focus indicator. Compute the ratio. Do not judge it by eye. The failures are the second surface: the tinted card, the dark panel, the hover fill, the disabled state.
8. Every control you built: tab to it, operate it with the keyboard, and say its accessible name and its state.

**Costs a reviewer their time:**

9. Read the diff top to bottom. Delete every line that is not the change you were asked to make, then check each deletion against the list from item 1. A reordered import or a changed quote style goes without argument. A code path goes only when you can say what it did and why nobody needs it.
10. Behavior and structure in the same commit? Split them.
11. Each new function, constant, type, or file with one caller: does its name save the reader a comment, and does inlining it flatten the caller or bury it? Inline when the name adds nothing. Exported symbols are exempt, because their callers are outside the file in front of you.
12. Each comment you added: delete it mentally and reread the code. If nothing was lost, delete it for real. Then check the reverse: does any exported function lack its units, null semantics, or ownership note?
13. Each guard: at a boundary, keep it; inside typed code where the state cannot occur, cut it.
14. Colors, radii, fonts, spacing: from the project's tokens?

**Reads as generated:**

15. Sentences ending in a trailing `-ing` clause, three-item lists where the third is filler, "not just X but Y", and the measured excess vocabulary.
16. Assistant chatter, unfilled brackets, `Lorem ipsum`, and any call to action that is no longer a link.
17. Sentence lengths, section by section: is there one under eight words, and do any three in a row sit within two words of each other?
18. Cut words, not punctuation, and check it by counting. Count commas, semicolons, parentheses, and dashes per hundred words in the draft you started from and in the one you are handing back. When this document was tested, the steered draft of a landing page carried 5.5 marks per hundred words against 10.5 for the unsteered draft of the same page, because the edit pass merged clauses away instead of deleting words. That is a move toward the machine distribution, not away from it.
19. Read the prose aloud. Any phrase you would not say to a colleague gets rewritten.

The test that covers all nineteen: could a specific person have written this, for this specific project, having made each of these choices on purpose? If anyone could have produced it for anything, it is not finished.

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
- **The indigo default.** Adam Wathan, August 2025. The leaked v0 system prompt.
- **Design convergence.** Chen et al., arXiv:2502.05870: 96 generated designs vs 105 award winners, tighter clustering on every measured axis.
- **Fabricated reviews.** FTC final rule, 16 CFR Part 465 (2024).
- **Self-assessment.** Becker, Rush, Barnes & Rein, arXiv:2507.09089 (METR): 19% slower, believed 20% faster; scope is 16 developers in mature repos with early-2025 tools, and METR's February 2026 update reports conflicting later figures. 2025 Stack Overflow Developer Survey, 49,000+ respondents: 66% cite "almost right, but not quite".
- **This document's own test set.** Five briefs generated with no document, under v1, and under v2, scored by a deterministic pattern counter, blind judges, and three adversarial reviewers. Source of the capability-deletion, overcorrection, punctuation-collapse, and sentence-plateau findings.

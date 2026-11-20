/**
 * Offline check for Safari's DNR `regexFilter` dialect.
 *
 * Safari compiles declarativeNetRequest rules into a WebKit content blocker,
 * and a `regexFilter` has to pass the content blocker's pattern parser
 * (`WebCore::ContentExtensions::URLFilterParser`). That parser accepts a small
 * subset of JavaScript regex syntax, and one rule it rejects fails the whole
 * `updateDynamicRules` / `updateSessionRules` call. Safari exposes the same
 * check at runtime as `declarativeNetRequest.isRegexSupported`, which the
 * background uses; this port exists so tests can hold the rule builders to the
 * subset without a Safari to run them in.
 *
 * What the subset allows:
 * - literal characters, escaped metacharacters, `.`, `[...]` and `[^...]`
 * - groups, `(...)` and `(?:...)`, without alternation
 * - the quantifiers `?`, `*` and `+` (and `{0,1}`, `{0,}`, `{1,}`), lazy or not
 * - `^` only as the very first term, `$` only as the very last term and never
 *   inside a group
 *
 * What it rejects: `|` anywhere, other `{n,m}` counts, `\d \w \s \D \W \S`
 * (inside a class too), `\b` and `\B`, lookarounds and modifier groups,
 * non-ASCII characters (raw or escaped), and a pattern that can match the
 * empty string.
 *
 * Ported from WebKit main (2026-11): URLFilterParser.cpp for the state
 * machine and Term.h for `matchesAtLeastOneCharacter`, with the tokenizing
 * that JavaScriptCore's Yarr parser does in its legacy (non-unicode) mode.
 * WebKit's own expectations in Tools/TestWebKitAPI/Tests/WebCore/
 * ContentExtensions.cpp are reproduced in the tests, with one deliberate
 * difference: WebKit reads `\1`..`\9` and `\k` in a pattern as an octal
 * escape or a literal, which accepts them but silently changes what they
 * mean, so this checker reports them as `BackReference`.
 */

export type SafariRegexStatus =
  | 'Ok'
  | 'NonASCII'
  | 'EmptyPattern'
  | 'YarrError'
  | 'Disjunction'
  | 'InvalidQuantifier'
  | 'UnsupportedCharacterClass'
  | 'AtomCharacter'
  | 'BackReference'
  | 'Group'
  | 'MisplacedStartOfLine'
  | 'MisplacedEndOfLine'
  | 'WordBoundary'
  | 'MatchesEverything';

type Quantifier = 'one' | 'zeroOrOne' | 'zeroOrMore' | 'oneOrMore';

type Term =
  | { kind: 'atom'; quantifier: Quantifier }
  | { kind: 'endOfLine'; quantifier: Quantifier }
  | { kind: 'group'; quantifier: Quantifier; terms: Term[] };

/** Term::matchesAtLeastOneCharacter */
function matchesAtLeastOneCharacter(term: Term): boolean {
  if (term.quantifier === 'zeroOrOne' || term.quantifier === 'zeroOrMore') return false;
  if (term.kind === 'endOfLine') return false;
  if (term.kind === 'group') return term.terms.some(matchesAtLeastOneCharacter);
  return true;
}

/**
 * The URLFilterParser `PatternParser` callbacks. Only what decides the parse
 * status is kept: WebKit also builds the matching automaton here.
 */
class PatternParser {
  status: SafariRegexStatus = 'Ok';
  private floating: Term | null = null;
  private sunk: Term[] = [];
  private openGroups: Extract<Term, { kind: 'group' }>[] = [];
  private processedEndOfLine = false;

  private get failed(): boolean {
    return this.status !== 'Ok';
  }

  fail(status: SafariRegexStatus): void {
    if (!this.failed) this.status = status;
  }

  private sinkFloatingTerm(): void {
    if (!this.floating) return;
    if (this.processedEndOfLine) {
      this.fail('MisplacedEndOfLine');
      this.floating = null;
      return;
    }
    if (this.floating.kind === 'endOfLine') this.processedEndOfLine = true;
    const group = this.openGroups[this.openGroups.length - 1];
    if (group) group.terms.push(this.floating);
    else this.sunk.push(this.floating);
    this.floating = null;
  }

  character(code: number): void {
    if (this.failed) return;
    if (code > 0x7f) return this.fail('NonASCII');
    this.sinkFloatingTerm();
    this.floating = { kind: 'atom', quantifier: 'one' };
  }

  dot(): void {
    if (this.failed) return;
    this.sinkFloatingTerm();
    this.floating = { kind: 'atom', quantifier: 'one' };
  }

  builtInCharacterClass(): void {
    this.fail('UnsupportedCharacterClass');
  }

  quantify(min: number, max: number): void {
    if (this.failed || !this.floating) return;
    if (min === 0 && max === 1) this.floating.quantifier = 'zeroOrOne';
    else if (min === 0 && max === Infinity) this.floating.quantifier = 'zeroOrMore';
    else if (min === 1 && max === Infinity) this.floating.quantifier = 'oneOrMore';
    else this.fail('InvalidQuantifier');
  }

  backReference(): void {
    this.fail('BackReference');
  }

  startOfLine(): void {
    if (this.failed) return;
    if (this.floating || this.sunk.length > 0 || this.openGroups.length > 0) {
      this.fail('MisplacedStartOfLine');
    }
  }

  endOfLine(): void {
    if (this.failed) return;
    this.sinkFloatingTerm();
    this.floating = { kind: 'endOfLine', quantifier: 'one' };
  }

  wordBoundary(): void {
    this.fail('WordBoundary');
  }

  characterClassBegin(): void {
    if (this.failed) return;
    this.sinkFloatingTerm();
    this.floating = { kind: 'atom', quantifier: 'one' };
  }

  characterClassAtom(code: number): void {
    if (this.failed) return;
    if (code > 0x7f) this.fail('NonASCII');
  }

  characterClassBuiltIn(): void {
    this.fail('AtomCharacter');
  }

  groupBegin(): void {
    if (this.failed) return;
    this.sinkFloatingTerm();
    this.openGroups.push({ kind: 'group', quantifier: 'one', terms: [] });
  }

  assertionGroupBegin(): void {
    this.fail('Group');
  }

  groupEnd(): void {
    if (this.failed) return;
    this.sinkFloatingTerm();
    this.floating = this.openGroups.pop() ?? null;
  }

  disjunction(): void {
    this.fail('Disjunction');
  }

  finalize(): void {
    if (this.failed) return;
    this.sinkFloatingTerm();
    if (this.failed) return;
    if (!this.sunk.some(matchesAtLeastOneCharacter)) this.fail('MatchesEverything');
  }
}

class YarrSyntaxError extends Error {}

const BUILT_IN_CLASS = new Set(['d', 'D', 'w', 'W', 's', 'S']);
const CONTROL_ESCAPES: Record<string, number> = { f: 0x0c, n: 0x0a, r: 0x0d, t: 0x09, v: 0x0b };

function isOctal(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '7';
}

function isHex(ch: string | undefined): boolean {
  return ch !== undefined && /^[0-9a-fA-F]$/.test(ch);
}

function isAsciiLetter(ch: string | undefined): boolean {
  return ch !== undefined && /^[A-Za-z]$/.test(ch);
}

/**
 * Walks the pattern the way Yarr's legacy-mode parser does and reports each
 * construct to the `PatternParser`. Throws `YarrSyntaxError` where Yarr would
 * report a syntax error.
 */
class Tokenizer {
  private i = 0;
  private depth = 0;
  // Whether the previous token can take a quantifier.
  private lastWasAtom = false;

  constructor(
    private readonly src: string,
    private readonly out: PatternParser
  ) {}

  private peek(offset = 0): string | undefined {
    return this.src[this.i + offset];
  }

  run(): void {
    while (this.i < this.src.length) this.token();
    if (this.depth !== 0) throw new YarrSyntaxError('unterminated group');
  }

  private token(): void {
    const ch = this.src[this.i];
    switch (ch) {
      case '|':
        this.i++;
        this.out.disjunction();
        this.lastWasAtom = false;
        return;
      case '^':
        this.i++;
        this.out.startOfLine();
        this.lastWasAtom = false;
        return;
      case '$':
        this.i++;
        this.out.endOfLine();
        this.lastWasAtom = false;
        return;
      case '.':
        this.i++;
        this.out.dot();
        this.lastWasAtom = true;
        return;
      case '(':
        this.groupOpen();
        return;
      case ')':
        if (this.depth === 0) throw new YarrSyntaxError('unmatched )');
        this.i++;
        this.depth--;
        this.out.groupEnd();
        this.lastWasAtom = true;
        return;
      case '[':
        this.characterClass();
        this.lastWasAtom = true;
        return;
      case '\\':
        this.escape();
        return;
      case '*':
      case '+':
      case '?':
        this.i++;
        this.quantifier(ch === '+' ? 1 : 0, ch === '?' ? 1 : Infinity);
        return;
      case '{': {
        const braced = this.bracedQuantifier();
        if (braced) {
          this.quantifier(braced.min, braced.max);
          return;
        }
        // Not a well-formed `{n,m}`: legacy mode reads the brace literally.
        this.i++;
        this.out.character(ch.charCodeAt(0));
        this.lastWasAtom = true;
        return;
      }
      default:
        this.i++;
        this.out.character(ch.codePointAt(0)!);
        this.lastWasAtom = true;
    }
  }

  private quantifier(min: number, max: number): void {
    if (!this.lastWasAtom) throw new YarrSyntaxError('nothing to repeat');
    if (min > max) throw new YarrSyntaxError('quantifier out of order');
    // Lazy suffix; the content blocker ignores greediness.
    if (this.peek() === '?') this.i++;
    this.out.quantify(min, max);
    this.lastWasAtom = false;
  }

  /** `{n}`, `{n,}` or `{n,m}` at the cursor, consumed; otherwise null. */
  private bracedQuantifier(): { min: number; max: number } | null {
    const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(this.src.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    const min = Number(m[1]);
    const max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
    return { min, max };
  }

  private groupOpen(): void {
    this.i++;
    this.depth++;
    this.lastWasAtom = false;
    if (this.peek() !== '?') {
      this.out.groupBegin();
      return;
    }
    const rest = this.src.slice(this.i + 1);
    if (rest.startsWith(':')) {
      this.i += 2;
      this.out.groupBegin();
      return;
    }
    if (rest.startsWith('=') || rest.startsWith('!')) {
      this.i += 2;
      this.out.assertionGroupBegin();
      return;
    }
    if (rest.startsWith('<=') || rest.startsWith('<!')) {
      this.i += 3;
      this.out.assertionGroupBegin();
      return;
    }
    const named = /^<([A-Za-z_$][\w$]*)>/.exec(rest);
    if (named) {
      this.i += 1 + named[0].length;
      this.out.groupBegin();
      return;
    }
    const modifiers = /^[ims]*(?:-[ims]*)?:/.exec(rest);
    if (modifiers) {
      this.i += 1 + modifiers[0].length;
      this.out.assertionGroupBegin();
      return;
    }
    throw new YarrSyntaxError('invalid group');
  }

  /** Escape outside a character class. */
  private escape(): void {
    const next = this.peek(1);
    if (next === undefined) throw new YarrSyntaxError('\\ at end of pattern');
    this.i += 2;
    if (BUILT_IN_CLASS.has(next)) {
      this.out.builtInCharacterClass();
      this.lastWasAtom = true;
      return;
    }
    if (next === 'b' || next === 'B') {
      this.out.wordBoundary();
      this.lastWasAtom = false;
      return;
    }
    if ((next >= '1' && next <= '9') || next === 'k') {
      // See the file comment: rejected here although WebKit accepts it.
      this.out.backReference();
      this.lastWasAtom = true;
      return;
    }
    this.out.character(this.escapedCharacter(next));
    this.lastWasAtom = true;
  }

  /**
   * The character an escape stands for, with the cursor just past the
   * escape's first character. Legacy mode treats an unknown escape, or a
   * malformed `\x`/`\u`/`\c`, as the literal character.
   */
  private escapedCharacter(c: string): number {
    if (c in CONTROL_ESCAPES) return CONTROL_ESCAPES[c];
    if (c === 'x' && isHex(this.peek()) && isHex(this.peek(1))) {
      const code = parseInt(this.src.slice(this.i, this.i + 2), 16);
      this.i += 2;
      return code;
    }
    if (c === 'u' && [0, 1, 2, 3].every(k => isHex(this.peek(k)))) {
      const code = parseInt(this.src.slice(this.i, this.i + 4), 16);
      this.i += 4;
      return code;
    }
    if (c === 'c' && isAsciiLetter(this.peek())) {
      const code = this.src.charCodeAt(this.i) % 32;
      this.i += 1;
      return code;
    }
    if (isOctal(c)) {
      // Legacy octal: up to three digits, at most \377.
      let digits = c;
      while (digits.length < 3 && isOctal(this.peek())) {
        const candidate = digits + this.peek();
        if (parseInt(candidate, 8) > 0o377) break;
        digits = candidate;
        this.i++;
      }
      return parseInt(digits, 8);
    }
    return c.codePointAt(0)!;
  }

  private characterClass(): void {
    this.i++; // [
    if (this.peek() === '^') this.i++;
    this.out.characterClassBegin();
    while (this.i < this.src.length) {
      if (this.peek() === ']') {
        this.i++;
        return;
      }
      const low = this.classAtom();
      // `a-z`, unless the dash is the last thing in the class.
      if (this.peek() === '-' && this.peek(1) !== undefined && this.peek(1) !== ']') {
        this.i++;
        const high = this.classAtom();
        if (low !== null && high !== null && high < low) {
          throw new YarrSyntaxError('range out of order');
        }
        // With a built-in class at either end, legacy mode reads the dash
        // literally; the built-in class has already failed the parse.
        if (low !== null) this.out.characterClassAtom(low);
        if (high !== null) this.out.characterClassAtom(high);
        continue;
      }
      if (low !== null) this.out.characterClassAtom(low);
    }
    throw new YarrSyntaxError('unterminated character class');
  }

  /** One character inside `[...]`, or null for a built-in class like `\d`. */
  private classAtom(): number | null {
    const ch = this.src[this.i];
    if (ch !== '\\') {
      this.i++;
      return ch.codePointAt(0)!;
    }
    const next = this.peek(1);
    if (next === undefined) throw new YarrSyntaxError('\\ at end of pattern');
    this.i += 2;
    if (BUILT_IN_CLASS.has(next)) {
      this.out.characterClassBuiltIn();
      return null;
    }
    // Inside a class `\b` is backspace, not a word boundary.
    if (next === 'b') return 0x08;
    return this.escapedCharacter(next);
  }
}

/**
 * The status WebKit's content-blocker parser would give `pattern` as a DNR
 * `regexFilter`. Anything other than `'Ok'` means Safari rejects the rule.
 */
export function safariRegexStatus(pattern: string): SafariRegexStatus {
  if (/[^\x00-\x7f]/.test(pattern)) return 'NonASCII';
  if (pattern === '') return 'EmptyPattern';
  const parser = new PatternParser();
  try {
    new Tokenizer(pattern, parser).run();
  } catch (err) {
    if (err instanceof YarrSyntaxError) return 'YarrError';
    throw err;
  }
  parser.finalize();
  return parser.status;
}

export function isSafariRegexSupported(pattern: string): boolean {
  return safariRegexStatus(pattern) === 'Ok';
}

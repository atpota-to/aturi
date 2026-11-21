import { describe, it, expect } from 'vitest';
import { isSafariRegexSupported, safariRegexStatus, type SafariRegexStatus } from '../safariRegex';

/**
 * WebKit's own expectations for its content-blocker pattern parser, from
 * Tools/TestWebKitAPI/Tests/WebCore/ContentExtensions.cpp (WebKit main,
 * 2026-11). If the port drifts from WebKit, these are what catch it.
 */
const WEBKIT_EXPECTATIONS: Array<[string, SafariRegexStatus]> = [
  ['a*b?.*.?[a-z]?[a-z]*', 'MatchesEverything'],
  ['a*b?.*.?[a-z]?[a-z]+', 'Ok'],
  ['a*b?.*.?[a-z]?[a-z]', 'Ok'],
  ['.*?a', 'Ok'],
  ['.*a', 'Ok'],

  ['(?!)', 'Group'],
  ['(?=)', 'Group'],
  ['(?!a)', 'Group'],
  ['(?=a)', 'Group'],
  ['(regex)', 'Ok'],
  ['(regex', 'YarrError'],
  ['((regex)', 'YarrError'],
  ['(?:regex)', 'Ok'],
  ['(?:regex', 'YarrError'],
  ['[^.]+', 'Ok'],

  ['a++', 'YarrError'],
  ['[a]++', 'YarrError'],
  ['+', 'YarrError'],

  ['[', 'YarrError'],
  ['[a}', 'YarrError'],

  ['a]', 'Ok'],
  ['{', 'Ok'],
  ['{[a]', 'Ok'],
  ['{0', 'Ok'],
  ['{0,', 'Ok'],
  ['{0,1', 'Ok'],
  ['a{0,1', 'Ok'],
  ['a{a,b}', 'Ok'],

  ['ÿ', 'NonASCII'],
  ['\\xff', 'NonASCII'],

  ['\\x\\r\\n', 'Ok'],
  ['\\b', 'WordBoundary'],
  ['[\\d]', 'AtomCharacter'],
  ['\\d\\D\\w\\s\\v\\h\\i\\c', 'UnsupportedCharacterClass'],

  ['this|that', 'Disjunction'],
  ['a{0,1}b', 'Ok'],
  ['a{0,2}b', 'InvalidQuantifier'],
  ['', 'EmptyPattern'],
  ['$$', 'MisplacedEndOfLine'],
  ['a^', 'MisplacedStartOfLine'],
  ['(^)', 'MisplacedStartOfLine'],

  ['(?<A>a)\\k<A>', 'BackReference'],

  // PatternMatchingTheEmptyString
  ['.*', 'MatchesEverything'],
  ['a*', 'MatchesEverything'],
  ['.?', 'MatchesEverything'],
  ['a?', 'MatchesEverything'],
  ['[a-z]*', 'MatchesEverything'],
  ['[a-z]?', 'MatchesEverything'],
  ['(foobar)*', 'MatchesEverything'],
  ['(foobar)?', 'MatchesEverything'],
  ['(.*)', 'MatchesEverything'],
  ['(a*)', 'MatchesEverything'],
  ['(.?)', 'MatchesEverything'],
  ['(a?)', 'MatchesEverything'],
  ['([a-z]*)', 'MatchesEverything'],
  ['([a-z]?)', 'MatchesEverything'],
  ['(.)*', 'MatchesEverything'],
  ['(.+)*', 'MatchesEverything'],
  ['(.?)*', 'MatchesEverything'],
  ['(.*)*', 'MatchesEverything'],
  ['(.+)?', 'MatchesEverything'],
  ['(.?)+', 'MatchesEverything'],
  ['((foo)?((.)*)(bar)*)', 'MatchesEverything'],
];

describe('safariRegexStatus: WebKit expectations', () => {
  it.each(WEBKIT_EXPECTATIONS)('%j -> %s', (pattern, expected) => {
    expect(safariRegexStatus(pattern)).toBe(expected);
  });
});

describe('safariRegexStatus: deliberate differences from WebKit', () => {
  // WebKit accepts these, reading `\1` as octal 1 and `\k<A>` as the literal
  // "k<A>". The rule would compile on Safari but match something else than
  // on Chrome, so the checker treats them as failures.
  it.each(['(a)\\1', '\\1(a)', '\\8(a)', '\\9(a)', '(<A>a)\\k<A>', '\\k<A>(a)'])(
    '%j is reported as BackReference',
    pattern => {
      expect(safariRegexStatus(pattern)).toBe('BackReference');
    }
  );
});

describe('safariRegexStatus: the constructs Aturi uses', () => {
  it.each([
    '^https://bsky\\.app/profile/([^/?#]+)/post/([^/?#]+).*',
    '^https://bsky\\.app/profile/([^/?#]+)/?$',
    '^https://pdsls\\.dev/at:/+([^/?#]+)/?$',
    '^https://bsky\\.app/x\\?y=1(?:#.*)?$',
    '^https?://bsky\\.app[:/]',
    '^https://a\\.b/\\$\\{\\}\\(\\)\\[\\]\\|\\\\\\*\\^\\+',
  ])('accepts %j', pattern => {
    expect(isSafariRegexSupported(pattern)).toBe(true);
  });

  it.each<[string, SafariRegexStatus]>([
    ['^https?://(?:a\\.com|b\\.com)(?:[:/?#]|$)', 'Disjunction'],
    ['^https://a\\.com(?:/|$)', 'Disjunction'],
    ['^https://a\\.com/(?:x$)', 'MisplacedEndOfLine'],
    ['^https://a\\.com/\\d+', 'UnsupportedCharacterClass'],
    ['^https://a\\.com/[0-9]{2,4}', 'InvalidQuantifier'],
    ['^https://a\\.com/\\bx', 'WordBoundary'],
    ['^https://a\\.com/(?!x)', 'Group'],
    ['^https://a\\.com/(?i:x)', 'Group'],
    ['^https://a\\.com/(?<=x)y', 'Group'],
    ['^https://a\\.com/é', 'NonASCII'],
    ['^https://a\\.com/\\u00e9', 'NonASCII'],
    ['^https://a\\.com/[\\u00e0-\\u00ff]', 'NonASCII'],
    ['^https://a\\.com/[z-a]', 'YarrError'],
    ['^https://a\\.com/)', 'YarrError'],
    ['^https://a\\.com/\\', 'YarrError'],
    ['^a$', 'Ok'],
    ['a$b', 'MisplacedEndOfLine'],
  ])('%j -> %s', (pattern, expected) => {
    expect(safariRegexStatus(pattern)).toBe(expected);
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAcceptHeader, selectRepresentation } from '@/lib/acceptNegotiation';

const HTML = 'text/html';
const MD = 'text/markdown';
const OFFERED = [HTML, MD] as const;

const pick = (accept: string | null | undefined) =>
  selectRepresentation(accept, OFFERED);

test('parses q-values, defaulting to 1', () => {
  assert.deepEqual(parseAcceptHeader('text/markdown, text/html;q=0.8, */*;q=0.1'), [
    { type: 'text', subtype: 'markdown', q: 1 },
    { type: 'text', subtype: 'html', q: 0.8 },
    { type: '*', subtype: '*', q: 0.1 },
  ]);
});

test('parsing is case- and whitespace-insensitive, and skips junk entries', () => {
  assert.deepEqual(parseAcceptHeader('  TEXT/Markdown ;  Q=0.5 , garbage , /x , text/ '), [
    { type: 'text', subtype: 'markdown', q: 0.5 },
  ]);
});

test('an out-of-range or unparseable q is treated as absent, not as a rejection', () => {
  assert.deepEqual(parseAcceptHeader('text/html;q=9'), [
    { type: 'text', subtype: 'html', q: 1 },
  ]);
  assert.deepEqual(parseAcceptHeader('text/html;q=nonsense'), [
    { type: 'text', subtype: 'html', q: 1 },
  ]);
});

test('no constraint means the server default, never Markdown', () => {
  // A missing Accept and `*/*` both mean "no preference" — flipping either
  // onto Markdown would hand a browser a page it renders as raw text.
  assert.equal(pick(null), HTML);
  assert.equal(pick(undefined), HTML);
  assert.equal(pick(''), HTML);
  assert.equal(pick('   '), HTML);
  assert.equal(pick('*/*'), HTML);
  assert.equal(pick('garbage-with-no-slash'), HTML);
});

test('a real Chrome Accept header selects HTML', () => {
  assert.equal(
    pick('text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'),
    HTML,
  );
});

test('an explicit Markdown request selects Markdown', () => {
  assert.equal(pick(MD), MD);
  assert.equal(pick('text/markdown, text/html;q=0.8'), MD);
  assert.equal(pick('text/markdown;q=0.9, text/html;q=0.8'), MD);
});

test('the higher q wins regardless of listed order', () => {
  assert.equal(pick('text/html;q=0.9, text/markdown;q=0.8'), HTML);
  assert.equal(pick('text/html;q=0.2, text/markdown;q=0.8'), MD);
});

test('at equal q the more specific match wins over a wildcard', () => {
  // `text/markdown` is an exact match; HTML only matches via `*/*`.
  assert.equal(pick('*/*, text/markdown'), MD);
  // Both exact and equal — server preference order breaks the tie.
  assert.equal(pick('text/markdown, text/html'), HTML);
});

test('a subtype wildcard matches both offers and falls back to server order', () => {
  assert.equal(pick('text/*'), HTML);
});

test('q=0 on the specific type is respected even under a permissive wildcard', () => {
  // "anything, but not Markdown" — the more specific entry decides Markdown's
  // fate even though `*/*` carries a higher q.
  assert.equal(pick('*/*, text/markdown;q=0'), HTML);
  assert.equal(pick('text/markdown;q=0, */*'), HTML);
});

test('a header of exclusions only is a constraint, not a request', () => {
  // acceptmarkdown.com calls this out specifically: `text/markdown;q=0` means
  // "anything but Markdown", so HTML is served rather than 406.
  assert.equal(pick('text/markdown;q=0'), HTML);
  assert.equal(pick('text/html;q=0'), MD);
});

test('406 only when every representation is genuinely unacceptable', () => {
  assert.equal(pick('application/pdf'), null);
  assert.equal(pick('text/html;q=0, text/markdown;q=0'), null);
  assert.equal(pick('image/png, application/pdf;q=0.5'), null);
});

test('no offers is unsatisfiable', () => {
  assert.equal(selectRepresentation('*/*', []), null);
});

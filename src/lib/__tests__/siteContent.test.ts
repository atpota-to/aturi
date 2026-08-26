import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ABOUT_PAGE,
  CONTACT_PAGE,
  HOME_PAGE,
  buildMcpPage,
  parseInline,
  renderContentPageMarkdown,
  type ContentPage,
} from '@/lib/siteContent';

const PAGES: [string, ContentPage][] = [
  ['about', ABOUT_PAGE],
  ['contact', CONTACT_PAGE],
  ['home', HOME_PAGE],
  ['mcp', buildMcpPage('https://example.test')],
];

test('plain text passes through as a single segment', () => {
  assert.deepEqual(parseInline('just words'), [{ kind: 'text', text: 'just words' }]);
  assert.deepEqual(parseInline(''), []);
});

test('links, strong and code are recognised', () => {
  assert.deepEqual(parseInline('see [docs](/docs) now'), [
    { kind: 'text', text: 'see ' },
    { kind: 'link', text: 'docs', href: '/docs' },
    { kind: 'text', text: ' now' },
  ]);
  assert.deepEqual(parseInline('**bold**'), [{ kind: 'strong', text: 'bold' }]);
  assert.deepEqual(parseInline('a `at://` uri'), [
    { kind: 'text', text: 'a ' },
    { kind: 'code', text: 'at://' },
    { kind: 'text', text: ' uri' },
  ]);
});

test('several constructs in one string are split in order', () => {
  assert.deepEqual(parseInline('**A** then [b](/b) then `c`'), [
    { kind: 'strong', text: 'A' },
    { kind: 'text', text: ' then ' },
    { kind: 'link', text: 'b', href: '/b' },
    { kind: 'text', text: ' then ' },
    { kind: 'code', text: 'c' },
  ]);
});

test('typographic characters survive untouched', () => {
  const input = 'the Atmosphere — an account’s records — “quoted”';
  assert.deepEqual(parseInline(input), [{ kind: 'text', text: input }]);
});

test('is reentrant across calls', () => {
  // A shared /g regex would carry lastIndex between calls and drop matches.
  const input = '[a](/a) and [b](/b)';
  assert.deepEqual(parseInline(input), parseInline(input));
  assert.equal(parseInline(input).filter(s => s.kind === 'link').length, 2);
});

test('Markdown rendering produces a heading, a summary and every section', () => {
  const md = renderContentPageMarkdown(ABOUT_PAGE);
  assert.ok(md.startsWith(`# ${ABOUT_PAGE.title}\n`));
  assert.ok(md.includes(`> ${ABOUT_PAGE.description}`));
  assert.ok(md.includes(ABOUT_PAGE.intro));
  for (const section of ABOUT_PAGE.sections) {
    assert.ok(md.includes(`## ${section.heading}`), `missing ${section.heading}`);
  }
  assert.ok(md.endsWith('\n'));
  assert.ok(!md.includes('\n\n\n'), 'should not emit blank-line runs');
});

test('list blocks render as Markdown bullets', () => {
  const md = renderContentPageMarkdown({
    title: 'T',
    description: 'D',
    intro: 'I',
    sections: [{ id: 's', heading: 'H', blocks: [{ kind: 'ul', items: ['one', 'two'] }] }],
  });
  assert.ok(md.includes('- one\n- two'));
});

for (const [name, page] of PAGES) {
  test(`${name}: has a title, a description and at least one section`, () => {
    assert.ok(page.title.length > 0);
    assert.ok(page.description.length > 20);
    assert.ok(page.intro.length > 50);
    assert.ok(page.sections.length > 0);
  });

  test(`${name}: section ids are unique and anchor-safe`, () => {
    const ids = page.sections.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
  });

  test(`${name}: every inline link has a non-empty label and href`, () => {
    for (const section of page.sections) {
      for (const block of section.blocks) {
        const strings = block.kind === 'p' ? [block.text] : block.items;
        for (const value of strings) {
          for (const segment of parseInline(value)) {
            if (segment.kind !== 'link') continue;
            assert.ok(segment.text.trim().length > 0);
            assert.match(segment.href, /^(\/|https:\/\/|mailto:)/);
          }
        }
      }
    }
  });
}

test('the trust-anchor pages clear the 500-character bar crawlers check', () => {
  // Audits treat a short /about or /contact as a stub and discount it.
  for (const [name, page] of [['about', ABOUT_PAGE], ['contact', CONTACT_PAGE]] as const) {
    const text = renderContentPageMarkdown(page).replace(/[#>*`\-]/g, '').trim();
    assert.ok(text.length >= 500, `${name} is only ${text.length} characters`);
  }
});

test('contact names a route for each kind of report', () => {
  const md = renderContentPageMarkdown(CONTACT_PAGE).toLowerCase();
  for (const needle of ['/feedback', 'github.com/atpota-to/aturi/issues', 'security', 'contact@aturi.to']) {
    assert.ok(md.includes(needle), `contact page never mentions ${needle}`);
  }
});

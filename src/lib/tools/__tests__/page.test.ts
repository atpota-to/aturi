import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  absoluteImage,
  buildPageChecks,
  declaredRecords,
  linkCardFor,
  normalizePageUrl,
  pageVerdict,
  readPage,
  type PageReport,
} from '@/lib/tools/page';

const DID = 'did:plc:z72i7hdynmk6r22z27h6tvur';
const RECORD = `at://${DID}/site.standard.document/3kabc`;
const PAGE = 'https://blog.example.com/posts/hello';

const FULL = `<!doctype html><html><head>
  <title>Hello &amp; welcome | Example Blog</title>
  <meta name="description" content="A plain description.">
  <link rel="canonical" href="https://blog.example.com/posts/hello">
  <meta property="og:title" content="Hello &amp; welcome">
  <meta property="og:description" content="The first post, with &quot;quotes&quot;.">
  <meta property="og:image" content="https://blog.example.com/cards/hello.png">
  <meta property="og:image" content="https://blog.example.com/cards/second.png">
  <meta property="og:site_name" content="Example Blog">
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="at:canonical" content="${RECORD}">
  <meta name="at:author" content="at://${DID}">
  <meta name="at:standard.site:comments" content="at://${DID}/app.bsky.feed.post/3kxyz">
</head><body><svg><title>icon</title></svg></body></html>`;

function report(html: string, url = PAGE): PageReport {
  return { url, fetched: true, ...readPage(html) };
}

const statusOf = (html: string, id: string) => buildPageChecks(report(html)).find((c) => c.id === id)?.status;

test('normalizePageUrl accepts web addresses and nothing else', () => {
  assert.deepEqual(normalizePageUrl(' example.com/post '), { ok: true, url: 'https://example.com/post' });
  assert.deepEqual(normalizePageUrl('http://example.com'), { ok: true, url: 'http://example.com/' });
  assert.equal(normalizePageUrl('').ok, false);
  assert.equal(normalizePageUrl('at://did:plc:abc/app.bsky.feed.post/1').ok, false);
  assert.equal(normalizePageUrl('ftp://example.com/file').ok, false);
  assert.equal(normalizePageUrl('localhost').ok, false);
});

test('readPage reads the card fields, decoded, and the first of a repeated one', () => {
  const { meta } = readPage(FULL);
  assert.equal(meta.title, 'Hello & welcome | Example Blog');
  assert.equal(meta.description, 'A plain description.');
  assert.equal(meta.canonical, 'https://blog.example.com/posts/hello');
  assert.equal(meta.og.title, 'Hello & welcome');
  assert.equal(meta.og.description, 'The first post, with "quotes".');
  assert.equal(meta.og.image, 'https://blog.example.com/cards/hello.png');
  assert.equal(meta.og.siteName, 'Example Blog');
  assert.equal(meta.og.type, 'article');
  assert.equal(meta.twitter.card, 'summary_large_image');
});

test('readPage tolerates attribute order, quoting and the name/property mix-up', () => {
  const { meta } = readPage(
    `<meta content='Single quoted' property='og:title' /><meta name="og:description" content=Unquoted>`,
  );
  assert.equal(meta.og.title, 'Single quoted');
  assert.equal(meta.og.description, 'Unquoted');
});

test('the declared records come back grouped, in order, with the primary one named', () => {
  const reading = readPage(FULL);
  assert.deepEqual(reading.tags.canonical, [RECORD]);
  assert.deepEqual(reading.tags.author, [`at://${DID}`]);
  assert.deepEqual(reading.tags.namespaces, {
    'standard.site': { comments: [`at://${DID}/app.bsky.feed.post/3kxyz`] },
  });
  assert.equal(reading.primary, RECORD);
  assert.deepEqual(reading.ignored, []);
  assert.deepEqual(
    declaredRecords(reading).map((r) => r.name),
    ['at:canonical', 'at:author', 'at:standard.site:comments'],
  );
});

test('at: tags the parser drops are reported with the reason', () => {
  const reading = readPage(
    `<meta name="at:canonical" content="https://example.com/not-an-at-uri">
     <meta name="at:related" content="${RECORD}">
     <meta name="at:alternate" content="${RECORD}">`,
  );
  assert.deepEqual(reading.tags.alternate, [RECORD]);
  assert.equal(reading.ignored.length, 2);
  assert.match(reading.ignored[0].reason, /not a valid at:\/\/ URI/);
  assert.match(reading.ignored[1].reason, /not namespaced/i);
  assert.equal(statusOf(`<meta property="og:title" content="T"><meta name="at:canonical" content="nope">`, 'tags'), 'warn');
});

test('the older link element is found, and not listed twice', () => {
  const reading = readPage(
    `<link rel="alternate" href="${RECORD}"><link rel="alternate" href="${RECORD}"><link rel="stylesheet" href="/a.css">`,
  );
  assert.deepEqual(reading.headLinks, [{ rel: 'alternate', href: RECORD }]);
  assert.equal(declaredRecords(reading).length, 1);
  const withBoth = readPage(`<meta name="at:canonical" content="${RECORD}"><link rel="alternate" href="${RECORD}">`);
  assert.equal(declaredRecords(withBoth).length, 1);
});

test('the link card prefers Open Graph and falls back', () => {
  assert.deepEqual(linkCardFor(readPage(FULL), PAGE), {
    title: 'Hello & welcome',
    description: 'The first post, with "quotes".',
    image: 'https://blog.example.com/cards/hello.png',
    host: 'blog.example.com',
  });
  const fallback = linkCardFor(
    readPage(`<title>Only a title</title><meta name="description" content="Plain."><meta name="twitter:image" content="/t.png">`),
    'https://www.example.com/a/b',
  );
  assert.deepEqual(fallback, {
    title: 'Only a title',
    description: 'Plain.',
    image: 'https://www.example.com/t.png',
    host: 'example.com',
  });
  assert.equal(absoluteImage('data:image/png;base64,AAAA', PAGE), null);
  assert.equal(absoluteImage(null, PAGE), null);
});

test('a complete page passes, and says how many records it declares', () => {
  const checks = buildPageChecks(report(FULL));
  assert.deepEqual(
    checks.map((c) => [c.id, c.status]),
    [
      ['fetch', 'pass'],
      ['title', 'pass'],
      ['description', 'pass'],
      ['image', 'pass'],
      ['tags', 'pass'],
    ],
  );
  const verdict = pageVerdict(report(FULL), checks);
  assert.equal(verdict.tone, 'pass');
  assert.match(verdict.text, /3 at:\/\/ URIs/);
});

test('missing and weak card fields are graded', () => {
  assert.equal(statusOf('<title>Only a title</title>', 'title'), 'warn');
  assert.equal(statusOf('<p>nothing</p>', 'title'), 'fail');
  assert.equal(statusOf('<meta name="description" content="Plain.">', 'description'), 'warn');
  assert.equal(statusOf('<p>nothing</p>', 'description'), 'warn');
  assert.equal(statusOf('<p>nothing</p>', 'image'), 'info');
  assert.equal(statusOf('<meta property="og:image" content="/card.png">', 'image'), 'warn');
  assert.equal(statusOf('<meta property="og:image" content="http://example.com/card.png">', 'image'), 'warn');
  assert.equal(statusOf('<meta name="twitter:image" content="https://example.com/card.png">', 'image'), 'warn');
  assert.equal(statusOf('<p>nothing</p>', 'tags'), 'info');
  assert.equal(pageVerdict(report('<p>nothing</p>'), buildPageChecks(report('<p>nothing</p>'))).tone, 'fail');
});

test('a page that could not be read fails once and skips the rest', () => {
  const unread: PageReport = { url: PAGE, fetched: false };
  const checks = buildPageChecks(unread);
  assert.equal(checks[0].status, 'fail');
  assert.ok(checks.slice(1).every((c) => c.status === 'skip'));
  assert.equal(pageVerdict(unread, checks).tone, 'fail');
  assert.ok(buildPageChecks(undefined).every((c) => c.status === 'pending'));
  assert.equal(pageVerdict(undefined, buildPageChecks(undefined)).tone, 'pending');
  assert.equal(buildPageChecks(null)[0].status, 'fail');
});

test('a page of unclosed tags is scanned in bounded time', () => {
  const hostile = '<meta '.repeat(100_000);
  const started = Date.now();
  const reading = readPage(hostile);
  assert.equal(reading.meta.og.title, null);
  assert.ok(Date.now() - started < 5000);
});

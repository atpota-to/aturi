/**
 * The page checker's logic: what a web page says about itself to the
 * Atmosphere, read out of its HTML.
 *
 * Two things matter to a client that is handed a link:
 *
 *   The link card. Clients draw one from the page's Open Graph tags
 *   (`og:title`, `og:description`, `og:image`), falling back to the Twitter
 *   card tags and the plain `<title>` and description where those are
 *   missing.
 *
 *   The record behind the page. A page can say which atproto record it is a
 *   view of with AT Tags, `<meta name="at:canonical" content="at://…">` and
 *   its siblings (https://tangled.org/chrisshank.com/at-tags/), or with the
 *   older `<link href="at://…">` some publishing tools write. The tags are
 *   parsed by the same module the rest of the site uses
 *   (src/utils/atproto/atTags.ts); this adds the ones that parser dropped,
 *   since a tag that is silently ignored is exactly what someone debugging
 *   their page needs to see.
 *
 * Pure: the server route (src/app/api/tools/page) fetches the HTML and calls
 * `readPage`; the page calls the rest on what comes back.
 */

import {
  isValidAtUri,
  parseAtTagName,
  parseAtTagsFromHtml,
  primaryRecordFromAtTags,
} from '@/utils/atproto/atTags';

export type PageInput = { ok: true; url: string } | { ok: false; reason: string };

/** Tidy what was typed into an http(s) URL. A bare host gains `https://`. */
export function normalizePageUrl(raw: string): PageInput {
  let value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter the address of a web page.' };
  if (/^at:\/\//i.test(value) || /^did:/i.test(value)) {
    return { ok: false, reason: 'That is an atproto identifier. Enter the address of a web page.' };
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'That is not a well-formed URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https pages can be read.' };
  }
  if (!url.hostname.includes('.')) {
    return { ok: false, reason: 'Enter a full address, such as https://example.com/post.' };
  }
  return { ok: true, url: url.toString() };
}

/* -------------------------------------------------------------------------- *
 * What the server route reports
 * -------------------------------------------------------------------------- */

export type PageMeta = {
  /** The `<title>` element. */
  title: string | null;
  /** `<meta name="description">`. */
  description: string | null;
  /** `<link rel="canonical">`, as written. */
  canonical: string | null;
  og: {
    title: string | null;
    description: string | null;
    image: string | null;
    siteName: string | null;
    type: string | null;
    url: string | null;
  };
  twitter: {
    card: string | null;
    title: string | null;
    description: string | null;
    image: string | null;
  };
};

/** The grouped shape /api/at-tags returns. */
export type PageAtTags = {
  canonical: string[];
  alternate: string[];
  author: string[];
  me: string[];
  namespaces: Record<string, Record<string, string[]>>;
};

/** An `at:` meta tag the parser dropped, and why. */
export type IgnoredAtTag = { name: string; content: string; reason: string };

/** A `<link href="at://…">`, the convention that predates AT Tags. */
export type AtHeadLink = { rel: string | null; href: string };

export type PageReading = {
  meta: PageMeta;
  tags: PageAtTags;
  /** The one record the page is about: `at:canonical`, then `at:alternate`. */
  primary: string | null;
  ignored: IgnoredAtTag[];
  headLinks: AtHeadLink[];
};

export type PageReport =
  | ({ url: string; fetched: true } & PageReading)
  /** The page could not be read as HTML: blocked, timed out, or not a web page. */
  | { url: string; fetched: false };

/* -------------------------------------------------------------------------- *
 * Reading the HTML
 * -------------------------------------------------------------------------- */

/**
 * Tag bodies are bounded rather than `[^>]*`, for the reason atTags.ts gives
 * at length: unbounded, a page of unclosed `<meta ` is quadratic to scan, and
 * the page is whatever URL an anonymous caller named. 2,000 characters is far
 * past any real tag and keeps the scan linear.
 */
const META_TAG = /<meta\b[^>]{0,2000}?>/gi;
const LINK_TAG = /<link\b[^>]{0,2000}?>/gi;
const TITLE_TAG = /<title\b[^>]{0,200}>([^<]{0,1000})<\/title\s*>/i;

/** Nothing shown on the page needs more of a field than this. */
const MAX_FIELD = 600;

function readAttribute(tag: string, attr: string): string | null {
  const match = tag.match(new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'\`=<>]+))`, 'i'));
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function codePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** `&amp;` goes last, so `&amp;quot;` stays the text `&quot;`. */
function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, MAX_FIELD) : null;
}

/** Read everything the checker reports out of a page's HTML. */
export function readPage(html: string): PageReading {
  // The first value wins: a page that repeats og:image means the first as
  // its card image and the rest as alternates.
  const fields = new Map<string, string>();
  const ignored: IgnoredAtTag[] = [];

  for (const tag of html.match(META_TAG) ?? []) {
    const rawName = readAttribute(tag, 'property') ?? readAttribute(tag, 'name');
    if (!rawName) continue;
    const name = decodeEntities(rawName).trim();
    const content = readAttribute(tag, 'content');
    const key = name.toLowerCase();
    const value = clean(content);
    if (value && !fields.has(key)) fields.set(key, value);

    if (/^at:/i.test(name)) {
      const text = value ?? '';
      if (!parseAtTagName(name)) {
        ignored.push({
          name,
          content: text,
          reason: 'Not one of at:canonical, at:alternate, at:author or at:me, and not namespaced as at:{namespace}:{property}.',
        });
      } else if (!isValidAtUri(text)) {
        ignored.push({ name, content: text, reason: 'The content is not a valid at:// URI.' });
      }
    }
  }

  let canonical: string | null = null;
  const headLinks: AtHeadLink[] = [];
  for (const tag of html.match(LINK_TAG) ?? []) {
    const href = clean(readAttribute(tag, 'href'));
    if (!href) continue;
    const rel = clean(readAttribute(tag, 'rel'));
    if (/^at:\/\//i.test(href)) {
      if (!headLinks.some((link) => link.href === href)) headLinks.push({ rel, href });
    } else if (canonical === null && rel?.toLowerCase().split(' ').includes('canonical')) {
      canonical = href;
    }
  }

  const parsed = parseAtTagsFromHtml(html);
  const get = (key: string) => fields.get(key) ?? null;
  return {
    meta: {
      title: clean(html.match(TITLE_TAG)?.[1]),
      description: get('description'),
      canonical,
      og: {
        title: get('og:title'),
        description: get('og:description'),
        image: get('og:image') ?? get('og:image:url') ?? get('og:image:secure_url'),
        siteName: get('og:site_name'),
        type: get('og:type'),
        url: get('og:url'),
      },
      twitter: {
        card: get('twitter:card'),
        title: get('twitter:title'),
        description: get('twitter:description'),
        image: get('twitter:image') ?? get('twitter:image:src'),
      },
    },
    tags: {
      canonical: parsed.canonical,
      alternate: parsed.alternate,
      author: parsed.author,
      me: parsed.me,
      namespaces: parsed.namespaces,
    },
    primary: primaryRecordFromAtTags(parsed),
    ignored,
    headLinks,
  };
}

/* -------------------------------------------------------------------------- *
 * The link card
 * -------------------------------------------------------------------------- */

export type LinkCard = {
  title: string | null;
  description: string | null;
  /** The image as an absolute URL, or null when there is none to draw. */
  image: string | null;
  /** The page's hostname, without `www.`. */
  host: string;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Resolve an image address against the page it came from. Null when it cannot be. */
export function absoluteImage(image: string | null, pageUrl: string): string | null {
  if (!image) return null;
  try {
    const url = new URL(image, pageUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The card a client would draw: Open Graph first, then the fallbacks. */
export function linkCardFor(reading: PageReading, pageUrl: string): LinkCard {
  const { meta } = reading;
  return {
    title: meta.og.title ?? meta.twitter.title ?? meta.title,
    description: meta.og.description ?? meta.twitter.description ?? meta.description,
    image: absoluteImage(meta.og.image ?? meta.twitter.image, pageUrl),
    host: hostOf(pageUrl),
  };
}

/* -------------------------------------------------------------------------- *
 * The records the page declares
 * -------------------------------------------------------------------------- */

export type DeclaredRecord = {
  /** The tag as written, e.g. `at:canonical`, or `link` for the older form. */
  name: string;
  /** What the relation means, in a few words. */
  meaning: string;
  uri: string;
};

const RELATION_MEANING: Record<string, string> = {
  canonical: 'The record this page is a view of',
  alternate: 'Another record with the same content',
  author: 'Who wrote it',
  me: 'The identity behind the site',
};

export function declaredRecords(reading: PageReading): DeclaredRecord[] {
  const out: DeclaredRecord[] = [];
  for (const relation of ['canonical', 'alternate', 'author', 'me'] as const) {
    for (const uri of reading.tags[relation]) {
      out.push({ name: `at:${relation}`, meaning: RELATION_MEANING[relation], uri });
    }
  }
  for (const [namespace, properties] of Object.entries(reading.tags.namespaces)) {
    for (const [property, uris] of Object.entries(properties)) {
      for (const uri of uris) {
        out.push({ name: `at:${namespace}:${property}`, meaning: `A ${namespace} relation`, uri });
      }
    }
  }
  for (const link of reading.headLinks) {
    if (out.some((record) => record.uri === link.href)) continue;
    out.push({
      name: link.rel ? `link rel="${link.rel}"` : 'link',
      meaning: 'A link element, the convention before AT Tags',
      uri: link.href,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- *
 * The check list
 * -------------------------------------------------------------------------- */

export type PageCheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'skip' | 'pending';

export type PageCheck = {
  id: 'fetch' | 'title' | 'description' | 'image' | 'tags' | 'link';
  status: PageCheckStatus;
  title: string;
  summary: string;
  detail?: string[];
  fix?: string[];
};

export type PageVerdict = {
  tone: 'pass' | 'warn' | 'fail' | 'pending';
  title: string;
  text: string;
};

const TITLES: Record<PageCheck['id'], string> = {
  fetch: 'Page loads',
  title: 'Title',
  description: 'Description',
  image: 'Image',
  tags: 'AT Tags',
  link: 'Link element',
};

const ORDER: PageCheck['id'][] = ['fetch', 'title', 'description', 'image', 'tags'];

/**
 * Build the check list. `report` undefined means the fetch is still on its
 * way; `null` means the lookup service itself failed.
 */
export function buildPageChecks(report: PageReport | null | undefined): PageCheck[] {
  if (report === undefined) {
    return ORDER.map((id) => ({ id, status: 'pending', title: TITLES[id], summary: 'Checking…' }));
  }
  const skipRest = (): PageCheck[] =>
    ORDER.slice(1).map((id) => ({
      id,
      status: 'skip',
      title: TITLES[id],
      summary: 'Not checked, because the page could not be read.',
    }));
  if (report === null) {
    return [
      { id: 'fetch', status: 'fail', title: TITLES.fetch, summary: 'The lookup service did not answer. Try again in a moment.' },
      ...skipRest(),
    ];
  }
  if (!report.fetched) {
    return [
      {
        id: 'fetch',
        status: 'fail',
        title: TITLES.fetch,
        summary: 'The page could not be read as HTML. It may block automated requests, have timed out, or not be a web page.',
        detail: [`GET ${report.url}`],
        fix: ['A client building a link card fetches the page the same way, so a page that refuses this request gets no card either.'],
      },
      ...skipRest(),
    ];
  }

  const { meta, tags, ignored, headLinks } = report;
  const checks: PageCheck[] = [
    { id: 'fetch', status: 'pass', title: TITLES.fetch, summary: 'The page answered with HTML.', detail: [`GET ${report.url}`] },
  ];

  // ── Title ──
  if (meta.og.title) {
    checks.push({ id: 'title', status: 'pass', title: TITLES.title, summary: 'og:title is set.', detail: [meta.og.title] });
  } else if (meta.twitter.title || meta.title) {
    checks.push({
      id: 'title',
      status: 'warn',
      title: TITLES.title,
      summary: `No og:title. Clients fall back to ${meta.twitter.title ? 'twitter:title' : 'the page’s <title>, which often carries the site name as well'}.`,
      detail: [meta.twitter.title ?? (meta.title as string)],
      fix: ['Add <meta property="og:title" content="…"> with the title as it should read on a card.'],
    });
  } else {
    checks.push({
      id: 'title',
      status: 'fail',
      title: TITLES.title,
      summary: 'The page has no title at all, so a card has nothing to show but the address.',
      fix: ['Add <meta property="og:title" content="…">, and a <title> element.'],
    });
  }

  // ── Description ──
  if (meta.og.description) {
    checks.push({
      id: 'description',
      status: 'pass',
      title: TITLES.description,
      summary: 'og:description is set.',
      detail: [meta.og.description],
    });
  } else if (meta.twitter.description || meta.description) {
    checks.push({
      id: 'description',
      status: 'warn',
      title: TITLES.description,
      summary: `No og:description. Clients that fall back read ${meta.twitter.description ? 'twitter:description' : 'the plain description meta tag'}; others show none.`,
      detail: [meta.twitter.description ?? (meta.description as string)],
      fix: ['Add <meta property="og:description" content="…">.'],
    });
  } else {
    checks.push({
      id: 'description',
      status: 'warn',
      title: TITLES.description,
      summary: 'No description. The card shows the title alone.',
      fix: ['Add <meta property="og:description" content="…"> with a sentence or two.'],
    });
  }

  // ── Image ──
  const image = meta.og.image ?? meta.twitter.image;
  if (!image) {
    checks.push({
      id: 'image',
      status: 'info',
      title: TITLES.image,
      summary: 'No og:image, so the card is drawn as text only.',
    });
  } else if (!meta.og.image) {
    checks.push({
      id: 'image',
      status: 'warn',
      title: TITLES.image,
      summary: 'No og:image. There is a twitter:image, which only some clients read.',
      detail: [image],
      fix: ['Add <meta property="og:image" content="…"> with the same address.'],
    });
  } else if (!/^https:\/\//i.test(image)) {
    checks.push({
      id: 'image',
      status: 'warn',
      title: TITLES.image,
      summary: /^http:\/\//i.test(image)
        ? 'og:image is a plain http address. Clients that fetch images over https only will not show it.'
        : 'og:image is not an absolute address. A client that does not resolve it against the page shows no image.',
      detail: [image],
      fix: ['Give og:image as a full https URL.'],
    });
  } else {
    checks.push({
      id: 'image',
      status: 'pass',
      title: TITLES.image,
      summary: 'og:image is an absolute https address.',
      detail: [image],
    });
  }

  // ── AT Tags ──
  const declared = tags.canonical.length + tags.alternate.length + tags.author.length + tags.me.length +
    Object.values(tags.namespaces).reduce(
      (sum, properties) => sum + Object.values(properties).reduce((n, uris) => n + uris.length, 0),
      0,
    );
  const ignoredDetail = ignored.map((tag) => `${tag.name} = ${tag.content || '(empty)'} → ${tag.reason}`);
  if (ignored.length > 0) {
    checks.push({
      id: 'tags',
      status: 'warn',
      title: TITLES.tags,
      summary: `${ignored.length === 1 ? 'One at: tag is' : `${ignored.length} at: tags are`} ignored${declared ? `, beside ${declared} that ${declared === 1 ? 'reads' : 'read'} correctly` : ''}.`,
      detail: ignoredDetail,
      fix: ['Each tag is <meta name="at:canonical" content="at://<did>/<collection>/<rkey>">, with a DID or handle as the authority.'],
    });
  } else if (declared > 0) {
    checks.push({
      id: 'tags',
      status: 'pass',
      title: TITLES.tags,
      summary: `The page declares ${declared === 1 ? 'one at:// URI' : `${declared} at:// URIs`}${report.primary ? ', and names the record it is a view of' : ''}.`,
    });
  } else {
    checks.push({
      id: 'tags',
      status: 'info',
      title: TITLES.tags,
      summary: headLinks.length
        ? 'No at: meta tags. The page points at a record with a link element instead.'
        : 'The page declares no at:// records. That only matters when there is a record behind it.',
    });
  }

  if (headLinks.length > 0) {
    checks.push({
      id: 'link',
      status: 'info',
      title: TITLES.link,
      summary: 'The page carries a <link> to an at:// URI, the convention some publishing tools used before AT Tags.',
      detail: headLinks.map((link) => `${link.rel ? `rel="${link.rel}" ` : ''}${link.href}`),
    });
  }

  return checks;
}

export function pageVerdict(report: PageReport | null | undefined, checks: PageCheck[]): PageVerdict {
  if (report === undefined || checks.some((c) => c.status === 'pending')) {
    return { tone: 'pending', title: 'Fetching the page', text: 'Reading its Open Graph tags and at: meta tags.' };
  }
  if (!report || !report.fetched) {
    return {
      tone: 'fail',
      title: 'This page could not be read',
      text: checks[0]?.summary ?? 'The page did not answer.',
    };
  }
  const failures = checks.filter((c) => c.status === 'fail');
  if (failures.length > 0) {
    return { tone: 'fail', title: 'This page gives a client nothing to draw', text: failures[0].summary };
  }
  const records = declaredRecords(report).length;
  const recordText = records
    ? `It declares ${records === 1 ? 'one at:// URI' : `${records} at:// URIs`}.`
    : 'It declares no at:// records.';
  const warnings = checks.filter((c) => c.status === 'warn');
  if (warnings.length > 0) {
    return {
      tone: 'warn',
      title: `The page has a link card, with ${warnings.length === 1 ? 'one thing' : `${warnings.length} things`} to look at`,
      text: `${warnings[0].summary} ${recordText}`,
    };
  }
  return { tone: 'pass', title: 'The page presents a complete link card', text: recordText };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWN_SOFTWARE_NAMES,
  PDS_SOFTWARE,
  RECENT_RELEASE_MS,
  REFERENCE_FLOOR,
  compareVersions,
  decodeDistributionVersion,
  formatReleaseDay,
  formatSpan,
  isPdsSoftwareId,
  pdsVersionBadge,
  pdsVersionVerdict,
  readPackument,
  readReleaseList,
  readReportedVersion,
  readTagRefs,
  softwareOf,
  versionStanding,
  type PdsReleaseList,
  type PdsSoftwareId,
} from '@/lib/tools/pdsVersion';

const HOST = 'pds.example.com';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso: string) => Date.parse(iso);

/**
 * The registry's document, cut down to the parts read: versions out of
 * order, pre-releases among them, and one release published before the one
 * numbered below it, as 0.5.51 was.
 */
const PACKUMENT = {
  'dist-tags': { latest: '0.5.65', next: '0.4.223-next.0' },
  versions: {
    '0.5.64': {},
    '0.1.0': {},
    '0.4.219': {},
    '0.4.0-beta.7': {},
    '0.5.61': {},
    '0.5.62': {},
    '0.0.0-spaces-alpha-20261117141222': {},
    '0.5.63': {},
    '0.5.65': {},
    '0.5.9': {},
    '0.5.10': {},
  },
  time: {
    created: '2023-01-01T00:00:00.000Z',
    modified: '2026-11-23T23:02:53.019Z',
    '0.1.0': '2023-05-01T00:00:00.000Z',
    '0.4.219': '2026-04-01T00:00:00.000Z',
    '0.5.9': '2026-06-20T00:00:00.000Z',
    '0.5.10': '2026-06-22T00:00:00.000Z',
    '0.5.61': '2026-11-17T18:41:05.074Z',
    // Published before the release numbered below it.
    '0.5.63': '2026-11-19T12:00:00.000Z',
    '0.5.62': '2026-11-19T23:51:28.628Z',
    '0.5.64': '2026-11-20T17:08:10.000Z',
    '0.5.65': '2026-11-23T23:02:53.019Z',
  },
};

const LIST = readPackument('reference', PACKUMENT) as PdsReleaseList;
const NOW = at('2026-11-24T18:00:00.000Z');

const SHA = '41b458b5a31127b8ec9481c15156006d39b32d04';
const line = (ref: string) => `003e${SHA} ${ref}\n`;

/**
 * A git host's ref list as it arrives: the service line, HEAD with the
 * server's capabilities after a NUL, then a line a ref. The tags are the odd
 * ones real repositories have: Cocoon's two-part `v0.15`, the same release
 * tagged with and without a `v`, a tag that is not a version, a peeled
 * annotated tag, and a pre-release as Tangled's knots had before 1.20.
 */
const REFS =
  '001e# service=git-upload-pack\n0000' +
  `00c8${SHA} HEAD\0multi_ack_detailed side-band-64k agent=git/2 symref=HEAD:refs/heads/main\n` +
  line('refs/heads/main') +
  line('refs/heads/v9.9.9') +
  line('refs/pull/12/head') +
  line('refs/tags/0.5.1') +
  line('refs/tags/list') +
  line('refs/tags/v0.14.4') +
  line('refs/tags/v0.14.4^{}') +
  line('refs/tags/v0.15') +
  line('refs/tags/v0.5.1') +
  line('refs/tags/v0.9.0') +
  line('refs/tags/v1.16.1-alpha') +
  '0000';

const tags = (software: PdsSoftwareId) => readTagRefs(software, REFS) as PdsReleaseList;

test('compareVersions orders by number, not by text', () => {
  assert.ok(compareVersions('0.5.10', '0.5.9') > 0);
  assert.ok(compareVersions('0.4.226', '0.5.0') < 0);
  assert.equal(compareVersions('0.5.65', '0.5.65'), 0);
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.ok(compareVersions('not-a-version', '0.0.1') < 0);
});

test('the distribution’s numbering decodes to the package version it stands for', () => {
  // The example in the distribution's own source.
  assert.equal(decodeDistributionVersion('0.4.5001'), '0.5.1');
  assert.equal(decodeDistributionVersion('0.4.5065'), '0.5.65');
  assert.equal(decodeDistributionVersion('0.4.10003'), '0.10.3');
  // A plain release number, another base, and a zero minor are not in that form.
  assert.equal(decodeDistributionVersion('0.4.219'), null);
  assert.equal(decodeDistributionVersion('0.5.5065'), null);
  assert.equal(decodeDistributionVersion('0.4.0065'), null);
  assert.equal(decodeDistributionVersion('tranquil 0.9.0'), null);
});

test('every software has one fixed https source, and a name of its own', () => {
  const sources = new Set<string>();
  const prefixes = new Set<string>();
  for (const [id, software] of Object.entries(PDS_SOFTWARE)) {
    assert.equal(software.id, id);
    assert.ok(isPdsSoftwareId(id));
    const url =
      software.source.kind === 'npm'
        ? `https://registry.npmjs.org/${software.source.package}`
        : software.source.refs;
    assert.match(url, /^https:\/\/(registry\.npmjs\.org|github\.com|tangled\.org)\//, `${id} reads a host on the list`);
    if (software.source.kind === 'git') assert.ok(url.endsWith('/info/refs?service=git-upload-pack'));
    assert.ok(!sources.has(url), `${id} has a source of its own`);
    sources.add(url);
    assert.match(software.releasesUrl, /^https:\/\//);
    // Only the reference PDS reports a number alone.
    assert.equal(software.prefix === null, id === 'reference');
    if (software.prefix) {
      assert.match(software.prefix, /^[a-z]+$/);
      assert.ok(!prefixes.has(software.prefix), `${id} has a prefix of its own`);
      prefixes.add(software.prefix);
    }
    assert.ok(KNOWN_SOFTWARE_NAMES.includes(software.name));
  }
  assert.equal(isPdsSoftwareId('rsky'), false);
  assert.equal(isPdsSoftwareId('toString'), false);
});

test('softwareOf says whose releases a version could be among', () => {
  assert.equal(softwareOf('0.5.65'), 'reference');
  assert.equal(softwareOf(' 0.4.5065 '), 'reference');
  assert.equal(softwareOf('tranquil 0.9.1'), 'tranquil');
  assert.equal(softwareOf('cirrus 0.19.0'), 'cirrus');
  assert.equal(softwareOf('cocoon v0.15-0-gec9eb18'), 'cocoon');
  assert.equal(softwareOf('cocoon dev'), 'cocoon');
  assert.equal(softwareOf('knot 1.20.1'), 'knot');
  // A commit hash, software not listed, and a name with nothing after it.
  assert.equal(softwareOf('693d745178e941f5e377e48c9253236edb791b28'), null);
  assert.equal(softwareOf('pegasus 2174883'), null);
  assert.equal(softwareOf('1.3.0+91fa452'), null);
  assert.equal(softwareOf('tranquil'), null);
  assert.equal(softwareOf('Tranquil 0.9.1'), null);
  assert.equal(softwareOf(''), null);
  assert.equal(softwareOf(undefined), null);
});

test('readPackument keeps the stable releases, in version order, with their dates', () => {
  assert.equal(LIST.software, 'reference');
  assert.equal(LIST.latest, '0.5.65');
  assert.deepEqual(
    LIST.releases.map((r) => r.version),
    ['0.1.0', '0.4.219', '0.5.9', '0.5.10', '0.5.61', '0.5.62', '0.5.63', '0.5.64', '0.5.65'],
  );
  assert.equal(LIST.releases.at(-1)?.published, at('2026-11-23T23:02:53.019Z'));
});

test('readPackument gives up rather than guess a latest', () => {
  assert.equal(readPackument('reference', null), null);
  assert.equal(readPackument('reference', { versions: { '0.5.65': {} }, time: {} }), null);
  // A latest that is a pre-release, or that the document does not list.
  assert.equal(readPackument('reference', { ...PACKUMENT, 'dist-tags': { latest: '0.4.0-beta.7' } }), null);
  assert.equal(readPackument('reference', { ...PACKUMENT, 'dist-tags': { latest: '9.9.9' } }), null);
  // A release with no date is kept, without one.
  const undated = readPackument('cirrus', { 'dist-tags': { latest: '0.19.0' }, versions: { '0.19.0': {} } });
  assert.deepEqual(undated, { software: 'cirrus', latest: '0.19.0', releases: [{ version: '0.19.0', published: null }] });
});

test('readTagRefs reads a git host’s tags as releases, and only the ones that are versions', () => {
  const list = tags('cocoon');
  assert.equal(list.software, 'cocoon');
  // Two-part tags are read as three, the twice-tagged release is one, and a
  // branch named like a version is not a tag.
  assert.deepEqual(
    list.releases.map((r) => r.version),
    ['0.5.1', '0.9.0', '0.14.4', '0.15.0'],
  );
  assert.equal(list.latest, '0.15.0');
  // A tag has no date in this list.
  assert.ok(list.releases.every((r) => r.published === null));
});

test('readTagRefs gives up on a list with no release in it', () => {
  assert.equal(readTagRefs('tranquil', ''), null);
  assert.equal(readTagRefs('tranquil', '001e# service=git-upload-pack\n0000' + line('refs/heads/main') + '0000'), null);
  assert.equal(readTagRefs('knot', line('refs/tags/v1.16.1-alpha') + line('refs/tags/nightly')), null);
  assert.equal(readTagRefs('tranquil', '<!doctype html><title>Not found</title>'), null);
});

test('readReleaseList reads back what the route sends, and nothing else', () => {
  assert.deepEqual(readReleaseList(JSON.parse(JSON.stringify({ ok: true, ...LIST }))), LIST);
  assert.deepEqual(readReleaseList(JSON.parse(JSON.stringify({ ok: true, ...tags('tranquil') }))), tags('tranquil'));
  assert.equal(readReleaseList({ ok: false, code: 'upstream_error', error: 'no' }), null);
  assert.equal(readReleaseList({ ...LIST, software: 'rsky' }), null);
  assert.equal(readReleaseList({ software: 'reference', latest: '0.5.65', releases: [{ version: 'latest', published: 1 }] }), null);
  assert.equal(readReleaseList({ ...LIST, latest: '0.5.66' }), null);
});

test('a plain number is read as a release only when the registry lists it', () => {
  assert.deepEqual(readReportedVersion('0.5.61', LIST), {
    kind: 'release',
    software: 'reference',
    reported: '0.5.61',
    version: '0.5.61',
    via: 'package',
    ahead: 0,
  });
  assert.deepEqual(readReportedVersion(' 0.4.5065\n', LIST), {
    kind: 'release',
    software: 'reference',
    reported: '0.4.5065',
    version: '0.5.65',
    via: 'distribution',
    ahead: 0,
  });
  // Numbers other software reports (rsky-pds, pds.js), and a 0.5 number that
  // was never published. A number alone names no software.
  assert.deepEqual(readReportedVersion('1.14.19', LIST), { kind: 'other', reported: '1.14.19', software: null });
  assert.deepEqual(readReportedVersion('2.5.2', LIST), { kind: 'other', reported: '2.5.2', software: null });
  assert.deepEqual(readReportedVersion('0.5.32', LIST), { kind: 'other', reported: '0.5.32', software: null });
  // In the distribution's form, but standing for no release.
  assert.deepEqual(readReportedVersion('0.4.5099', LIST), { kind: 'other', reported: '0.4.5099', software: null });
});

test('a number from before self-hosting is not read as a release, though the registry lists it', () => {
  assert.equal(REFERENCE_FLOOR, '0.4.0');
  assert.ok(LIST.releases.some((r) => r.version === '0.1.0'));
  assert.deepEqual(readReportedVersion('0.1.0', LIST), { kind: 'other', reported: '0.1.0', software: null });
  assert.equal(readReportedVersion('0.4.219', LIST)?.kind, 'release');
});

test('a version with a known name is read against that software’s releases', () => {
  const tranquil = tags('tranquil');
  assert.deepEqual(readReportedVersion('tranquil 0.9.0', tranquil), {
    kind: 'release',
    software: 'tranquil',
    reported: 'tranquil 0.9.0',
    version: '0.9.0',
    via: 'name',
    ahead: 0,
  });
  // Named, but not a release that is tagged.
  assert.deepEqual(readReportedVersion('tranquil 0.2.9', tranquil), {
    kind: 'other',
    reported: 'tranquil 0.2.9',
    software: 'tranquil',
  });
  // A pre-release or a fork's own suffix is not the release it is based on.
  assert.equal(readReportedVersion('cirrus 0.14.4-fork.3', tags('cirrus'))?.kind, 'other');
  assert.equal(readReportedVersion('knot 2.0.0', tags('knot'))?.kind, 'other');
});

test('Cocoon’s builds are read by tag: plain, two-part, or as git describes a commit', () => {
  const cocoon = tags('cocoon');
  const read = (reported: string) => readReportedVersion(reported, cocoon);
  assert.deepEqual(read('cocoon 0.14.4'), {
    kind: 'release',
    software: 'cocoon',
    reported: 'cocoon 0.14.4',
    version: '0.14.4',
    via: 'name',
    ahead: 0,
  });
  // `0.15.0` is the release tagged `v0.15`.
  assert.equal((read('cocoon 0.15.0') as { version: string }).version, '0.15.0');
  assert.equal((read('cocoon v0.15') as { version: string }).version, '0.15.0');
  // At a tag, and four commits past one.
  assert.deepEqual(read('cocoon v0.15-0-gec9eb18'), {
    kind: 'release',
    software: 'cocoon',
    reported: 'cocoon v0.15-0-gec9eb18',
    version: '0.15.0',
    via: 'name',
    ahead: 0,
  });
  const past = read('cocoon v0.9.0-4-g4bd740d');
  assert.ok(past?.kind === 'release');
  assert.equal(past.version, '0.9.0');
  assert.equal(past.ahead, 4);
  // A build with no tag to go by: a hash, `dev`, or a describe from a tag
  // that is not a version.
  for (const reported of ['cocoon dev', 'cocoon ec9eb18', 'cocoon dev-1667274ab', 'cocoon list-50-g1c70183']) {
    assert.deepEqual(read(reported), { kind: 'other', reported, software: 'cocoon' });
  }
});

test('a reading waits for the list it needs, and only then', () => {
  // Needs a list, and has none or another software's.
  assert.equal(readReportedVersion('0.5.61', null), null);
  assert.equal(readReportedVersion('tranquil 0.9.0', null), null);
  assert.equal(readReportedVersion('tranquil 0.9.0', LIST), null);
  assert.equal(readReportedVersion('0.5.61', tags('tranquil')), null);
  // Needs none.
  const hash = '693d745178e941f5e377e48c9253236edb791b28';
  assert.deepEqual(readReportedVersion(hash, null), { kind: 'commit', reported: hash });
  assert.deepEqual(readReportedVersion('pegasus 2174883', null), {
    kind: 'other',
    reported: 'pegasus 2174883',
    software: null,
  });
  assert.deepEqual(readReportedVersion('0.4.0-beta.7', null), { kind: 'other', reported: '0.4.0-beta.7', software: null });
  assert.deepEqual(readReportedVersion('', null), { kind: 'none' });
  assert.deepEqual(readReportedVersion(undefined, LIST), { kind: 'none' });
  // The host writes the string, so what is shown of it is bounded.
  const long = readReportedVersion('x'.repeat(500), null);
  assert.ok(long?.kind === 'other' && long.reported.length <= 81);
});

test('versionStanding counts the releases between, and dates the first of them', () => {
  assert.deepEqual(versionStanding('0.5.65', LIST, NOW)?.state, 'current');
  assert.equal(versionStanding('0.5.32', LIST, NOW), null);

  const behind = versionStanding('0.5.61', LIST, NOW);
  assert.ok(behind?.state === 'behind');
  assert.deepEqual(
    behind.missed.map((r) => r.version),
    ['0.5.62', '0.5.63', '0.5.64', '0.5.65'],
  );
  // 0.5.63 was published before 0.5.62: the host fell behind when it came out.
  assert.equal(behind.since, at('2026-11-19T12:00:00.000Z'));
  assert.equal(behind.recent, false);
});

test('a release that has only just been passed is not yet out of date', () => {
  const oneBehind = versionStanding('0.5.64', LIST, NOW);
  assert.ok(oneBehind?.state === 'behind');
  assert.equal(oneBehind.missed.length, 1);
  assert.equal(oneBehind.recent, true);

  const later = versionStanding('0.5.64', LIST, at('2026-11-23T23:02:53.019Z') + RECENT_RELEASE_MS);
  assert.ok(later?.state === 'behind');
  assert.equal(later.recent, false);
});

test('behind a git tag there are no dates, so no "since" and no grace', () => {
  const tranquil = tags('tranquil');
  assert.equal(versionStanding('0.15.0', tranquil, NOW)?.state, 'current');
  const behind = versionStanding('0.9.0', tranquil, NOW);
  assert.ok(behind?.state === 'behind');
  assert.deepEqual(
    behind.missed.map((r) => r.version),
    ['0.14.4', '0.15.0'],
  );
  assert.equal(behind.since, null);
  assert.equal(behind.recent, false);
});

test('a version newer than the tagged latest is ahead', () => {
  const retagged: PdsReleaseList = { ...LIST, latest: '0.5.64' };
  assert.equal(versionStanding('0.5.65', retagged, NOW)?.state, 'ahead');
});

function verdictFor(version: string | undefined, list: PdsReleaseList | null = LIST, reachable = true) {
  const reading = readReportedVersion(version, list);
  assert.ok(reading, 'the list given is the one this version needs');
  const standing = reading.kind === 'release' && list ? versionStanding(reading.version, list, NOW) : null;
  return pdsVersionVerdict(HOST, reachable, reading, standing, NOW);
}

test('the verdict says up to date, how far behind, or that it cannot tell', () => {
  const current = verdictFor('0.4.5065');
  assert.equal(current.tone, 'pass');
  assert.equal(current.title, `${HOST} is up to date`);
  assert.match(current.text, /It runs 0\.5\.65, the latest release of the reference PDS, published Nov 23, 2026\./);

  const behind = verdictFor('0.5.61');
  assert.equal(behind.tone, 'warn');
  assert.equal(behind.title, `${HOST} is 4 releases behind`);
  assert.match(behind.text, /Behind since Nov 19, 2026, when 0\.5\.63 came out \(5 days ago\)/);

  const recent = verdictFor('0.5.64');
  assert.equal(recent.tone, 'info');
  assert.equal(recent.title, `${HOST} is 1 release behind, as of 18 hours ago`);
  assert.match(recent.text, /is 0\.5\.65, and a host that updates overnight may not have it yet/);
});

test('the verdict names the software a host runs, and leaves out dates it does not have', () => {
  const current = verdictFor('cocoon v0.15-0-gec9eb18', tags('cocoon'));
  assert.equal(current.tone, 'pass');
  assert.equal(current.text, 'It runs 0.15.0, the latest release of Cocoon.');

  const behind = verdictFor('tranquil 0.9.0', tags('tranquil'));
  assert.equal(behind.tone, 'warn');
  assert.equal(behind.title, `${HOST} is 2 releases behind`);
  assert.equal(behind.text, 'It runs 0.9.0. The latest release of Tranquil is 0.15.0.');

  const unlisted = verdictFor('knot 2.0.0', tags('knot'));
  assert.equal(unlisted.tone, 'info');
  assert.match(unlisted.text, /“knot 2\.0\.0”, which isn’t a release of the Tangled knot server/);
});

test('the verdict does not compare what cannot be compared', () => {
  const commit = verdictFor('693d745178e941f5e377e48c9253236edb791b28', null);
  assert.equal(commit.tone, 'info');
  assert.match(commit.title, /reports a build, not a release/);
  assert.match(commit.text, /693d745\)/);

  const other = verdictFor('pegasus 2174883', null);
  assert.equal(other.tone, 'info');
  assert.match(other.title, /Can’t tell/);
  assert.match(other.text, /“pegasus 2174883”, which isn’t a release of the reference PDS, Tranquil,/);

  // A number other software uses is not measured against these releases.
  assert.match(verdictFor('1.14.19').title, /Can’t tell/);
  assert.match(verdictFor('1.14.19').text, /which isn’t a release of the reference PDS, Tranquil,/);
  // One the reference PDS did release, long ago, is not called "not a release".
  assert.match(verdictFor('0.1.0').text, /“0\.1\.0”, a number software reports when no version was set\. Below 0\.4\.0,/);

  assert.equal(verdictFor(undefined).tone, 'info');
  assert.match(verdictFor(undefined).title, /doesn’t report a version/);
  assert.equal(verdictFor(undefined, null, false).tone, 'fail');
  assert.match(verdictFor(undefined, null, false).title, /didn’t answer as a PDS/);
});

test('the badge marks every version: where it stands, or that this cannot say', () => {
  const badge = (version: string | undefined, list: PdsReleaseList | null = LIST) => {
    const reading = readReportedVersion(version, list);
    const standing = reading?.kind === 'release' && list ? versionStanding(reading.version, list, NOW) : null;
    return pdsVersionBadge(reading, standing, NOW);
  };
  assert.equal(badge('0.4.5065')?.tone, 'good');
  assert.equal(badge('0.4.5065')?.label, 'Up to date');
  assert.equal(badge('0.5.61')?.tone, 'warn');
  assert.equal(badge('0.5.61')?.label, '4 releases behind');
  assert.equal(badge('0.5.64')?.tone, 'quiet');
  assert.equal(badge('0.5.64')?.label, '0.5.65 is out');

  const tranquil = badge('tranquil 0.9.0', tags('tranquil'));
  assert.equal(tranquil?.tone, 'warn');
  assert.equal(tranquil?.label, '2 releases behind');
  assert.equal(tranquil?.title, 'Runs 0.9.0. The latest release of Tranquil is 0.15.0.');
  assert.equal(badge('cirrus 0.15.0', tags('cirrus'))?.label, 'Up to date');

  // What cannot be compared is marked as that, never as an answer.
  for (const version of ['693d745178e941f5e377e48c9253236edb791b28', 'pegasus 2174883', '1.14.19', '0.1.0']) {
    assert.equal(badge(version)?.tone, 'unknown', version);
    assert.equal(badge(version)?.label, 'Can’t compare', version);
  }
  assert.equal(badge('cocoon dev', tags('cocoon'))?.tone, 'unknown');
  assert.match(badge('cocoon dev', tags('cocoon'))?.title ?? '', /“cocoon dev”, which isn’t a release of Cocoon\./);

  // Nothing to mark: no version, or a list that has not arrived.
  assert.equal(badge(undefined), null);
  assert.equal(badge('tranquil 0.9.0', null), null);
  assert.equal(badge('0.5.61', null), null);
});

test('dates read as a UTC day, and spans in one unit', () => {
  assert.equal(formatReleaseDay(at('2026-11-23T23:02:53.019Z')), 'Nov 23, 2026');
  assert.equal(formatSpan(20 * 60 * 1000), 'less than an hour');
  assert.equal(formatSpan(HOUR), '1 hour');
  assert.equal(formatSpan(47 * HOUR), '47 hours');
  assert.equal(formatSpan(5 * DAY), '5 days');
  assert.equal(formatSpan(90 * DAY), '3 months');
  assert.equal(formatSpan(800 * DAY), '2 years');
});

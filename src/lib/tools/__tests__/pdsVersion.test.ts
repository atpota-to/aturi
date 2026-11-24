import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECENT_RELEASE_MS,
  compareVersions,
  couldBeRelease,
  decodeDistributionVersion,
  formatReleaseDay,
  formatSpan,
  pdsVersionBadge,
  pdsVersionVerdict,
  readPackument,
  readReleaseList,
  readReportedVersion,
  versionStanding,
  type PdsReleaseList,
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

const LIST = readPackument(PACKUMENT) as PdsReleaseList;
const NOW = at('2026-11-24T18:00:00.000Z');

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

test('couldBeRelease spares the release list for versions that never could be', () => {
  assert.equal(couldBeRelease('0.5.65'), true);
  assert.equal(couldBeRelease(' 0.4.5065 '), true);
  assert.equal(couldBeRelease('693d745178e941f5e377e48c9253236edb791b28'), false);
  assert.equal(couldBeRelease('tranquil 0.9.0'), false);
  assert.equal(couldBeRelease('1.3.0+91fa452'), false);
  assert.equal(couldBeRelease(''), false);
  assert.equal(couldBeRelease(undefined), false);
});

test('readPackument keeps the stable releases, in version order, with their dates', () => {
  assert.equal(LIST.latest, '0.5.65');
  assert.deepEqual(
    LIST.releases.map((r) => r.version),
    ['0.1.0', '0.4.219', '0.5.9', '0.5.10', '0.5.61', '0.5.62', '0.5.63', '0.5.64', '0.5.65'],
  );
  assert.equal(LIST.releases.at(-1)?.published, at('2026-11-23T23:02:53.019Z'));
});

test('readPackument gives up rather than guess a latest', () => {
  assert.equal(readPackument(null), null);
  assert.equal(readPackument({ versions: { '0.5.65': {} }, time: {} }), null);
  // A latest that is a pre-release, or that the document does not list.
  assert.equal(readPackument({ ...PACKUMENT, 'dist-tags': { latest: '0.4.0-beta.7' } }), null);
  assert.equal(readPackument({ ...PACKUMENT, 'dist-tags': { latest: '9.9.9' } }), null);
  // A release with no date is kept, without one.
  const undated = readPackument({ 'dist-tags': { latest: '0.5.65' }, versions: { '0.5.65': {} } });
  assert.deepEqual(undated, { latest: '0.5.65', releases: [{ version: '0.5.65', published: null }] });
});

test('readReleaseList reads back what the route sends, and nothing else', () => {
  assert.deepEqual(readReleaseList(JSON.parse(JSON.stringify({ ok: true, ...LIST }))), LIST);
  assert.equal(readReleaseList({ ok: false, code: 'upstream_error', error: 'no' }), null);
  assert.equal(readReleaseList({ latest: '0.5.65', releases: [{ version: 'latest', published: 1 }] }), null);
  assert.equal(readReleaseList({ latest: '0.5.66', releases: LIST.releases }), null);
});

test('a reported version is read as a release only when the registry lists it', () => {
  assert.deepEqual(readReportedVersion('0.5.61', LIST), {
    kind: 'release',
    reported: '0.5.61',
    version: '0.5.61',
    via: 'package',
  });
  assert.deepEqual(readReportedVersion(' 0.4.5065\n', LIST), {
    kind: 'release',
    reported: '0.4.5065',
    version: '0.5.65',
    via: 'distribution',
  });
  // Numbers other software reports, and a 0.5 number that was never published.
  assert.deepEqual(readReportedVersion('1.14.19', LIST), { kind: 'other', reported: '1.14.19' });
  assert.deepEqual(readReportedVersion('2.5.2', LIST), { kind: 'other', reported: '2.5.2' });
  assert.deepEqual(readReportedVersion('0.5.32', LIST), { kind: 'other', reported: '0.5.32' });
  // In the distribution's form, but standing for no release.
  assert.deepEqual(readReportedVersion('0.4.5099', LIST), { kind: 'other', reported: '0.4.5099' });
});

test('a commit hash, a named build and silence are each told apart', () => {
  const hash = '693d745178e941f5e377e48c9253236edb791b28';
  assert.deepEqual(readReportedVersion(hash, LIST), { kind: 'commit', reported: hash });
  assert.deepEqual(readReportedVersion('tranquil 0.9.0', LIST), { kind: 'other', reported: 'tranquil 0.9.0' });
  assert.deepEqual(readReportedVersion('0.4.0-beta.7', LIST), { kind: 'other', reported: '0.4.0-beta.7' });
  assert.deepEqual(readReportedVersion('', LIST), { kind: 'none' });
  assert.deepEqual(readReportedVersion(undefined, LIST), { kind: 'none' });
  // The host writes the string, so what is shown of it is bounded.
  const long = readReportedVersion('x'.repeat(500), LIST);
  assert.equal(long.kind, 'other');
  assert.ok(long.kind === 'other' && long.reported.length <= 81);
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

  const far = versionStanding('0.1.0', LIST, NOW);
  assert.ok(far?.state === 'behind');
  assert.equal(far.missed.length, 8);
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

test('a version newer than the tagged latest is ahead, and a release with no date has no "since"', () => {
  const retagged: PdsReleaseList = { ...LIST, latest: '0.5.64' };
  assert.equal(versionStanding('0.5.65', retagged, NOW)?.state, 'ahead');

  const undated: PdsReleaseList = {
    latest: '0.5.65',
    releases: LIST.releases.map((r) => (r.version === '0.5.63' ? { ...r, published: null } : r)),
  };
  const behind = versionStanding('0.5.61', undated, NOW);
  assert.ok(behind?.state === 'behind');
  assert.equal(behind.since, null);
  assert.equal(behind.recent, false);
});

function verdictFor(version: string | undefined, reachable = true) {
  const reading = readReportedVersion(version, LIST);
  const standing = reading.kind === 'release' ? versionStanding(reading.version, LIST, NOW) : null;
  return pdsVersionVerdict(HOST, { reachable, version }, reading, standing, NOW);
}

test('the verdict says up to date, how far behind, or that it cannot tell', () => {
  const current = verdictFor('0.4.5065');
  assert.equal(current.tone, 'pass');
  assert.equal(current.title, `${HOST} is up to date`);
  assert.match(current.text, /It runs 0\.5\.65, the latest release .* published Nov 23, 2026\./);

  const behind = verdictFor('0.5.61');
  assert.equal(behind.tone, 'warn');
  assert.equal(behind.title, `${HOST} is 4 releases behind`);
  assert.match(behind.text, /Behind since Nov 19, 2026, when 0\.5\.63 came out \(5 days ago\)/);

  const recent = verdictFor('0.5.64');
  assert.equal(recent.tone, 'info');
  assert.equal(recent.title, `${HOST} is 1 release behind, as of 18 hours ago`);
  assert.match(recent.text, /The latest is 0\.5\.65, and a host that updates overnight may not have it yet/);
});

test('the verdict does not compare what cannot be compared', () => {
  const commit = verdictFor('693d745178e941f5e377e48c9253236edb791b28');
  assert.equal(commit.tone, 'info');
  assert.match(commit.title, /reports a build, not a release/);
  assert.match(commit.text, /693d745\)/);

  const other = verdictFor('tranquil 0.9.0');
  assert.equal(other.tone, 'info');
  assert.match(other.title, /Can’t tell/);
  assert.match(other.text, /“tranquil 0\.9\.0”/);

  // A number other software uses is not measured against these releases.
  assert.match(verdictFor('1.14.19').title, /Can’t tell/);

  assert.equal(verdictFor(undefined).tone, 'info');
  assert.match(verdictFor(undefined).title, /doesn’t report a version/);
  assert.equal(verdictFor(undefined, false).tone, 'fail');
  assert.match(verdictFor(undefined, false).title, /didn’t answer as a PDS/);
});

test('the badge appears only when there is something definite to say', () => {
  const badge = (version: string) => {
    const reading = readReportedVersion(version, LIST);
    return pdsVersionBadge(reading.kind === 'release' ? versionStanding(reading.version, LIST, NOW) : null, NOW);
  };
  assert.deepEqual(badge('0.4.5065')?.tone, 'good');
  assert.equal(badge('0.4.5065')?.label, 'Up to date');
  assert.equal(badge('0.5.61')?.tone, 'warn');
  assert.equal(badge('0.5.61')?.label, '4 releases behind');
  assert.equal(badge('0.5.64')?.tone, 'quiet');
  assert.equal(badge('0.5.64')?.label, '0.5.65 is out');
  assert.equal(badge('1.14.19'), null);
  assert.equal(badge('tranquil 0.9.0'), null);
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

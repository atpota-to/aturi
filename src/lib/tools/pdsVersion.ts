/**
 * The PDS version check's logic: what a host says it runs, which software
 * and release that is, and how far that is from the latest one.
 *
 * A PDS says what it runs at `/xrpc/_health`, as `{ "version": "…" }`. What
 * is in that string depends on the software and how it was built, and only
 * some of it can be compared with a release list:
 *
 *   - A release number, `0.5.65`: the reference PDS (`@atproto/pds`), which
 *     answers with its package version unless the operator sets
 *     `PDS_VERSION`.
 *   - The self-host distribution's number, `0.4.5065`. Its entrypoint keeps
 *     the `0.4` of its Docker tag and folds the package's minor and patch
 *     into the last part (decodeDistributionVersion). This is what most
 *     self-hosted PDSs report.
 *   - A name and a number, `tranquil 0.9.1`: other software that says what
 *     it is. The ones whose releases can be read are in PDS_SOFTWARE.
 *   - A commit hash. Bluesky's own hosts report one, and there is no release
 *     to compare it with.
 *   - Anything else: software not known here, a fork, a development build,
 *     or a version the operator chose. Some of these are plain numbers too
 *     (`1.14.19` is rsky-pds, `2.5.2` is pds.js), which is why a plain
 *     number is only read as a release when the reference PDS's own list
 *     holds it.
 *
 * The release lists are read on the server and trimmed to what this needs
 * (src/app/api/tools/pds). Everything here is pure.
 */

/* -------------------------------------------------------------------------- *
 * The software whose releases can be read
 * -------------------------------------------------------------------------- */

export type PdsSoftwareId = 'reference' | 'tranquil' | 'cirrus' | 'cocoon' | 'knot';

/** The reference PDS's package on npm. */
export const PDS_PACKAGE = '@atproto/pds';

export type PdsSoftware = {
  id: PdsSoftwareId;
  /** As a sentence names it: "the latest release of …". */
  name: string;
  /**
   * The word its hosts put before the version (`tranquil 0.9.1`). Null for
   * the reference PDS, which reports a number alone.
   */
  prefix: string | null;
  /** Where its releases are read. The tool route fetches these and nothing else. */
  source: { kind: 'npm'; package: string } | { kind: 'git'; refs: string };
  /** The same releases as a page for a person. */
  releasesUrl: string;
};

const refsOf = (repo: string) => `${repo}/info/refs?service=git-upload-pack`;

/**
 * Each of these was checked two ways before it was listed: its source says
 * how the version string is built, and in a census of the 2,256 hosts a
 * relay listed as active, the versions its hosts reported were ones the
 * source below lists.
 *
 *   - Tranquil reports `tranquil ` and its Cargo version, and tags each
 *     release `v0.9.1` in its repository on Tangled. 174 hosts.
 *   - Cirrus reports `cirrus ` and the version of its npm package. 51 hosts.
 *   - Cocoon reports `cocoon ` and whatever its build was given: a tag
 *     (`0.14.1`), git's description of a commit (`v0.15-0-gec9eb18`), or a
 *     bare hash or `dev`, which cannot be compared. 21 hosts, about half of
 *     them on a tag.
 *   - A Tangled knot reports `knot ` and its version, tagged `v1.20.1` in
 *     Tangled's core repository. A knot is a git host, not a PDS, but it
 *     answers `describeServer` and relays list it beside them. 135 hosts.
 *
 * Left out, each for a reason. rsky-pds (blacksky.app) tags no releases and
 * is not published, so there is no list, only the version on its main
 * branch. pds.js is on npm but reports a number alone, and its list includes
 * `1.0.0`, which unversioned software of every kind reports. Pegasus reports
 * a commit hash. The rest are a host or two each.
 */
export const PDS_SOFTWARE: Record<PdsSoftwareId, PdsSoftware> = {
  reference: {
    id: 'reference',
    name: 'the reference PDS',
    prefix: null,
    source: { kind: 'npm', package: PDS_PACKAGE },
    releasesUrl: 'https://github.com/bluesky-social/atproto/blob/main/packages/pds/CHANGELOG.md',
  },
  tranquil: {
    id: 'tranquil',
    name: 'Tranquil',
    prefix: 'tranquil',
    source: { kind: 'git', refs: refsOf('https://tangled.org/tranquil.farm/tranquil-pds') },
    releasesUrl: 'https://tangled.org/tranquil.farm/tranquil-pds/tags',
  },
  cirrus: {
    id: 'cirrus',
    name: 'Cirrus',
    prefix: 'cirrus',
    source: { kind: 'npm', package: '@getcirrus/pds' },
    releasesUrl: 'https://github.com/ascorbic/cirrus/blob/main/packages/pds/CHANGELOG.md',
  },
  cocoon: {
    id: 'cocoon',
    name: 'Cocoon',
    prefix: 'cocoon',
    source: { kind: 'git', refs: refsOf('https://github.com/haileyok/cocoon.git') },
    releasesUrl: 'https://github.com/haileyok/cocoon/tags',
  },
  knot: {
    id: 'knot',
    name: 'the Tangled knot server',
    prefix: 'knot',
    source: { kind: 'git', refs: refsOf('https://tangled.org/tangled.org/core') },
    releasesUrl: 'https://tangled.org/tangled.org/core/tags',
  },
};

export function isPdsSoftwareId(value: unknown): value is PdsSoftwareId {
  return typeof value === 'string' && Object.keys(PDS_SOFTWARE).includes(value);
}

/** One stable release, as its source lists it. */
export type PdsRelease = {
  version: string;
  /** When it was published, in milliseconds. Null when the source gave no time: a git tag has none. */
  published: number | null;
};

export type PdsReleaseList = {
  software: PdsSoftwareId;
  /** The newest release: npm's `latest` tag, or the highest git tag. Always one of `releases`. */
  latest: string;
  /** Every stable release, oldest first by version number. */
  releases: PdsRelease[];
};

/* -------------------------------------------------------------------------- *
 * Version numbers
 * -------------------------------------------------------------------------- */

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;

function parts(version: string): [number, number, number] | null {
  const match = STABLE.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Order two stable versions by number. A string that is not one sorts first. */
export function compareVersions(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  if (!left || !right) return Number(Boolean(left)) - Number(Boolean(right));
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/**
 * Which software a reported version could be a release of, and so whose
 * list is worth fetching: the reference PDS for a plain number, or the
 * software a leading name stands for. Null for a commit hash and for
 * anything else, which spares the request on the hosts most pages are about.
 */
export function softwareOf(reported: string | null | undefined): PdsSoftwareId | null {
  const value = typeof reported === 'string' ? reported.trim() : '';
  if (STABLE.test(value)) return 'reference';
  const space = value.indexOf(' ');
  if (space < 1) return null;
  const word = value.slice(0, space);
  return Object.values(PDS_SOFTWARE).find((software) => software.prefix === word)?.id ?? null;
}

/**
 * The package version behind a number the self-host distribution reports.
 *
 * The distribution (github.com/bluesky-social/pds, service/index.ts) reports
 * `0.4.<minor><patch, three digits>`: `0.4` is the Docker tag its compose
 * file pulls, kept so that tag keeps matching, and the rest is the package's
 * minor and patch run together. So `0.4.5065` is 0.5.65 and `0.4.5001` is
 * 0.5.1. It leaves a package version with a zero minor as it is.
 *
 * Returns null for a number that is not in that form. A real 0.4 release
 * never reached a four-digit patch, but the caller still checks the result
 * against the release list before believing it.
 */
export function decodeDistributionVersion(reported: string): string | null {
  const match = /^0\.4\.([1-9]\d*)(\d{3})$/.exec(reported);
  return match ? `0.${match[1]}.${Number(match[2])}` : null;
}

/**
 * The first release of the reference PDS a plain number is read as.
 *
 * 0.4.0 came out on February 22, 2024, the day self-hosted PDSs could first
 * join the network. The numbers below it belong to the closed sandbox before
 * that, and what reports one today is software that never set a version:
 * `0.1.0` is the default in more than one toolchain. In the census, all 46
 * hosts reporting a number below 0.4.0 were something else, most of them one
 * operator's fork, and each would have read as 300 releases behind.
 */
export const REFERENCE_FLOOR = '0.4.0';

/**
 * A git tag that is a release: an optional `v` and two or three numbers
 * (Cocoon tags both `v0.15` and `v0.14.4`), read as three. Anything with a
 * pre-release suffix (`-alpha`, `-fork.3`) does not match.
 */
const TAG = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/;

function tagVersion(tag: string): string | null {
  const match = TAG.exec(tag);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3] ?? 0)}` : null;
}

/**
 * The version after a software's name: a tag, or `git describe`'s account of
 * a commit, which is the last tag before it and how many commits past that
 * it is (`v0.9.0-4-g4bd740d`).
 */
function namedVersion(value: string): { version: string; ahead: number } | null {
  const described = /^(.+)-(\d+)-g[0-9a-f]+$/.exec(value);
  const version = tagVersion(described ? described[1] : value);
  return version ? { version, ahead: described ? Number(described[2]) : 0 } : null;
}

/* -------------------------------------------------------------------------- *
 * The release lists
 * -------------------------------------------------------------------------- */

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Trim npm's document for a package (its "packument") to the stable releases
 * and when each was published. Pre-releases are dropped: the registry
 * carries dozens for the reference PDS (`0.4.0-beta.7`,
 * `0.0.0-spaces-alpha-…`), and none is a version an operator is expected to
 * be on.
 *
 * Null when the document does not name a stable `latest` that it also lists,
 * which is not something to paper over with a guess.
 */
export function readPackument(software: PdsSoftwareId, doc: unknown): PdsReleaseList | null {
  const data = record(doc);
  const times = record(data.time);
  const releases = Object.keys(record(data.versions))
    .filter((version) => STABLE.test(version))
    .map((version): PdsRelease => {
      const at = typeof times[version] === 'string' ? Date.parse(times[version] as string) : NaN;
      return { version, published: Number.isFinite(at) ? at : null };
    })
    .sort((a, b) => compareVersions(a.version, b.version));
  const latest = record(data['dist-tags']).latest;
  if (typeof latest !== 'string' || !releases.some((release) => release.version === latest)) return null;
  return { software, latest, releases };
}

/**
 * The releases in a git repository, from the list of refs it advertises to
 * anything about to fetch from it (`<repo>/info/refs?service=git-upload-pack`,
 * what `git ls-remote` reads). Every git host answers this the same way, so
 * one reader covers GitHub and Tangled, and it is not GitHub's rate-limited
 * API.
 *
 * A release is a tag that is a version and nothing more. The same version
 * tagged twice (Cocoon has `0.5.1` and `v0.5.1`) is one release, and a tag
 * that is not a version (`list`) or is a pre-release (`v1.16.1-alpha`) is
 * none. A tag carries no date in this list, so these releases have none.
 *
 * Null when the list names no release at all.
 */
export function readTagRefs(software: PdsSoftwareId, advertisement: string): PdsReleaseList | null {
  const versions = new Set<string>();
  // The list is length-prefixed lines of `<hash> <ref>`, the first with a
  // NUL and the server's capabilities after it. An annotated tag is listed
  // again as `<ref>^{}`, which the name's own pattern stops short of.
  for (const match of advertisement.matchAll(/ refs\/tags\/([^\s\0^]+)/g)) {
    const version = tagVersion(match[1]);
    if (version) versions.add(version);
  }
  if (versions.size === 0) return null;
  const releases = Array.from(versions)
    .sort(compareVersions)
    .map((version): PdsRelease => ({ version, published: null }));
  return { software, latest: releases[releases.length - 1].version, releases };
}

/** Read a list back from the tool route's response. Null when it is not one. */
export function readReleaseList(body: unknown): PdsReleaseList | null {
  const data = record(body);
  if (!isPdsSoftwareId(data.software) || typeof data.latest !== 'string' || !Array.isArray(data.releases)) return null;
  const releases: PdsRelease[] = [];
  for (const entry of data.releases) {
    const item = record(entry);
    if (typeof item.version !== 'string' || !STABLE.test(item.version)) return null;
    releases.push({
      version: item.version,
      published: typeof item.published === 'number' && Number.isFinite(item.published) ? item.published : null,
    });
  }
  if (!releases.some((release) => release.version === data.latest)) return null;
  return { software: data.software, latest: data.latest, releases };
}

/* -------------------------------------------------------------------------- *
 * What the host reports
 * -------------------------------------------------------------------------- */

export type VersionReading =
  /** A release of known software. */
  | {
      kind: 'release';
      software: PdsSoftwareId;
      reported: string;
      version: string;
      /** What named it: the package's number, the distribution's numbering, or the software's own name. */
      via: 'package' | 'distribution' | 'name';
      /** Commits past the release's tag, when the build said (`v0.9.0-4-g4bd740d`). */
      ahead: number;
    }
  /** A commit hash, as Bluesky's own hosts report. */
  | { kind: 'commit'; reported: string }
  /**
   * A version that is no release in any list here. `software` is the
   * software it names when it names one (`tranquil 0.2.9`, `cocoon dev`).
   */
  | { kind: 'other'; reported: string; software: PdsSoftwareId | null }
  /** No version was reported. */
  | { kind: 'none' };

const COMMIT = /^[0-9a-f]{40}$/i;
/** A version is the host's to write, so what is shown of it is bounded. */
const SHOWN_LENGTH = 80;

function shown(value: string): string {
  return value.length > SHOWN_LENGTH ? `${value.slice(0, SHOWN_LENGTH)}…` : value;
}

/**
 * Read a reported version, against the release list of the software it
 * could be (softwareOf). Null while that list is still needed: a version
 * that names no known software is read without one.
 *
 * A plain number is taken as written first, and as the distribution's
 * numbering only when that fails, so the two can never be confused.
 */
export function readReportedVersion(
  raw: string | null | undefined,
  list: PdsReleaseList | null,
): VersionReading | null {
  const reported = typeof raw === 'string' ? raw.trim() : '';
  if (!reported) return { kind: 'none' };
  if (COMMIT.test(reported)) return { kind: 'commit', reported };
  const id = softwareOf(reported);
  if (!id) return { kind: 'other', reported: shown(reported), software: null };
  if (!list || list.software !== id) return null;
  const listed = (version: string) => list.releases.some((release) => release.version === version);

  const { prefix } = PDS_SOFTWARE[id];
  if (prefix === null) {
    if (compareVersions(reported, REFERENCE_FLOOR) >= 0 && listed(reported)) {
      return { kind: 'release', software: id, reported, version: reported, via: 'package', ahead: 0 };
    }
    const decoded = decodeDistributionVersion(reported);
    if (decoded && listed(decoded)) {
      return { kind: 'release', software: id, reported, version: decoded, via: 'distribution', ahead: 0 };
    }
    // A number alone names no software, so it is not said to be this one's.
    return { kind: 'other', reported, software: null };
  }
  const named = namedVersion(reported.slice(prefix.length + 1).trim());
  if (named && listed(named.version)) {
    return { kind: 'release', software: id, reported, version: named.version, via: 'name', ahead: named.ahead };
  }
  return { kind: 'other', reported: shown(reported), software: id };
}

/* -------------------------------------------------------------------------- *
 * Where that leaves it
 * -------------------------------------------------------------------------- */

/**
 * How long after a release a host is still counted as keeping up.
 *
 * The self-host distribution updates itself once a night (its compose file
 * runs Watchtower at midnight), and its image is built after the package is
 * published. A host doing everything right is therefore a release behind for
 * a day or so several times a month, at the pace releases come out. Two days
 * covers that; past it, being behind says something about the host.
 *
 * It needs a release's date, so it only ever applies to software published
 * on npm. Behind a git tag, a host is behind from the moment the tag exists.
 */
export const RECENT_RELEASE_MS = 48 * 60 * 60 * 1000;

export type VersionStanding =
  | { state: 'current'; running: PdsRelease; latest: PdsRelease }
  /** Newer than the release tagged `latest`, which a re-tag can cause. */
  | { state: 'ahead'; running: PdsRelease; latest: PdsRelease }
  | {
      state: 'behind';
      running: PdsRelease;
      latest: PdsRelease;
      /** The releases it lacks, oldest first, ending with the latest. */
      missed: PdsRelease[];
      /** When the first of them was published: how long it has been behind. */
      since: number | null;
      /** Every one of them came out within RECENT_RELEASE_MS. */
      recent: boolean;
    };

/** How a release compares with the latest. Null when it is not in the list. */
export function versionStanding(version: string, list: PdsReleaseList, now: number): VersionStanding | null {
  const running = list.releases.find((release) => release.version === version);
  const latest = list.releases.find((release) => release.version === list.latest);
  if (!running || !latest) return null;
  const order = compareVersions(running.version, latest.version);
  if (order === 0) return { state: 'current', running, latest };
  if (order > 0) return { state: 'ahead', running, latest };

  const missed = list.releases.filter(
    (release) =>
      compareVersions(release.version, running.version) > 0 && compareVersions(release.version, latest.version) <= 0,
  );
  // Not simply the first one's date: releases are now and then published
  // out of order (0.5.51 came out half a day before 0.5.50).
  const times = missed.map((release) => release.published).filter((at): at is number => at !== null);
  const since = times.length === missed.length ? Math.min(...times) : null;
  return {
    state: 'behind',
    running,
    latest,
    missed,
    since,
    recent: since !== null && now - since < RECENT_RELEASE_MS,
  };
}

/* -------------------------------------------------------------------------- *
 * In words
 * -------------------------------------------------------------------------- */

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A publish date as a day, in UTC so it reads the same wherever it is opened. */
export function formatReleaseDay(at: number): string {
  return DAY_FORMAT.format(at);
}

function count(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** A length of time in one unit, to the nearest that fits: "19 hours", "5 days", "3 months". */
export function formatSpan(ms: number): string {
  const hours = Math.floor(Math.max(0, ms) / 3_600_000);
  if (hours < 1) return 'less than an hour';
  if (hours < 48) return count(hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 60) return count(days, 'day');
  if (days < 730) return count(Math.round(days / 30.44), 'month');
  return count(Math.round(days / 365.25), 'year');
}

export function releasesBehind(n: number): string {
  return `${n} ${n === 1 ? 'release' : 'releases'} behind`;
}

/** Why a version that cannot be compared cannot be, in a sentence that follows "It reports …". */
function whyNotCompared(reading: Extract<VersionReading, { kind: 'other' }>): string {
  if (reading.software) {
    return `which isn’t a release of ${PDS_SOFTWARE[reading.software].name}. It may be a development build or a fork.`;
  }
  // The reference PDS did once release these numbers (REFERENCE_FLOOR).
  if (STABLE.test(reading.reported) && compareVersions(reading.reported, REFERENCE_FLOOR) < 0) {
    return `a number software reports when no version was set. Below ${REFERENCE_FLOOR}, a number isn’t read as a release of ${PDS_SOFTWARE.reference.name}.`;
  }
  return `which isn’t a release of ${KNOWN_SOFTWARE_NAMES}. It may be other software, a fork, or a build with its own version number.`;
}

const NAMES = Object.values(PDS_SOFTWARE).map((software) => software.name);
/** Every software in PDS_SOFTWARE, as a sentence lists alternatives. */
export const KNOWN_SOFTWARE_NAMES = `${NAMES.slice(0, -1).join(', ')} or ${NAMES[NAMES.length - 1]}`;

export type PdsVersionVerdict = {
  tone: 'pass' | 'warn' | 'fail' | 'info';
  title: string;
  text: string;
};

/**
 * The answer in a sentence or two, for a reading that has been made
 * (readReportedVersion). `reachable` is whether the host answered as a PDS
 * at all, which is what a missing version comes down to.
 */
export function pdsVersionVerdict(
  host: string,
  reachable: boolean,
  reading: VersionReading,
  standing: VersionStanding | null,
  now: number,
): PdsVersionVerdict {
  if (reading.kind === 'none') {
    return reachable
      ? {
          tone: 'info',
          title: `${host} doesn’t report a version`,
          text: 'A PDS reports one at /xrpc/_health. This one didn’t, so there is nothing to compare.',
        }
      : {
          tone: 'fail',
          title: `${host} didn’t answer as a PDS`,
          text: 'Neither describeServer nor /xrpc/_health answered. Check the hostname, or try again if it may be down.',
        };
  }
  if (reading.kind === 'commit') {
    return {
      tone: 'info',
      title: `${host} reports a build, not a release`,
      text: `Its version is a commit hash (${reading.reported.slice(0, 7)}), as Bluesky’s own hosts report. That isn’t a release number, so it can’t be compared.`,
    };
  }
  if (reading.kind === 'release' && standing) {
    const { name } = PDS_SOFTWARE[reading.software];
    const { running, latest } = standing;
    const published = (release: PdsRelease) =>
      release.published === null ? '' : `, published ${formatReleaseDay(release.published)}`;
    if (standing.state === 'current') {
      return {
        tone: 'pass',
        title: `${host} is up to date`,
        text: `It runs ${running.version}, the latest release of ${name}${published(running)}.`,
      };
    }
    if (standing.state === 'ahead') {
      return {
        tone: 'pass',
        title: `${host} is ahead of the latest release`,
        text: `It runs ${running.version}. npm tags ${latest.version} as the latest release of ${name}.`,
      };
    }
    const n = standing.missed.length;
    if (standing.recent && standing.since !== null) {
      return {
        tone: 'info',
        title: `${host} is ${releasesBehind(n)}, as of ${formatSpan(now - standing.since)} ago`,
        text: `It runs ${running.version}. The latest release of ${name} is ${latest.version}, and a host that updates overnight may not have it yet.`,
      };
    }
    // The release that put it behind, which is not always the lowest-numbered.
    const first = standing.missed.find((release) => release.published === standing.since) ?? standing.missed[0];
    return {
      tone: 'warn',
      title: `${host} is ${releasesBehind(n)}`,
      text:
        `It runs ${running.version}${published(running)}. The latest release of ${name} is ${latest.version}.` +
        (standing.since !== null
          ? ` Behind since ${formatReleaseDay(standing.since)}, when ${first.version} came out (${formatSpan(now - standing.since)} ago).`
          : ''),
    };
  }
  return {
    tone: 'info',
    title: `Can’t tell whether ${host} is up to date`,
    text:
      reading.kind === 'other'
        ? `It reports “${reading.reported}”, ${whyNotCompared(reading)}`
        : // A release whose list has since lost it: nothing to stand it against.
          `It reports “${reading.reported}”, which isn’t in the release list any more.`,
  };
}

/** The mark beside a version on the Explorer's PDS page. */
export type PdsVersionBadge = {
  /** `unknown` is a version that cannot be compared, drawn apart from every answer. */
  tone: 'good' | 'warn' | 'quiet' | 'unknown';
  label: string;
  /** The same in a sentence, for the tooltip. */
  title: string;
};

/**
 * A mark for every version a host reports: where it stands, or that this
 * cannot say. Null only when there is no reading to go on, because the host
 * reported nothing or the release list has not arrived.
 */
export function pdsVersionBadge(
  reading: VersionReading | null,
  standing: VersionStanding | null,
  now: number,
): PdsVersionBadge | null {
  if (!reading || reading.kind === 'none') return null;
  if (reading.kind === 'commit') {
    return {
      tone: 'unknown',
      label: 'Can’t compare',
      title: 'A commit hash, as Bluesky’s own hosts report, not a release number.',
    };
  }
  if (reading.kind === 'other' || !standing) {
    return {
      tone: 'unknown',
      label: 'Can’t compare',
      title:
        reading.kind === 'other'
          ? `It reports “${reading.reported}”, ${whyNotCompared(reading)}`
          : `“${reading.reported}” isn’t in the release list.`,
    };
  }
  const { name } = PDS_SOFTWARE[reading.software];
  const { running, latest } = standing;
  if (standing.state !== 'behind') {
    return {
      tone: 'good',
      label: 'Up to date',
      title:
        standing.state === 'current'
          ? `${running.version} is the latest release of ${name}.`
          : `${running.version} is newer than ${latest.version}, the release tagged latest.`,
    };
  }
  const n = standing.missed.length;
  if (standing.recent && standing.since !== null) {
    return {
      tone: 'quiet',
      label: `${latest.version} is out`,
      title: `Runs ${running.version}, behind for ${formatSpan(now - standing.since)}. A host that updates overnight may not have ${latest.version} yet.`,
    };
  }
  return {
    tone: 'warn',
    label: releasesBehind(n),
    title:
      `Runs ${running.version}. The latest release of ${name} is ${latest.version}.` +
      (standing.since !== null ? ` Behind since ${formatReleaseDay(standing.since)}.` : ''),
  };
}

/** The distribution's own way to update, as its README gives it. */
export const DISTRIBUTION_UPDATE_COMMAND = 'sudo pdsadmin update';

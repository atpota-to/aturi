/**
 * The PDS version check's logic: what a host says it runs, which release of
 * the reference PDS that is, and how far that is from the latest one.
 *
 * A PDS says what it runs at `/xrpc/_health`, as `{ "version": "…" }`. The
 * reference implementation (`@atproto/pds`) answers with its package version
 * unless the operator sets `PDS_VERSION`, so the string is one of several
 * things, and only some of them can be compared with a release list:
 *
 *   - A release number, `0.5.65`: a build that uses the package directly.
 *   - The self-host distribution's number, `0.4.5065`. Its entrypoint keeps
 *     the `0.4` of its Docker tag and folds the package's minor and patch
 *     into the last part (decodeDistributionVersion). This is what most
 *     self-hosted PDSs report.
 *   - A commit hash. Bluesky's own hosts report one, and there is no release
 *     to compare it with.
 *   - Anything else: other PDS software (`tranquil 0.9.0`, `cocoon v0.15`),
 *     a fork, or a version the operator chose. Some of these are plain
 *     numbers too (`1.14.19`, `2.5.2`), which is why a number is only read
 *     as a release when the registry lists it.
 *
 * The releases are npm's, read on the server and trimmed to what this needs
 * (src/app/api/tools/pds). Everything here is pure.
 */

export const PDS_PACKAGE = '@atproto/pds';

/** One stable release of the reference PDS, as the registry lists it. */
export type PdsRelease = {
  version: string;
  /** When it was published, in milliseconds. Null when the registry gave no time. */
  published: number | null;
};

export type PdsReleaseList = {
  /** The release npm tags `latest`. Always one of `releases`. */
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
 * Whether a reported version has the shape of a release number, and so is
 * worth fetching the release list for. A commit hash or a named build never
 * is, which spares the request on the hosts most pages are about.
 */
export function couldBeRelease(reported: string | null | undefined): boolean {
  return typeof reported === 'string' && STABLE.test(reported.trim());
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

/* -------------------------------------------------------------------------- *
 * The release list
 * -------------------------------------------------------------------------- */

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Trim npm's document for the package (its "packument") to the stable
 * releases and when each was published. Pre-releases are dropped: the
 * registry carries dozens (`0.4.0-beta.7`, `0.0.0-spaces-alpha-…`), and none
 * is a version an operator is expected to be on.
 *
 * Null when the document does not name a stable `latest` that it also lists,
 * which is not something to paper over with a guess.
 */
export function readPackument(doc: unknown): PdsReleaseList | null {
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
  return { latest, releases };
}

/** Read the list back from the tool route's response. Null when it is not one. */
export function readReleaseList(body: unknown): PdsReleaseList | null {
  const data = record(body);
  if (typeof data.latest !== 'string' || !Array.isArray(data.releases)) return null;
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
  return { latest: data.latest, releases };
}

/* -------------------------------------------------------------------------- *
 * What the host reports
 * -------------------------------------------------------------------------- */

export type VersionReading =
  /** A release of the reference PDS, and which numbering named it. */
  | { kind: 'release'; reported: string; version: string; via: 'package' | 'distribution' }
  /** A commit hash, as Bluesky's own hosts report. */
  | { kind: 'commit'; reported: string }
  /** A version that is no stable release of the reference PDS. */
  | { kind: 'other'; reported: string }
  /** No version was reported. */
  | { kind: 'none' };

const COMMIT = /^[0-9a-f]{40}$/i;
/** A version is the host's to write, so what is shown of it is bounded. */
const SHOWN_LENGTH = 80;

function shown(value: string): string {
  return value.length > SHOWN_LENGTH ? `${value.slice(0, SHOWN_LENGTH)}…` : value;
}

/**
 * Read a reported version against the release list. A number is taken as
 * written first, and as the distribution's numbering only when that fails,
 * so the two can never be confused.
 */
export function readReportedVersion(raw: string | null | undefined, list: PdsReleaseList): VersionReading {
  const reported = typeof raw === 'string' ? raw.trim() : '';
  if (!reported) return { kind: 'none' };
  if (COMMIT.test(reported)) return { kind: 'commit', reported };
  const listed = (version: string) => list.releases.some((release) => release.version === version);
  if (STABLE.test(reported)) {
    if (listed(reported)) return { kind: 'release', reported, version: reported, via: 'package' };
    const decoded = decodeDistributionVersion(reported);
    if (decoded && listed(decoded)) return { kind: 'release', reported, version: decoded, via: 'distribution' };
  }
  return { kind: 'other', reported: shown(reported) };
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

/** What the host said for itself: whether it answers as a PDS, and its `_health` version. */
export type VersionProbe = { reachable: boolean; version?: string };

export type PdsVersionVerdict = {
  tone: 'pass' | 'warn' | 'fail' | 'info';
  title: string;
  text: string;
};

/**
 * The answer in a sentence or two. `reading` and `standing` come from the
 * release list. A version that could not be a release (couldBeRelease) can
 * be answered without them; one that could has to wait for the list, or it
 * would be told it matches nothing.
 */
export function pdsVersionVerdict(
  host: string,
  probe: VersionProbe,
  reading: VersionReading | null,
  standing: VersionStanding | null,
  now: number,
): PdsVersionVerdict {
  const reported = probe.version?.trim() ?? '';
  if (!reported) {
    return probe.reachable
      ? {
          tone: 'info',
          title: `${host} does not say what version it runs`,
          text: 'A PDS reports its version at /xrpc/_health. This one did not answer there, or answered without one, so there is nothing to compare.',
        }
      : {
          tone: 'fail',
          title: `${host} did not answer as a PDS`,
          text: 'Neither describeServer nor its health endpoint answered. Check the hostname, or try again if the host may be down.',
        };
  }
  if (COMMIT.test(reported)) {
    return {
      tone: 'info',
      title: `${host} reports a build, not a release`,
      text: `Its version is a commit hash (${reported.slice(0, 7)}), which is what Bluesky’s own hosts report. A hash is not a release number, so this cannot say how current it is.`,
    };
  }
  if (reading?.kind === 'release' && standing) {
    const { running, latest } = standing;
    const published = (release: PdsRelease) =>
      release.published === null ? '' : `, published ${formatReleaseDay(release.published)}`;
    if (standing.state === 'current') {
      return {
        tone: 'pass',
        title: `${host} is up to date`,
        text: `It runs ${running.version}, the latest release of the reference PDS${published(running)}.`,
      };
    }
    if (standing.state === 'ahead') {
      return {
        tone: 'pass',
        title: `${host} is ahead of the latest release`,
        text: `It runs ${running.version}. The registry tags ${latest.version} as the latest.`,
      };
    }
    const n = standing.missed.length;
    if (standing.recent && standing.since !== null) {
      return {
        tone: 'info',
        title: `${host} is ${releasesBehind(n)}, as of ${formatSpan(now - standing.since)} ago`,
        text: `It runs ${running.version}, and ${latest.version} is the latest. A host that updates itself overnight may not have ${n === 1 ? 'it' : 'them'} yet.`,
      };
    }
    // The release that put it behind, which is not always the lowest-numbered.
    const first = standing.missed.find((release) => release.published === standing.since) ?? standing.missed[0];
    return {
      tone: 'warn',
      title: `${host} is ${releasesBehind(n)}`,
      text:
        `It runs ${running.version}${published(running)}. The latest is ${latest.version}.` +
        (standing.since !== null
          ? ` It has been behind since ${formatReleaseDay(standing.since)}, when ${first.version} came out (${formatSpan(now - standing.since)} ago).`
          : ''),
    };
  }
  return {
    tone: 'info',
    title: `This cannot tell whether ${host} is up to date`,
    text: `It reports “${shown(reported)}”, which does not match a stable release of the reference PDS. It may be other PDS software, a fork, or a build that sets its own version. Only the reference PDS’s releases are known here.`,
  };
}

/** The mark beside a version on the Explorer's PDS page. */
export type PdsVersionBadge = {
  tone: 'good' | 'warn' | 'quiet';
  label: string;
  /** The same in a sentence, for the tooltip. */
  title: string;
};

/**
 * A mark only when there is something definite to say: a host that cannot be
 * compared gets none, and the tool page explains why.
 */
export function pdsVersionBadge(standing: VersionStanding | null, now: number): PdsVersionBadge | null {
  if (!standing) return null;
  const { running, latest } = standing;
  if (standing.state !== 'behind') {
    return {
      tone: 'good',
      label: 'Up to date',
      title:
        standing.state === 'current'
          ? `${running.version} is the latest release of the reference PDS.`
          : `${running.version} is newer than ${latest.version}, the release tagged latest.`,
    };
  }
  const n = standing.missed.length;
  if (standing.recent && standing.since !== null) {
    return {
      tone: 'quiet',
      label: `${latest.version} is out`,
      title: `It runs ${running.version} and has been behind for ${formatSpan(now - standing.since)}. A host that updates itself overnight may not have ${n === 1 ? 'the new release' : 'the new releases'} yet.`,
    };
  }
  return {
    tone: 'warn',
    label: releasesBehind(n),
    title:
      `It runs ${running.version}, and the latest release is ${latest.version}.` +
      (standing.since !== null ? ` Behind since ${formatReleaseDay(standing.since)}.` : ''),
  };
}

/** The distribution's own way to update, as its README gives it. */
export const DISTRIBUTION_UPDATE_COMMAND = 'sudo pdsadmin update';

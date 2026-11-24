'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSharedToolRun } from '@/components/tools/useToolQuery';
import {
  pdsVersionBadge,
  readReportedVersion,
  softwareOf,
  versionStanding,
  type PdsReleaseList,
  type PdsSoftwareId,
} from '@/lib/tools/pdsVersion';
import { fetchPdsReleases, pdsReleasesRun } from '@/lib/tools/pdsVersionClient';

/**
 * Beside a host's version: whether that is the latest release of the
 * software it runs, how far behind it is, or that this cannot say. The
 * reading is the PDS version check's (src/lib/tools/pdsVersion.ts), and the
 * mark is a link to that tool, which says how it was arrived at.
 *
 * A version that names no known software (a commit hash, as Bluesky's own
 * hosts report, or anything unrecognized) is marked as not comparable
 * without asking for a release list, so most PDS pages make no request for
 * this at all. One that does name software waits for that software's list,
 * and draws nothing if the list cannot be read: a missing mark says less
 * than a wrong one.
 */
export default function VersionBadge({ host, version }: { host: string; version: string }) {
  const software = softwareOf(version);
  const releases = useSharedToolRun<PdsReleaseList>(software ? pdsReleasesRun(software) : null, ({ signal }) =>
    fetchPdsReleases(software as PdsSoftwareId, signal),
  );
  const [now] = useState(() => Date.now());
  const list = releases.data ?? null;
  const reading = readReportedVersion(version, list);
  const standing = reading?.kind === 'release' && list ? versionStanding(reading.version, list, now) : null;
  const badge = pdsVersionBadge(reading, standing, now);
  if (!badge) return null;
  return (
    // A static page, so the link keeps its prefetch.
    <Link
      href={`/tools/pds?host=${encodeURIComponent(host)}`}
      rel="nofollow"
      className="fx-pd-standing fx-pd-version"
      data-tone={badge.tone === 'quiet' ? undefined : badge.tone}
      title={badge.title}
    >
      <span className="fx-pd-dot" aria-hidden />
      {badge.label}
    </Link>
  );
}

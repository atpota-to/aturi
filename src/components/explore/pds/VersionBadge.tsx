'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSharedToolRun } from '@/components/tools/useToolQuery';
import {
  couldBeRelease,
  pdsVersionBadge,
  readReportedVersion,
  versionStanding,
  type PdsReleaseList,
} from '@/lib/tools/pdsVersion';
import { PDS_RELEASES_RUN, fetchPdsReleases } from '@/lib/tools/pdsVersionClient';

/**
 * Beside a host's version: whether that is the latest release of the
 * reference PDS, or how far behind it is. The reading is the PDS version
 * check's (src/lib/tools/pdsVersion.ts), and the mark is a link to that
 * tool, which says how it was arrived at.
 *
 * It draws nothing for a version that cannot be compared: a commit hash, as
 * Bluesky's own hosts report, or other software's. Those never ask for the
 * release list either, so most PDS pages make no request for this at all.
 * Nor does it draw anything when the list cannot be read. A missing mark
 * says less than a wrong one.
 */
export default function VersionBadge({ host, version }: { host: string; version: string }) {
  const releases = useSharedToolRun<PdsReleaseList>(couldBeRelease(version) ? PDS_RELEASES_RUN : null, ({ signal }) =>
    fetchPdsReleases(signal),
  );
  const [now] = useState(() => Date.now());
  const list = releases.data;
  if (!list) return null;
  const reading = readReportedVersion(version, list);
  const badge = pdsVersionBadge(reading.kind === 'release' ? versionStanding(reading.version, list, now) : null, now);
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

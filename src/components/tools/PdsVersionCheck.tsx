'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Info, LoaderCircle, ServerCog, TriangleAlert, X } from 'lucide-react';
import { toolHref } from '@/lib/tools/catalog';
import { resolvePdsTarget, type PdsTarget } from '@/lib/tools/pdsTargetClient';
import {
  DISTRIBUTION_UPDATE_COMMAND,
  PDS_PACKAGE,
  couldBeRelease,
  formatReleaseDay,
  formatSpan,
  pdsVersionVerdict,
  readReportedVersion,
  versionStanding,
  type PdsRelease,
  type PdsReleaseList,
} from '@/lib/tools/pdsVersion';
import { PDS_RELEASES_RUN, fetchPdsReleases } from '@/lib/tools/pdsVersionClient';
import { normalizeRelayInput } from '@/lib/tools/relay';
import {
  ToolCard,
  ToolCode,
  ToolError,
  ToolFact,
  ToolFacts,
  ToolForm,
  ToolIntro,
  ToolSection,
  ToolShell,
  ToolVerdict,
} from './ToolFrame';
import { useSharedToolRun, useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'pds';
const EXAMPLES = [{ value: 'eurosky.social' }, { value: 'blacksky.app' }, { value: '@bsky.app' }];

const CHANGELOG_URL = 'https://github.com/bluesky-social/atproto/blob/main/packages/pds/CHANGELOG.md';
const DISTRIBUTION_URL = 'https://github.com/bluesky-social/pds';

/** How many of the releases a host lacks are listed before the rest are counted. */
const MISSED_SHOWN = 8;

const VERDICT_ICON = {
  pass: <Check size={18} strokeWidth={2.6} />,
  warn: <TriangleAlert size={18} />,
  fail: <X size={18} strokeWidth={2.6} />,
  info: <Info size={18} />,
  pending: <LoaderCircle size={18} className="fn-tool-spin" />,
};

/** A release's date, and how long ago that was. */
function published(release: PdsRelease, now: number): string {
  if (release.published === null) return 'Not dated by the registry';
  return `${formatReleaseDay(release.published)} (${formatSpan(now - release.published)} ago)`;
}

/**
 * Asks a PDS what version it runs and compares that with the releases of the
 * reference PDS. The logic is in src/lib/tools/pdsVersion.ts.
 */
export default function PdsVersionCheck() {
  const [{ host: raw }, setQuery] = useToolQuery(['host'] as const);
  // The same input as the relay crawl check: a host, or an account to find one by.
  const input = raw ? normalizeRelayInput(raw) : null;
  const valid = input?.ok ? input : null;
  const key = valid ? `${valid.kind}:${valid.kind === 'account' ? valid.identifier : valid.host}` : null;

  const run = useToolRun<PdsTarget>(key, ({ signal, publish }) =>
    resolvePdsTarget(valid as NonNullable<typeof valid>, signal, publish),
  );
  const target = run.data ?? null;
  const probe = target?.pds;

  // Only a version that could be a release needs the list to be read.
  const comparable = couldBeRelease(probe?.version);
  const releases = useSharedToolRun<PdsReleaseList>(comparable ? PDS_RELEASES_RUN : null, ({ signal }) =>
    fetchPdsReleases(signal),
  );
  const [now] = useState(() => Date.now());
  const list = releases.data ?? null;
  const listFailed = comparable && releases.status === 'error';
  const reading = probe && list ? readReportedVersion(probe.version, list) : null;
  const standing = reading?.kind === 'release' && list ? versionStanding(reading.version, list, now) : null;
  const verdict =
    target && probe && (!comparable || list) ? pdsVersionVerdict(target.host, probe, reading, standing, now) : null;
  const behind = standing?.state === 'behind' ? standing : null;

  return (
    <ToolShell
      slug={SLUG}
      share={valid ? `${toolHref(SLUG)}?host=${encodeURIComponent(raw.trim())}` : undefined}
      form={
        <ToolForm
          value={raw}
          onSubmit={(value) => setQuery({ host: value })}
          label="PDS hostname, or a handle or DID to look up its PDS"
          placeholder="pds.example.com"
          busy={run.status === 'loading' || (comparable && releases.status === 'loading')}
          examples={EXAMPLES}
          icon={<ServerCog size={17} />}
        />
      }
    >
      {input && !input.ok && <ToolError>{input.reason}</ToolError>}
      {run.status === 'error' && <ToolError onRetry={run.rerun}>{run.error}</ToolError>}
      {run.status === 'loading' && !target && (
        <ToolVerdict tone="info" title="Finding the PDS" icon={VERDICT_ICON.pending}>
          Working out whether this is a PDS hostname or an account.
        </ToolVerdict>
      )}

      {target && (
        <>
          {verdict ? (
            <ToolVerdict tone={verdict.tone} title={verdict.title} icon={VERDICT_ICON[verdict.tone]}>
              {verdict.text}
            </ToolVerdict>
          ) : listFailed ? (
            <ToolError onRetry={releases.rerun}>
              {releases.error} {target.host} reports {probe?.version}, which is left uncompared.
            </ToolError>
          ) : (
            <ToolVerdict
              tone="info"
              title={probe ? 'Reading the release list' : `Asking ${target.host} what it runs`}
              icon={VERDICT_ICON.pending}
            >
              {probe
                ? `It reports ${probe.version}. Looking that up among the releases of the reference PDS.`
                : 'A PDS reports its version at /xrpc/_health.'}
            </ToolVerdict>
          )}

          {reading?.kind === 'release' && standing && (
            <ToolSection title="Version">
              <ToolCard>
                <ToolFacts>
                  <ToolFact label="Running">{standing.running.version}</ToolFact>
                  <ToolFact label="Published" plain>
                    {published(standing.running, now)}
                  </ToolFact>
                  {/* When it runs the latest, the two rows above already say so. */}
                  {standing.state !== 'current' && (
                    <>
                      <ToolFact label="Latest release">{standing.latest.version}</ToolFact>
                      <ToolFact label="Latest published" plain>
                        {published(standing.latest, now)}
                      </ToolFact>
                    </>
                  )}
                  {behind && behind.since !== null && (
                    <ToolFact label="Behind since" plain>
                      {formatReleaseDay(behind.since)} ({formatSpan(now - behind.since)})
                    </ToolFact>
                  )}
                </ToolFacts>
                <p className="fn-tool-note fn-tool-pds-note">
                  {reading.via === 'distribution' ? (
                    <>
                      The host reports <code>{reading.reported}</code>, which is how the{' '}
                      <a href={DISTRIBUTION_URL} target="_blank" rel="noreferrer noopener">
                        self-host distribution
                      </a>{' '}
                      numbers release {reading.version} of <code>{PDS_PACKAGE}</code>: the minor and patch run
                      together after its own <code>0.4</code>.
                    </>
                  ) : (
                    <>
                      Read from the number alone: <code>{reading.reported}</code> is a release of{' '}
                      <code>{PDS_PACKAGE}</code>. A fork or other software that reports the same number would be read
                      the same way.
                    </>
                  )}
                </p>
              </ToolCard>
            </ToolSection>
          )}

          {behind && (
            <ToolSection
              title="Released since"
              meta={behind.missed.length === 1 ? '1 release' : `${behind.missed.length} releases`}
            >
              <ToolCard>
                <ToolFacts>
                  {behind.missed
                    .slice(-MISSED_SHOWN)
                    .reverse()
                    .map((release) => (
                      <ToolFact key={release.version} label={release.version} plain>
                        {published(release, now)}
                      </ToolFact>
                    ))}
                </ToolFacts>
                <p className="fn-tool-note fn-tool-pds-note">
                  {behind.missed.length > MISSED_SHOWN &&
                    `And ${behind.missed.length - MISSED_SHOWN} earlier ${
                      behind.missed.length - MISSED_SHOWN === 1 ? 'release' : 'releases'
                    }. `}
                  What changed in each is in the package&rsquo;s{' '}
                  <a href={CHANGELOG_URL} target="_blank" rel="noreferrer noopener">
                    changelog
                  </a>
                  .
                </p>
              </ToolCard>
            </ToolSection>
          )}

          {behind && reading?.kind === 'release' && (
            <ToolSection title="Updating">
              <ToolCard>
                {reading.via === 'distribution' ? (
                  <p>
                    The self-host distribution updates itself: its compose file runs Watchtower, which pulls the newest
                    image each night. To update now, run this on the server:
                  </p>
                ) : (
                  <p>
                    This host reports the package&rsquo;s own version number. If it was set up with the self-host
                    distribution&rsquo;s installer, run this on the server to update it:
                  </p>
                )}
                <ToolCode copy={DISTRIBUTION_UPDATE_COMMAND} label="command">
                  {DISTRIBUTION_UPDATE_COMMAND}
                </ToolCode>
                <p className="fn-tool-note fn-tool-pds-note">
                  {reading.via === 'distribution'
                    ? 'A host that stays behind for days is not getting those nightly updates, so check that its Watchtower container is still running.'
                    : `A custom build updates its ${PDS_PACKAGE} dependency and deploys again.`}{' '}
                  This page does not change anything on the host.
                </p>
              </ToolCard>
            </ToolSection>
          )}

          <ToolSection title="The host">
            <ToolCard>
              <ToolFacts>
                <ToolFact label="Hostname" copy={target.host}>
                  {target.host}
                </ToolFact>
                <ToolFact label="Answers as a PDS" plain>
                  {probe === undefined ? 'Asking…' : probe.reachable ? 'Yes' : 'No. It did not answer describeServer.'}
                </ToolFact>
                {probe?.version && (
                  <ToolFact label="Reports" wide>
                    {probe.version.length > 80 ? `${probe.version.slice(0, 80)}…` : probe.version}
                  </ToolFact>
                )}
                {probe?.did && (
                  <ToolFact label="Server DID" copy={probe.did}>
                    {probe.did}
                  </ToolFact>
                )}
                {target.account && (
                  <ToolFact label="Looked up from">
                    <Link href={`/explore/${target.account.did}`} prefetch={false}>
                      {target.account.handle ? `@${target.account.handle}` : target.account.did}
                    </Link>
                  </ToolFact>
                )}
              </ToolFacts>
              {probe?.reachable && (
                <div className="fn-tool-actions">
                  <Link
                    href={`/explore/pds/${encodeURIComponent(target.host)}`}
                    prefetch={false}
                    className="fx-btn fx-btn-sm"
                  >
                    Open this PDS in the Explorer
                  </Link>
                  {/* A static page, so the link keeps its prefetch. */}
                  <Link
                    href={`${toolHref('relay')}?host=${encodeURIComponent(target.host)}`}
                    rel="nofollow"
                    className="fx-btn fx-btn-sm"
                  >
                    Relay crawl check
                  </Link>
                </div>
              )}
            </ToolCard>
          </ToolSection>
        </>
      )}

      {!raw && (
        <ToolIntro
          title="How it works"
          items={[
            {
              term: 'The host says what it runs',
              text: (
                <>
                  A PDS reports a version at <code>/xrpc/_health</code>. The reference PDS answers with its package
                  version unless its operator has set another.
                </>
              ),
            },
            {
              term: 'The number is matched to a release',
              text: (
                <>
                  Releases are the stable versions of <code>{PDS_PACKAGE}</code> on npm. The self-host distribution
                  that most self-hosted PDSs run numbers them its own way, so <code>0.4.5065</code> is read as release
                  0.5.65.
                </>
              ),
            },
            {
              term: 'It is compared with the latest',
              text: 'Up to date, or how many releases behind and since when. A release from the last two days is not counted against a host, since most update themselves overnight.',
            },
            {
              term: 'It says when it cannot compare',
              text: 'Bluesky’s own hosts report a commit hash, and other PDS software has releases of its own. Neither is guessed at.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}

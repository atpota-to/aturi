'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Info, LoaderCircle, ServerCog, TriangleAlert, X } from 'lucide-react';
import { toolHref } from '@/lib/tools/catalog';
import { resolvePdsTarget, type PdsTarget } from '@/lib/tools/pdsTargetClient';
import {
  DISTRIBUTION_UPDATE_COMMAND,
  PDS_PACKAGE,
  PDS_SOFTWARE,
  formatReleaseDay,
  formatSpan,
  pdsVersionVerdict,
  readReportedVersion,
  softwareOf,
  versionStanding,
  type PdsRelease,
  type PdsReleaseList,
  type PdsSoftwareId,
} from '@/lib/tools/pdsVersion';
import { fetchPdsReleases, pdsReleasesRun } from '@/lib/tools/pdsVersionClient';
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
function published(at: number, now: number): string {
  return `${formatReleaseDay(at)} (${formatSpan(now - at)} ago)`;
}

/** A software's name as a value of its own, where a sentence would not capitalize it. */
function titled(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The newest of the releases a host lacks, newest first, and how many more there are. */
function newestMissed(missed: PdsRelease[]): { shown: PdsRelease[]; more: number } {
  return { shown: missed.slice(-MISSED_SHOWN).reverse(), more: Math.max(0, missed.length - MISSED_SHOWN) };
}

/**
 * Asks a PDS what version it runs and compares that with the releases of the
 * software it names. The logic is in src/lib/tools/pdsVersion.ts.
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

  // Only a version that could be a release of something needs that list read.
  const software = softwareOf(probe?.version);
  const releases = useSharedToolRun<PdsReleaseList>(software ? pdsReleasesRun(software) : null, ({ signal }) =>
    fetchPdsReleases(software as PdsSoftwareId, signal),
  );
  const [now] = useState(() => Date.now());
  const list = releases.data ?? null;
  const listFailed = software !== null && releases.status === 'error';
  const reading = probe ? readReportedVersion(probe.version, list) : null;
  const standing = reading?.kind === 'release' && list ? versionStanding(reading.version, list, now) : null;
  const verdict =
    target && probe && reading ? pdsVersionVerdict(target.host, probe.reachable, reading, standing, now) : null;
  const behind = standing?.state === 'behind' ? standing : null;
  const release = reading?.kind === 'release' ? reading : null;
  const product = release ? PDS_SOFTWARE[release.software] : null;
  const missed = behind ? newestMissed(behind.missed) : null;

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
          busy={run.status === 'loading' || (software !== null && releases.status === 'loading')}
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
              {releases.error} {target.host} reports {probe?.version}.
            </ToolError>
          ) : (
            <ToolVerdict
              tone="info"
              title={probe ? 'Reading the release list' : `Asking ${target.host} what it runs`}
              icon={VERDICT_ICON.pending}
            >
              {probe ? `It reports ${probe.version}.` : 'A PDS reports its version at /xrpc/_health.'}
            </ToolVerdict>
          )}

          {release && product && standing && (
            <ToolSection title="Version">
              <ToolCard>
                <ToolFacts>
                  <ToolFact label="Software" plain>
                    {titled(product.name)}
                  </ToolFact>
                  <ToolFact label="Running">{standing.running.version}</ToolFact>
                  {standing.running.published !== null && (
                    <ToolFact label="Published" plain>
                      {published(standing.running.published, now)}
                    </ToolFact>
                  )}
                  {/* When it runs the latest, the rows above already say so. */}
                  {standing.state !== 'current' && (
                    <ToolFact label="Latest release">{standing.latest.version}</ToolFact>
                  )}
                  {standing.state !== 'current' && standing.latest.published !== null && (
                    <ToolFact label="Latest published" plain>
                      {published(standing.latest.published, now)}
                    </ToolFact>
                  )}
                  {behind && behind.since !== null && (
                    <ToolFact label="Behind since" plain>
                      {formatReleaseDay(behind.since)} ({formatSpan(now - behind.since)})
                    </ToolFact>
                  )}
                </ToolFacts>
                <p className="fn-tool-note fn-tool-pds-note">
                  {release.via === 'distribution' ? (
                    <>
                      Reported as <code>{release.reported}</code>, which is how the{' '}
                      <a href={DISTRIBUTION_URL} target="_blank" rel="noreferrer noopener">
                        self-host distribution
                      </a>{' '}
                      numbers release {release.version}.
                    </>
                  ) : release.via === 'package' ? (
                    <>
                      Matched by number alone. A fork or other software reporting <code>{release.reported}</code>{' '}
                      would read the same.
                    </>
                  ) : (
                    <>
                      Reported as <code>{release.reported}</code>.{' '}
                      {release.ahead > 0 &&
                        `That is ${release.ahead} ${release.ahead === 1 ? 'commit' : 'commits'} past the ${release.version} tag. `}
                      Releases are {product.source.kind === 'git' ? 'the tags in its repository' : 'its versions on npm'}.
                    </>
                  )}
                </p>
              </ToolCard>
            </ToolSection>
          )}

          {behind && missed && product && (
            <ToolSection
              title="Released since"
              meta={behind.missed.length === 1 ? '1 release' : `${behind.missed.length} releases`}
            >
              <ToolCard>
                <ToolFacts>
                  {/* A git tag has no date here, so those are a line of versions. */}
                  {missed.shown.every((item) => item.published === null) ? (
                    <ToolFact label={missed.shown.length === 1 ? 'Version' : 'Versions, newest first'} wide>
                      {missed.shown.map((item) => item.version).join(', ')}
                    </ToolFact>
                  ) : (
                    missed.shown.map((item) => (
                      <ToolFact key={item.version} label={item.version} plain>
                        {item.published === null ? 'Not dated' : published(item.published, now)}
                      </ToolFact>
                    ))
                  )}
                </ToolFacts>
                <p className="fn-tool-note fn-tool-pds-note">
                  {missed.more > 0 && `And ${missed.more} earlier. `}
                  {product.source.kind === 'git' ? 'Each is a tag in its ' : 'What changed is in the '}
                  <a href={product.releasesUrl} target="_blank" rel="noreferrer noopener">
                    {product.source.kind === 'git' ? 'repository' : 'changelog'}
                  </a>
                  .
                </p>
              </ToolCard>
            </ToolSection>
          )}

          {/* The one update path this page can vouch for is the reference PDS's own. */}
          {behind && release?.software === 'reference' && (
            <ToolSection title="Updating">
              <ToolCard>
                {release.via === 'distribution' ? (
                  <p>The self-host distribution updates itself nightly with Watchtower. To update now, on the server:</p>
                ) : (
                  <p>If it was installed with the self-host distribution, run this on the server:</p>
                )}
                <ToolCode copy={DISTRIBUTION_UPDATE_COMMAND} label="command">
                  {DISTRIBUTION_UPDATE_COMMAND}
                </ToolCode>
                <p className="fn-tool-note fn-tool-pds-note">
                  {release.via === 'distribution'
                    ? 'If it stays behind, check that its Watchtower container is running.'
                    : `A custom build updates its ${PDS_PACKAGE} dependency and redeploys.`}{' '}
                  This page changes nothing on the host.
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
                  A PDS reports its version at <code>/xrpc/_health</code>.
                </>
              ),
            },
            {
              term: 'The version is matched to a release',
              text: (
                <>
                  The reference PDS reports a number, which its self-host distribution writes its own way:{' '}
                  <code>0.4.5065</code> is release 0.5.65. Tranquil, Cirrus, Cocoon and Tangled knots put their name
                  first, as in <code>tranquil 0.9.1</code>.
                </>
              ),
            },
            {
              term: 'It’s compared with the latest',
              text: 'Releases are read from npm or from the project’s git tags. Where they’re dated, one under two days old isn’t counted against a host, since most update overnight.',
            },
            {
              term: 'It says when it can’t compare',
              text: 'Bluesky’s own hosts report a commit hash, and some software publishes no releases to compare with.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}

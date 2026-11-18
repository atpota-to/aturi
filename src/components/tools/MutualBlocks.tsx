'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, ExternalLink, LoaderCircle, RotateCw, Square, UserX, Users, X } from 'lucide-react';
import { Credit } from '@/components/explore/lexicons/primitives';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { toolHref } from '@/lib/tools/catalog';
import {
  bskyListUrl,
  countAtLeast,
  highestCount,
  histogram,
  histogramBins,
  parseAccountInput,
  parseThreshold,
  rankCandidates,
  rankListBlocks,
  selectedByDefault,
  suggestThreshold,
  summary,
  SNAPSHOT_MIN_BLOCKERS,
  type Candidate,
  type CandidateFlags,
  type Person,
} from '@/lib/tools/mutuals';
import { describeLists, forgetScan, loadProfiles, scanMutuals, type ListInfo, type Scan, type ScanStopper } from '@/lib/tools/mutualsClient';
import { explorePathFromAtUri } from '@/utils/atproto/urls';
import { Distribution, Face, MutualWall, who } from './MutualBlocksCharts';
import MutualBlocksOrbit from './MutualBlocksOrbit';
import MutualBlocksSave from './MutualBlocksSave';
import {
  ToolCard,
  ToolEmpty,
  ToolError,
  ToolForm,
  ToolIntro,
  ToolSection,
  ToolShell,
  ToolSkeleton,
  ToolVerdict,
} from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'mutuals';
const nf = new Intl.NumberFormat('en-US');

/** Accounts drawn on the map. More turns the outer ring into a fence. */
const MAP_SIZE = 36;
/** Rows listed, and added by "Show more". */
const PAGE = 50;
/** Block lists described. */
const LISTS_SHOWN = 12;
/** Blockers shown by face in a row before the rest are counted. */
const ROW_FACES = 5;
/** Accounts described up front, from the top of the ranking. */
const DESCRIBE_UP_TO = 1000;

/* -------------------------------------------------------------------------- *
 * Profiles of the accounts on show
 * -------------------------------------------------------------------------- */

const NO_PROFILES: ReadonlyMap<string, Person | null> = new Map();
const NO_DIDS: ReadonlySet<string> = new Set();

/**
 * Profiles for the accounts the page is showing, fetched as they come into
 * view and kept for the life of the scan. A DID the AppView does not know
 * maps to null. One whose request failed is listed in `failed` and shown by
 * its DID.
 *
 * Requests are not cancelled when what is wanted changes, only ignored once
 * the scan they were for is no longer the one on the page: they are small,
 * and cancelling one as the list grew would lose the answer for rows still
 * on show.
 */
function useProfiles(
  scanKey: string | null,
  wanted: readonly string[],
): { profiles: ReadonlyMap<string, Person | null>; failed: ReadonlySet<string> } {
  const [store, setStore] = useState<{
    key: string | null;
    profiles: Map<string, Person | null>;
    failed: Set<string>;
  }>({ key: null, profiles: new Map(), failed: new Set() });
  const asked = useRef<{ key: string | null; dids: Set<string> }>({ key: null, dids: new Set() });
  const mine = store.key === scanKey;
  const profiles = mine ? store.profiles : NO_PROFILES;
  const failed = mine ? store.failed : NO_DIDS;
  const missing = scanKey ? wanted.filter((did) => !profiles.has(did) && !failed.has(did)) : [];
  const missingKey = missing.join(',');

  useEffect(() => {
    if (!scanKey || !missingKey) return;
    if (asked.current.key !== scanKey) asked.current = { key: scanKey, dids: new Set() };
    const seen = asked.current.dids;
    const dids = missingKey.split(',').filter((did) => !seen.has(did));
    if (dids.length === 0) return;
    for (const did of dids) seen.add(did);
    void loadProfiles(dids, new AbortController().signal).then(({ profiles: found, failed: lost }) => {
      if (asked.current.key !== scanKey) return;
      setStore((prev) => {
        const same = prev.key === scanKey;
        const next = new Map(same ? prev.profiles : []);
        const nextFailed = new Set(same ? prev.failed : []);
        for (const did of dids) {
          if (found.has(did)) next.set(did, found.get(did) ?? null);
          else if (lost.has(did)) nextFailed.add(did);
          else next.set(did, null);
        }
        return { key: scanKey, profiles: next, failed: nextFailed };
      });
    });
  }, [missingKey, scanKey]);

  return { profiles, failed };
}

/* -------------------------------------------------------------------------- *
 * Rows
 * -------------------------------------------------------------------------- */

function Flags({ flags }: { flags: CandidateFlags }) {
  return (
    <>
      {flags.mutual && <span className="fn-tool-pill" data-tone="warn">Mutual</span>}
      {!flags.mutual && flags.followed && <span className="fn-tool-pill" data-tone="warn">Followed</span>}
      {flags.blocked && <span className="fn-tool-pill">Already blocked</span>}
    </>
  );
}

function CandidateRow({
  candidate,
  profile,
  flags,
  checked,
  onCheck,
  mutuals,
  mutualsRead,
  expanded,
  onExpand,
}: {
  candidate: Candidate;
  profile: Person | null | undefined;
  flags: CandidateFlags;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  mutuals: readonly Person[];
  mutualsRead: number;
  expanded: boolean;
  onExpand: () => void;
}) {
  const name = profile ? profile.displayName || who(profile) : profile === null ? 'Account not found' : candidate.did;
  const sub = profile ? (profile.displayName ? who(profile) : null) : candidate.did;
  const share = mutualsRead > 0 ? candidate.blockers.length / mutualsRead : 0;
  const blockers = candidate.blockers.map((m) => mutuals[m]).filter(Boolean);
  return (
    <li className="fn-tool-row fn-tool-mutuals-row" data-unticked={!checked || undefined}>
      <label className="fn-tool-mutuals-tick-box">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheck(event.target.checked)}
          aria-label={`Put ${profile ? who(profile) : candidate.did} on the list`}
        />
        <span aria-hidden>
          <Check size={13} />
        </span>
      </label>
      <Face person={profile ?? null} size={36} />
      <div className="fn-tool-row-main">
        <Link href={`/explore/${candidate.did}`} prefetch={false} className="fn-tool-row-title">
          {name}
        </Link>
        <span className="fn-tool-row-sub fn-tool-mutuals-row-sub">
          {sub && <span data-mono={!profile || undefined}>{sub}</span>}
          <Flags flags={flags} />
        </span>
        {expanded && (
          <ul className="fn-tool-mutuals-blockers">
            {blockers.map((person) => (
              <li key={person.did}>
                <Link href={`/explore/${person.did}`} prefetch={false}>
                  <Face person={person} size={18} />
                  {who(person)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="fn-tool-mutuals-row-end">
        <button
          type="button"
          className="fn-tool-mutuals-stack"
          onClick={onExpand}
          aria-expanded={expanded}
          aria-label={`Blocked by ${blockers.length} mutuals. ${expanded ? 'Hide' : 'Show'} them.`}
        >
          {blockers.slice(0, ROW_FACES).map((person) => (
            <Face key={person.did} person={person} size={22} />
          ))}
          <ChevronDown size={14} aria-hidden data-open={expanded || undefined} />
        </button>
        <span className="fn-tool-mutuals-meter" title={`${candidate.blockers.length} of ${mutualsRead} mutuals`}>
          <span className="fn-tool-mutuals-meter-n">
            <strong>{nf.format(candidate.blockers.length)}</strong> / {nf.format(mutualsRead)}
          </span>
          <span className="fn-tool-mutuals-meter-track" aria-hidden>
            <span style={{ width: `${Math.max(3, share * 100)}%` }} />
          </span>
        </span>
      </div>
    </li>
  );
}

function ListRow({ uri, info, subscribers }: { uri: string; info: ListInfo | null | undefined; subscribers: number }) {
  const explorer = explorePathFromAtUri(uri) ?? '/explore';
  const bsky = info ? bskyListUrl(uri) : null;
  return (
    <li className="fn-tool-row">
      {info?.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={info.avatar} alt="" width={32} height={32} loading="lazy" className="fn-tool-avatar" data-shape="square" />
      ) : (
        <span className="fn-tool-avatar fn-tool-mutuals-blank" data-shape="square" aria-hidden>
          <UserX size={15} />
        </span>
      )}
      <div className="fn-tool-row-main">
        <Link href={explorer} prefetch={false} className="fn-tool-row-title">
          {info ? info.name : info === null ? 'List not available' : 'Loading…'}
        </Link>
        <span className="fn-tool-row-sub">
          {info ? (
            <>
              by{' '}
              <Link href={`/explore/${info.creator.did}`} prefetch={false}>
                {who(info.creator)}
              </Link>
              {info.memberCount !== null && ` · ${nf.format(info.memberCount)} ${info.memberCount === 1 ? 'account' : 'accounts'}`}
            </>
          ) : (
            <span data-mono>{uri}</span>
          )}
        </span>
      </div>
      <span className="fn-tool-row-end">
        <span className="fn-tool-pill">
          {nf.format(subscribers)} {subscribers === 1 ? 'mutual' : 'mutuals'}
        </span>
        {bsky && (
          <a
            href={bsky}
            target="_blank"
            rel="noopener noreferrer"
            className="fx-btn fx-btn-sm fx-btn-icon fn-tool-mutuals-out"
            aria-label={`Open ${info?.name ?? 'the list'} in Bluesky, to subscribe to it`}
            title="Open in Bluesky, to subscribe to it"
          >
            <ExternalLink size={14} aria-hidden />
          </a>
        )}
      </span>
    </li>
  );
}

/* -------------------------------------------------------------------------- *
 * The tool
 * -------------------------------------------------------------------------- */

/**
 * Finds the accounts an account's mutuals block, and how much they agree.
 * The logic is in src/lib/tools/mutuals.ts, the requests in mutualsClient.ts
 * and the writes in mutualsSave.ts; this runs them and draws the result.
 */
export default function MutualBlocks() {
  const [{ account: raw, min }, setQuery] = useToolQuery(['account', 'min'] as const);
  const input = raw ? parseAccountInput(raw) : null;
  const actor = input?.ok ? input.actor : null;
  const { did: signedIn } = useAtprotoSession();

  const stopper = useRef<ScanStopper>({ stop: false });
  const [stopping, setStopping] = useState<string | null>(null);
  const run = useToolRun<Scan>(actor, ({ signal, publish }) => {
    const next = { stop: false };
    stopper.current = next;
    return scanMutuals(actor as string, { signal, publish, stopper: next });
  });
  const scan = run.data;
  const done = scan?.phase === 'done';
  const scanKey = scan ? `${actor}|${scan.account.did}` : null;

  // Everything the page shows is a view of the tally, so it is worked out
  // again as the tally grows and not otherwise.
  const version = scan ? `${scanKey}:${scan.version}:${scan.phase}` : null;
  const counts = useMemo(
    () => (scan ? (scan.restored?.counts ?? histogram(scan.tally)) : [0]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
  // Mutuals whose blocks are in the counts: every one read to the end, and
  // any being read or stopped partway through, so a count never exceeds it.
  const mutualsRead = scan
    ? scan.states.filter(
        (s) => s.status === 'done' || (s.status === 'reading' && s.blocks > 0) || (s.status === 'skipped' && s.stopped && s.blocks > 0),
      ).length
    : 0;
  // Mutuals whose repositories could not be read, apart from those the scan
  // was stopped before reaching, which are not a failure of anything.
  const skipped = scan ? scan.states.filter((s) => s.status === 'skipped' && !s.stopped) : [];
  const notReached = scan ? scan.states.filter((s) => s.status === 'skipped' && s.stopped).length : 0;
  const neverStarted = scan ? scan.states.filter((s) => s.status === 'skipped' && s.stopped && s.blocks === 0).length : 0;
  const highest = highestCount(counts);
  const lowest = scan?.restored ? SNAPSHOT_MIN_BLOCKERS : 1;
  const asked = parseThreshold(min);
  const threshold = Math.max(lowest, asked ?? suggestThreshold(mutualsRead, counts));
  const matching = countAtLeast(counts, threshold);

  const [focusState, setFocus] = useState<{ key: string | null; index: number | null }>({ key: null, index: null });
  const focus = focusState.key === scanKey ? focusState.index : null;
  const focusOn = (index: number | null) => setFocus({ key: scanKey, index });

  // Ranked once the scan has finished: nothing shows the ranking before
  // then, and sorting a tally of a hundred thousand accounts on every
  // redraw of a running scan would be wasted.
  const ranked = useMemo(
    () => (scan && done ? rankCandidates(scan.tally, threshold) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, threshold],
  );
  const shownCandidates = useMemo(
    () => (focus === null ? ranked : ranked.filter((c) => c.blockers.includes(focus))),
    [ranked, focus],
  );

  const [pageState, setPage] = useState<{ key: string; count: number }>({ key: '', count: PAGE });
  const pageKey = `${scanKey}|${threshold}|${focus}`;
  const shownCount = pageState.key === pageKey ? pageState.count : PAGE;

  const [expandedState, setExpanded] = useState<{ key: string | null; did: string | null }>({ key: null, did: null });
  const expanded = expandedState.key === scanKey ? expandedState.did : null;

  // Profiles for the top of the ranking, and for every row shown past it.
  // Knowing them up front keeps accounts that no longer exist (often a good
  // share of what people block) off the map and out of the way of the list.
  const wanted = useMemo(
    () => shownCandidates.slice(0, Math.max(DESCRIBE_UP_TO, shownCount + PAGE)).map((c) => c.did),
    [shownCandidates, shownCount],
  );
  const { profiles, failed } = useProfiles(done ? scanKey : null, done ? wanted : []);
  // The map and the list wait for the top of the ranking to be described,
  // so they are drawn once rather than reshuffled as answers come in.
  const described = shownCandidates
    .slice(0, DESCRIBE_UP_TO)
    .every((c) => profiles.has(c.did) || failed.has(c.did));
  const gone = useMemo(
    () => shownCandidates.filter((c) => profiles.get(c.did) === null),
    [shownCandidates, profiles],
  );
  const present = useMemo(
    () => (gone.length ? shownCandidates.filter((c) => profiles.get(c.did) !== null) : shownCandidates),
    [shownCandidates, profiles, gone.length],
  );
  const mapTargets = useMemo(() => present.slice(0, MAP_SIZE), [present]);
  const rows = present.slice(0, shownCount);

  const mutualSet = useMemo(() => new Set(scan?.mutuals.map((m) => m.did) ?? []), [scan?.mutuals]);
  const flagsFor = (did: string): CandidateFlags => ({
    followed: scan?.follows.has(did) ?? false,
    mutual: mutualSet.has(did),
    blocked: scan?.ownBlocks?.has(did) ?? false,
    missing: profiles.get(did) === null,
  });

  // Ticks the person changed, over the defaults. Kept with the scan they
  // belong to, so a new account starts from the defaults again.
  const [overrides, setOverrides] = useState<{ key: string | null; ticks: Map<string, boolean> }>({
    key: null,
    ticks: new Map(),
  });
  const ticks = overrides.key === scanKey ? overrides.ticks : new Map<string, boolean>();
  const isTicked = (did: string) => ticks.get(did) ?? selectedByDefault(flagsFor(did));
  const tick = (did: string, value: boolean) =>
    setOverrides({ key: scanKey, ticks: new Map(ticks).set(did, value) });
  const tickAll = (value: boolean) => {
    const next = new Map(ticks);
    for (const c of present) next.set(c.did, value);
    setOverrides({ key: scanKey, ticks: next });
  };
  const selected = ranked.filter((c) => isTicked(c.did)).map((c) => c.did);
  const untickedOnMap = new Set(mapTargets.filter((c) => !isTicked(c.did)).map((c) => c.did));

  const listSubs = useMemo(
    () => (scan && done ? rankListBlocks(scan.listBlocks) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
  const listUris = listSubs.slice(0, LISTS_SHOWN).map((l) => l.uri);
  const listsRun = useToolRun<Map<string, ListInfo | null>>(
    listUris.length ? `${scanKey}|${listUris.join(',')}` : null,
    ({ signal }) => describeLists(listUris, signal),
  );

  const setThreshold = (value: number) => setQuery({ min: String(value) }, { replace: true });
  const stop = () => {
    stopper.current.stop = true;
    setStopping(scanKey);
  };
  const rescan = () => {
    if (!actor) return;
    forgetScan(actor);
    setStopping(null);
    run.rerun();
  };

  const name = scan ? who(scan.account) : '';
  const share = actor
    ? `${toolHref(SLUG)}?account=${encodeURIComponent(actor)}${asked ? `&min=${asked}` : ''}`
    : undefined;

  let progressLine = '';
  let progressRatio = 0;
  if (scan && !done) {
    if (scan.phase === 'follows') {
      progressLine = `Listing who ${name} follows: ${nf.format(scan.progress)} of ${nf.format(scan.followsCount)}`;
      progressRatio = scan.followsCount ? scan.progress / scan.followsCount : 0;
    } else if (scan.phase === 'mutuals') {
      const of = scan.strategy === 'followers' ? scan.followersCount : scan.follows.size;
      progressLine =
        scan.strategy === 'followers'
          ? `Listing followers to find the mutuals: ${nf.format(scan.progress)} of ${nf.format(of)}`
          : `Checking which follows follow back: ${nf.format(scan.progress)} of ${nf.format(of)}`;
      progressRatio = of ? scan.progress / of : 0;
    } else {
      progressLine = `Reading blocks: ${nf.format(scan.progress)} of ${nf.format(scan.mutuals.length)} mutuals, ${nf.format(scan.blocksRead)} records`;
      progressRatio = scan.mutuals.length ? scan.progress / scan.mutuals.length : 0;
    }
  }

  return (
    <ToolShell
      slug={SLUG}
      wide
      share={share}
      form={
        <ToolForm
          value={raw}
          onSubmit={(value) => setQuery({ account: value, min: '' })}
          label="Account whose mutuals to check"
          placeholder="Your handle or DID"
          submitLabel="Find blocks"
          busy={run.status === 'loading'}
          icon={<Users size={17} />}
          examples={signedIn && !raw ? [{ label: 'My account', value: signedIn }] : undefined}
        />
      }
    >
      {input && !input.ok && <ToolError>{input.reason}</ToolError>}
      {run.status === 'error' && <ToolError onRetry={run.rerun}>{run.error}</ToolError>}

      {actor && !scan && run.status === 'loading' && (
        <>
          <ToolVerdict tone="info" title={`Looking up ${actor}`} icon={<LoaderCircle size={18} className="fn-tool-spin" />}>
            Resolving the account.
          </ToolVerdict>
          <ToolSkeleton rows={4} />
        </>
      )}

      {scan && (
        <>
          {!done ? (
            <div className="fn-tool-mutuals-running">
              <ToolVerdict tone="info" title={progressLine} icon={<LoaderCircle size={18} className="fn-tool-spin" />}>
                {scan.phase === 'blocks'
                  ? 'Each mutual’s block records are read from its own PDS. The results below fill in as they arrive.'
                  : 'Finding the accounts that follow each other with this one.'}
              </ToolVerdict>
              <div className="fn-tool-mutuals-running-bar">
                <div className="fn-tool-progress" role="progressbar" aria-valuenow={Math.round(progressRatio * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${Math.min(100, progressRatio * 100)}%` }} />
                </div>
                <button type="button" className="fx-btn fx-btn-sm" onClick={stop} disabled={stopping === scanKey}>
                  <Square size={12} aria-hidden /> {stopping === scanKey ? 'Stopping…' : 'Stop'}
                </button>
              </div>
            </div>
          ) : (
            <ToolVerdict
              tone="info"
              title={mutualsRead === 0 ? `No mutuals’ blocks could be read for ${name}` : `${summary(matching, threshold, mutualsRead)}`}
              icon={<Users size={18} />}
            >
              {scan.mutuals.length === 0
                ? `${name} has no mutuals: nobody they follow follows them back.`
                : [
                    `${name} has ${nf.format(scan.mutuals.length)} ${scan.mutuals.length === 1 ? 'mutual' : 'mutuals'}`,
                    skipped.length ? `${nf.format(skipped.length)} could not be read` : null,
                    scan.stopped ? `the scan was stopped with ${nf.format(notReached)} not read to the end` : null,
                    scan.partialMutuals ? 'only the first 20,000 follows were looked at' : null,
                  ]
                    .filter(Boolean)
                    .join('; ') + '.'}
            </ToolVerdict>
          )}

          {scan.mutuals.length > 0 && (
            <div className="fn-stat-grid fn-tool-mutuals-stats">
              <Stat label="Mutuals" value={nf.format(scan.mutuals.length)} sub={`of ${nf.format(scan.follows.size)} follows`} />
              <Stat
                label="Read"
                value={nf.format(mutualsRead)}
                sub={
                  !done
                    ? 'so far'
                    : [skipped.length ? `${nf.format(skipped.length)} skipped` : null, neverStarted ? `${nf.format(neverStarted)} not reached` : null]
                        .filter(Boolean)
                        .join(', ') || 'every one'
                }
              />
              <Stat label="Block records" value={nf.format(scan.blocksRead)} sub={`${nf.format(countAtLeast(counts, 1))} accounts`} />
              <Stat
                label={`Blocked by ${threshold} or more`}
                value={nf.format(matching)}
                sub={matching ? `up to ${nf.format(highest)} mutuals` : 'none yet'}
              />
            </div>
          )}

          {scan.restored && (
            <p className="fn-tool-note">
              Kept from the scan at{' '}
              {new Date(scan.restored.savedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}, so
              nothing was read again. Accounts blocked by a single mutual were not kept.{' '}
              <button type="button" className="fn-tool-link" onClick={rescan}>
                Scan again
              </button>
            </p>
          )}

          {scan.mutuals.length > 0 && (
            <ToolSection
              title="Mutuals"
              meta={
                done ? (
                  <button type="button" className="fn-tool-link" onClick={rescan}>
                    <RotateCw size={12} aria-hidden /> Scan again
                  </button>
                ) : (
                  `${nf.format(scan.progress)} of ${nf.format(scan.mutuals.length)} read`
                )
              }
            >
              <ToolCard>
                <MutualWall mutuals={scan.mutuals} states={scan.states} focus={focus} onFocus={focusOn} />
                <p className="fn-tool-note fn-tool-mutuals-wall-note">
                  {scan.mutuals.length > 160
                    ? 'One dot per mutual, more strongly coloured the more accounts it blocks. '
                    : 'One face per mutual, in the order they were found. '}
                  Choose one to see only the accounts it blocks.
                </p>
                {skipped.length > 0 && done && (
                  <p className="fn-tool-note">
                    {nf.format(skipped.length)} {skipped.length === 1 ? 'mutual' : 'mutuals'} could not be read, marked
                    with a red ring. Point at one to see why.
                  </p>
                )}
              </ToolCard>
            </ToolSection>
          )}

          {highest > 0 && (
            <ToolSection title="How many mutuals block each account" meta={`${nf.format(countAtLeast(counts, 1))} accounts`}>
              <ToolCard>
                <Distribution
                  bins={histogramBins(counts)}
                  highest={highest}
                  threshold={threshold}
                  onThreshold={setThreshold}
                  caption={summary(matching, threshold, mutualsRead)}
                  min={lowest}
                />
              </ToolCard>
            </ToolSection>
          )}

          {focus !== null && scan.mutuals[focus] && (
            <div className="fn-tool-mutuals-focus">
              <Face person={scan.mutuals[focus]} size={22} />
              <span>
                Showing only the accounts <strong>{who(scan.mutuals[focus])}</strong> blocks
              </span>
              <button type="button" className="fx-btn fx-btn-sm" onClick={() => focusOn(null)}>
                <X size={13} aria-hidden /> Show all
              </button>
            </div>
          )}

          {done && !described && shownCandidates.length > 0 && (
            <ToolSection title="Map">
              <ToolSkeleton rows={3} />
            </ToolSection>
          )}

          {done && described && mapTargets.length > 0 && (
            <ToolSection
              title="Map"
              meta={
                present.length > MAP_SIZE
                  ? `The top ${MAP_SIZE} of ${nf.format(present.length)}`
                  : `${nf.format(present.length)} ${present.length === 1 ? 'account' : 'accounts'}`
              }
            >
              <ToolCard>
                <MutualBlocksOrbit
                  account={scan.account}
                  targets={mapTargets}
                  mutuals={scan.mutuals}
                  profiles={profiles}
                  unticked={untickedOnMap}
                  mutualsRead={mutualsRead}
                  focus={focus}
                  onFocus={focusOn}
                />
              </ToolCard>
            </ToolSection>
          )}

          {done && highest > 0 && (
            <ToolSection
              title="Accounts"
              meta={`${nf.format(selected.length)} of ${nf.format(ranked.length)} ticked for the list`}
            >
              {shownCandidates.length > 0 && !described ? (
                <ToolSkeleton rows={6} />
              ) : shownCandidates.length === 0 ? (
                <ToolEmpty>
                  No account is blocked by that many mutuals. Lower the threshold above.
                </ToolEmpty>
              ) : (
                <>
                  <div className="fn-tool-bar fn-tool-mutuals-toolbar">
                    <button type="button" className="fx-btn fx-btn-sm" onClick={() => tickAll(true)}>
                      Tick all
                    </button>
                    <button type="button" className="fx-btn fx-btn-sm" onClick={() => tickAll(false)}>
                      Untick all
                    </button>
                    {ticks.size > 0 && (
                      <button
                        type="button"
                        className="fn-tool-link"
                        onClick={() => setOverrides({ key: scanKey, ticks: new Map() })}
                      >
                        Back to the defaults
                      </button>
                    )}
                    <span className="fn-tool-bar-end fn-tool-note">
                      Accounts {name} follows and mutuals start unticked.
                    </span>
                  </div>
                  <ToolCard flush>
                    <ul className="fn-tool-rows">
                      {rows.map((candidate) => (
                        <CandidateRow
                          key={candidate.did}
                          candidate={candidate}
                          profile={profiles.get(candidate.did)}
                          flags={flagsFor(candidate.did)}
                          checked={isTicked(candidate.did)}
                          onCheck={(value) => tick(candidate.did, value)}
                          mutuals={scan.mutuals}
                          mutualsRead={mutualsRead}
                          expanded={expanded === candidate.did}
                          onExpand={() =>
                            setExpanded({ key: scanKey, did: expanded === candidate.did ? null : candidate.did })
                          }
                        />
                      ))}
                    </ul>
                  </ToolCard>
                  {present.length > rows.length && (
                    <div className="fn-tool-mutuals-more">
                      <button
                        type="button"
                        className="fn-btn"
                        onClick={() => setPage({ key: pageKey, count: shownCount + PAGE })}
                      >
                        Show {nf.format(Math.min(PAGE, present.length - rows.length))} more
                      </button>
                      <span className="fn-tool-note">
                        {nf.format(rows.length)} of {nf.format(present.length)} shown
                      </span>
                    </div>
                  )}
                  {gone.length > 0 && (
                    <p className="fn-tool-note fn-tool-mutuals-gone">
                      {nf.format(gone.length)} {gone.length === 1 ? 'account that no longer exists is' : 'accounts that no longer exist are'}{' '}
                      left out: deleted, deactivated or taken down since they were blocked.
                    </p>
                  )}
                </>
              )}
            </ToolSection>
          )}

          {done && listSubs.length > 0 && (
            <ToolSection title="Block lists your mutuals use" meta={`${nf.format(listSubs.length)} ${listSubs.length === 1 ? 'list' : 'lists'}`}>
              <p className="fn-tool-note fn-tool-mutuals-hint">
                Moderation lists your mutuals block wholesale. Their members are not counted above; each list would take
                a request per hundred members to open.
              </p>
              <ToolCard flush>
                <ul className="fn-tool-rows">
                  {listSubs.slice(0, LISTS_SHOWN).map((sub) => (
                    <ListRow
                      key={sub.uri}
                      uri={sub.uri}
                      info={listsRun.data?.get(sub.uri)}
                      subscribers={sub.subscribers.length}
                    />
                  ))}
                </ul>
              </ToolCard>
            </ToolSection>
          )}

          {done && highest > 0 && (
            <ToolSection title="Save as a moderation list">
              <MutualBlocksSave
                selected={selected}
                threshold={threshold}
                mutualsRead={mutualsRead}
                scanned={{ did: scan.account.did, handle: scan.account.handle }}
              />
            </ToolSection>
          )}

          {done && (
            <p className="fn-tool-note fn-tool-mutuals-caveat">
              Being blocked by many of someone’s mutuals is a signal, not proof of anything. People block for their own
              reasons, and a few friends who talk to each other can block the same account for the same one. Look before
              you add.
            </p>
          )}

          {done && <Credit standalone />}
        </>
      )}

      {!raw && (
        <ToolIntro
          title="How it works"
          items={[
            {
              term: 'Find the mutuals',
              text: 'Everyone the account follows who follows it back, from Bluesky’s AppView.',
            },
            {
              term: 'Read their blocks',
              text: (
                <>
                  Blocks are public. Each mutual’s <code>app.bsky.graph.block</code> records are read from its own PDS,
                  every page of them, along with the moderation lists it blocks.
                </>
              ),
            },
            {
              term: 'See where they agree',
              text: 'How many mutuals block each account, a map of who blocks whom, and a list ranked by agreement. Move the threshold and everything follows.',
            },
            {
              term: 'Save the ones you choose',
              text: 'Sign in and the ticked accounts become a moderation list on your account, which you can subscribe to, block, or share.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="fn-stat fn-tool-mutuals-stat">
      <span className="fn-stat-label">{label}</span>
      <span className="fn-stat-value">{value}</span>
      <span className="fn-tool-mutuals-stat-sub">{sub}</span>
    </div>
  );
}

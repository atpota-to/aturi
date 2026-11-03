'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import AppearIn from './AppearIn';
import { Skeleton } from '@/components/SkeletonLoader';
import {
  ATPOTATO,
  WEATHER_REPORT,
  compareWithUsual,
  diversityLevel,
  hostingLevel,
  type UsualComparison,
} from '@/utils/atpotatoWeather';

/**
 * "Atmospheric conditions" on /explore: the last minute of the whole
 * firehose, from atpota.to's weather station. The pulse below it says which
 * lexicons were busy over days; the live feed says what is being written, as
 * a sample. This says how much, and whether that is usual, which neither of
 * them can.
 *
 * Read in the browser, straight from atpota.to's public endpoints (they
 * answer any origin), so aturi runs no function for it and the visitor hits
 * atpota.to's CDN copy, a few seconds old at most. The almanac is asked for
 * in UTC whatever the visitor's zone: only its `normal` is used here, which
 * does not depend on the zone, and one fixed URL keeps one CDN copy.
 */

const ATMOSPHERE_URL = `${ATPOTATO}/api/atmosphere`;
const ALMANAC_URL = `${ATPOTATO}/api/weather-almanac?tz=UTC`;

/** The station's window is a minute, so a fresher reading would not be a different one. */
const REFRESH_MS = 60_000;

type Reading = {
  measuredAt: string;
  condition: string;
  recordsPerSecond: number;
  /** Different accounts that wrote anything; the station's only, not a fallback sample's. */
  accounts: number | null;
  diversity: { index: number; level: string; share: number; apps: number } | null;
  hosts: { index: number; share: number; independent: number } | null;
};

type State = {
  loaded: boolean;
  reading: Reading | null;
  usual: UsualComparison | null;
  /** The almanac answered, whether or not it had a usual to compare with yet. */
  almanac: boolean;
};

type Json = Record<string, unknown>;

function isObj(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readingOf(body: unknown): Reading | null {
  if (!isObj(body) || typeof body.measuredAt !== 'string' || typeof body.condition !== 'string') return null;
  const rate = isObj(body.records) ? num(body.records.perSecond) : null;
  if (rate === null) return null;

  const d = isObj(body.diversity) ? body.diversity : null;
  const index = d ? num(d.index) : null;
  const diversity =
    d && index !== null
      ? {
          index,
          // The page's own word when it sends one, so the two never disagree.
          level: typeof d.level === 'string' ? d.level : diversityLevel(index),
          share: num(d.share) ?? 0,
          apps: num(d.apps) ?? 0,
        }
      : null;

  const h = isObj(body.hosts) ? body.hosts : null;
  const hd = h && isObj(h.diversity) ? h.diversity : null;
  const hostIndex = hd ? num(hd.index) : null;
  const independent = h ? num(h.independent) : null;
  const hosts =
    hd && hostIndex !== null && independent !== null
      ? { index: hostIndex, share: num(hd.share) ?? 0, independent }
      : null;

  return {
    measuredAt: body.measuredAt,
    condition: body.condition,
    recordsPerSecond: rate,
    accounts: isObj(body.accounts) ? num(body.accounts.active) : null,
    diversity,
    hosts,
  };
}

function windowOf(value: unknown) {
  if (!isObj(value)) return null;
  const seconds = num(value.seconds);
  const creates = num(value.creates);
  return seconds !== null && creates !== null ? { seconds, creates, windows: num(value.windows) ?? 0 } : null;
}

function usualOf(body: unknown): UsualComparison | null {
  const normal = isObj(body) && isObj(body.normal) ? body.normal : null;
  const now = windowOf(normal?.now);
  const days = windowOf(normal?.days);
  const weeks = windowOf(normal?.weeks);
  return now && days && weeks ? compareWithUsual(now, days, weeks) : null;
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const whole = (n: number) => Math.round(n).toLocaleString('en-US');
const percent = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "+5%", "−7%", "±0%", as the report writes a change. */
function changeText(pct: number): string {
  if (pct === 0) return '±0%';
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

export default function AtmosphericConditions() {
  const [state, setState] = useState<State>({ loaded: false, reading: null, usual: null, almanac: false });

  useEffect(() => {
    let controller: AbortController | null = null;
    let lastLoad = 0;

    const load = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      lastLoad = Date.now();
      const [now, almanac] = await Promise.allSettled([
        getJson(ATMOSPHERE_URL, current.signal),
        getJson(ALMANAC_URL, current.signal),
      ]);
      if (current.signal.aborted) return;
      const reading = now.status === 'fulfilled' ? readingOf(now.value) : null;
      const answered = almanac.status === 'fulfilled' && isObj(almanac.value);
      // A refresh that fails keeps the last reading, whose time says how old it is.
      setState((prev) => ({
        loaded: true,
        reading: reading ?? prev.reading,
        usual: answered ? usualOf(almanac.value) : prev.usual,
        almanac: answered || prev.almanac,
      }));
    };

    // Only while someone can see it: a tab left open in the background
    // should not keep asking.
    const refresh = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad >= REFRESH_MS) void load();
    };

    void load();
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      controller?.abort();
    };
  }, []);

  const { loaded, reading, usual, almanac } = state;
  const down = loaded && !reading && !almanac;
  // The station can be up with a part missing (its fallback sample has no
  // accounts or hosts), or down while the almanac's history still answers.
  const missing = reading ? 'Not in this reading' : 'The station isn\u2019t answering';
  const updated = reading
    ? new Date(reading.measuredAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <AppearIn delay={0.09}>
      <section aria-labelledby="fn-wx-title" className="fn-list-card fn-wx">
        <div className="fn-wx-head">
          <div className="fn-wx-heading">
            <h2 id="fn-wx-title" className="fn-list-card-title">
              Atmospheric conditions
            </h2>
            <p className="fn-list-card-sub">
              The last minute of the whole firehose, from{' '}
              <a href={ATPOTATO} target="_blank" rel="noreferrer noopener">
                atpota.to
              </a>
              &rsquo;s weather station
            </p>
          </div>
          <div className="fn-wx-headside">
            {updated && (
              <span className="fn-wx-updated">
                Updated <time dateTime={reading!.measuredAt}>{updated}</time>
              </span>
            )}
            <a href={WEATHER_REPORT} target="_blank" rel="noreferrer noopener" className="fn-list-card-headlink">
              Full weather report
              <ExternalLink size={12} aria-hidden />
            </a>
          </div>
        </div>

        {down ? (
          <p className="explore-placeholder fn-list-card-msg">
            The weather station isn&rsquo;t answering right now. The full report may still have the
            latest it heard.
          </p>
        ) : (
          <dl className="fn-wx-grid">
            <Stat
              label="Right now"
              loading={!loaded}
              value={reading ? capitalize(reading.condition) : null}
              note={
                reading
                  ? `${whole(reading.recordsPerSecond)} records a second` +
                    (reading.accounts !== null ? ` · ${whole(reading.accounts)} accounts` : '')
                  : missing
              }
            />
            <Stat
              label="Against usual"
              loading={!loaded}
              value={usual ? changeText(usual.changePercent) : null}
              note={
                usual
                  ? `${capitalize(usual.verdict)} over the last hour`
                  : almanac
                    ? 'Still learning what usual looks like'
                    : 'The almanac isn’t answering'
              }
            />
            <Stat
              label="Diversity index"
              loading={!loaded}
              value={reading?.diversity ? reading.diversity.index.toFixed(2) : null}
              level={reading?.diversity?.level}
              note={
                reading?.diversity
                  ? `${percent(reading.diversity.share)} of active accounts write with ${whole(reading.diversity.apps)} other apps`
                  : missing
              }
            />
            <Stat
              label="Hosting diversity"
              loading={!loaded}
              value={reading?.hosts ? reading.hosts.index.toFixed(2) : null}
              level={reading?.hosts ? hostingLevel(reading.hosts.index) : undefined}
              note={
                reading?.hosts
                  ? `${percent(reading.hosts.share)} of accounts on ${whole(reading.hosts.independent)} independent PDSes`
                  : missing
              }
            />
          </dl>
        )}
      </section>
    </AppearIn>
  );
}

function Stat({
  label,
  loading,
  value,
  level,
  note,
}: {
  label: string;
  loading: boolean;
  value: string | null;
  level?: string;
  note: string;
}) {
  return (
    <div className="fn-wx-stat">
      <dt>{label}</dt>
      {loading ? (
        <>
          <dd className="fn-wx-value">
            <Skeleton width="4.5rem" height="1.4rem" />
          </dd>
          <dd className="fn-wx-note">
            <Skeleton width="85%" height="0.7rem" />
          </dd>
        </>
      ) : (
        <>
          <dd className="fn-wx-value">
            {value ?? '–'}
            {value && level && <span className="fn-wx-level">{level}</span>}
          </dd>
          <dd className="fn-wx-note">{note}</dd>
        </>
      )}
    </div>
  );
}

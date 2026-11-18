/**
 * atpota.to's weather report, the parts that both the explorer's conditions
 * card and the MCP weather tools need: the words atpota.to puts on its
 * numbers, and its rule for "busier than usual". Pure and dependency-free,
 * so a client component can import it without pulling in the MCP server.
 *
 * Every threshold here is atpota.to's own (website/server/atmosphere.ts and
 * website/src/scripts/weather-almanac.ts in atpota-to/atpota.to). When the
 * report moves one, move it here, or aturi words a reading differently from
 * the page it links to.
 */

export const ATPOTATO = 'https://atpota.to';
export const WEATHER_REPORT = `${ATPOTATO}/weather`;

/** Where each diversity index level starts, like the UV index. Below the last, 'low'. */
const DIVERSITY_LEVELS = [
  ['extreme', 11],
  ['very high', 8],
  ['high', 6],
  ['moderate', 3],
] as const;

export function diversityLevel(index: number): string {
  for (const [name, from] of DIVERSITY_LEVELS) if (index >= from) return name;
  return 'low';
}

/**
 * Where each hosting diversity level starts. Its own scale: it grows with the
 * share of accounts off Bluesky's hosts and how many hosts they're spread
 * across, so it runs to the hundreds. Below the last, 'early days'.
 */
const HOSTING_LEVELS = [
  ['flourishing', 200],
  ['well spread', 75],
  ['spreading', 25],
  ['taking root', 10],
] as const;

export function hostingLevel(index: number): string {
  for (const [name, from] of HOSTING_LEVELS) if (index >= from) return name;
  return 'early days';
}

/** Records and the seconds the station heard them in, for one window. */
export type HeardWindow = { seconds: number; creates: number; windows?: number };

export type UsualComparison = {
  /** 'weeks': the same hour on the same weekday; 'days': the same hour on the days before. */
  basis: 'weeks' | 'days';
  windows: number;
  /** The last hour's rate over usual's. */
  ratio: number;
  changePercent: number;
  verdict: string;
};

/** Quieter-than-usual edges, then busier ones (USUAL_EDGES on the page). */
const MUCH_QUIETER = 0.8;
const QUIETER = 0.93;
const BUSIER = 1.08;
const MUCH_BUSIER = 1.25;

/**
 * The last hour against usual, compared by rate. The same weekday once the
 * station has heard one, the same hour on the days before until then, and
 * nothing at all on less than half an hour of now: the station has gaps, and
 * a window it heard half of, compared by count, reads as a collapse.
 */
export function compareWithUsual(
  now: HeardWindow,
  days: HeardWindow,
  weeks: HeardWindow,
): UsualComparison | null {
  const basis = (weeks.windows ?? 0) > 0 ? 'weeks' : (days.windows ?? 0) > 0 ? 'days' : null;
  if (!basis || now.seconds < 1_800) return null;
  const base = basis === 'weeks' ? weeks : days;
  if (base.seconds <= 0 || base.creates <= 0) return null;
  const ratio = now.creates / now.seconds / (base.creates / base.seconds);
  const verdict =
    ratio >= MUCH_BUSIER ? 'much busier than usual'
      : ratio >= BUSIER ? 'busier than usual'
        : ratio <= MUCH_QUIETER ? 'much quieter than usual'
          : ratio <= QUIETER ? 'quieter than usual'
            : 'about as busy as usual';
  return { basis, windows: base.windows ?? 0, ratio, changePercent: Math.round((ratio - 1) * 100), verdict };
}

/**
 * Time-window presets shared by the trending strip, the lexicon detail
 * page, and the timeseries fetchers. `step` (seconds) and `bucketCount`
 * encode the sparkline/chart granularity for each window; all `step`s
 * satisfy the API's 3600s minimum.
 */

export type Window = '1d' | '7d' | '30d';

export type WindowConfig = {
  label: string;
  hours: number;
  step: number;
  bucketCount: number;
};

export const WINDOWS: Record<Window, WindowConfig> = {
  '1d': { label: '1d', hours: 24, step: 60 * 60 * 2, bucketCount: 12 },
  '7d': { label: '7d', hours: 24 * 7, step: 60 * 60 * 12, bucketCount: 14 },
  '30d': { label: '30d', hours: 24 * 30, step: 60 * 60 * 24, bucketCount: 30 },
};

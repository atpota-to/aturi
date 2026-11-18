/**
 * Driver selection. SERVER ONLY.
 */

import { requireBffConfig } from '../env';
import type { StoreDriver } from './driver';
import { PostgrestDriver } from './postgrest';

export { TABLE } from './driver';
export type { Row, StoreDriver, Where } from './driver';
export { StoreError } from './postgrest';

let cached: StoreDriver | null = null;
let cachedKey = '';

export function getStore(): StoreDriver {
  const cfg = requireBffConfig();
  const key = `${cfg.dbUrl}|${cfg.dbSchema}`;
  if (cached && cachedKey === key) return cached;

  const kind = (process.env.ATURI_DB_DRIVER || 'postgrest').trim().toLowerCase();
  if (kind !== 'postgrest') {
    // Fail loudly rather than silently falling back: a fork that set this on
    // purpose needs to know its driver is not present, not to discover it as
    // a schema mismatch three layers down.
    throw new Error(
      `ATURI_DB_DRIVER="${kind}" is not bundled. Only "postgrest" ships; see ` +
        'docs/backend-oauth.md for the StoreDriver interface to implement.',
    );
  }

  cached = new PostgrestDriver(cfg.dbUrl, cfg.dbServiceKey, cfg.dbSchema);
  cachedKey = key;
  return cached;
}

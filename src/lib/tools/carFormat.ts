/** A byte count in the unit a person would say it in: 512 B, 432 KB, 84.1 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** The first two segments of an NSID, which is the app it belongs to: `app.bsky`. */
export function appOfCollection(nsid: string): string {
  return nsid.split('.').slice(0, 2).join('.');
}

/**
 * The largest export the inspector will open. The file is held whole in
 * memory, and the index built over it (every block by CID, every record key)
 * takes about as much again, so this is set where a desktop browser still has
 * room to spare rather than at what merely fits.
 */
export const MAX_ARCHIVE_BYTES = 150 * 1024 * 1024;

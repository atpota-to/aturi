/**
 * Records from an opened repository archive, written out as one JSON file.
 *
 * The file is built as a Blob from many small pieces rather than one string.
 * A large repository's JSON runs to a hundred megabytes, which is more than
 * some engines will hold in a single string and enough to freeze a page that
 * tries; a Blob takes the pieces as they come, with a pause between batches
 * for the page to draw and for a Stop to land.
 *
 * Records are in the shape `com.atproto.repo.listRecords` returns them
 * (`uri`, `cid`, `value`), so the file reads like the API's own answer.
 */

import { exportRecord, type RepoArchive, type RepoCollection } from './carRepo';

/** Records turned to JSON between two chances for the page to draw. */
const RECORDS_PER_BATCH = 2000;

export type ExportSummary = { blob: Blob; written: number; skipped: number };

export async function buildJsonExport(
  archive: RepoArchive,
  collections: RepoCollection[],
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<ExportSummary> {
  const total = collections.reduce((sum, collection) => sum + collection.rkeys.length, 0);
  const head = {
    repo: archive.commit.did,
    rev: archive.commit.rev,
    commit: archive.commit.cid,
    collections: collections.map((collection) => collection.nsid),
  };
  // The head object is left open, and `records` added as its last member.
  const parts: string[] = [`${JSON.stringify(head, null, 2).slice(0, -2)},\n  "records": [`];
  let written = 0;
  let skipped = 0;
  let done = 0;
  let batch = '';

  for (const collection of collections) {
    for (let index = 0; index < collection.rkeys.length; index++) {
      const record = exportRecord(archive, collection, index);
      if (record) {
        batch += `${written === 0 ? '\n' : ',\n'}    ${JSON.stringify(record)}`;
        written++;
      } else {
        // Listed by the tree, but its block is not in the file or is not readable.
        skipped++;
      }
      done++;
      if (done % RECORDS_PER_BATCH === 0) {
        parts.push(batch);
        batch = '';
        options.onProgress?.(done, total);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (options.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      }
    }
  }
  parts.push(batch, written === 0 ? ']\n}\n' : '\n  ]\n}\n');
  return { blob: new Blob(parts, { type: 'application/json' }), written, skipped };
}

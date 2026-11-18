/**
 * What an opened archive's structure says about it, as a check list: is the
 * tree all there, is every record it lists in the file, do the blocks hash
 * to their addresses. The page draws these; the words are decided here so
 * they can be tested.
 */

import type { HashCheck } from './car';
import type { RepoArchive } from './carRepo';

export type ArchiveCheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'pending';

export type ArchiveCheck = {
  id: 'tree' | 'records' | 'keys' | 'extra' | 'version' | 'hashes' | 'signature';
  status: ArchiveCheckStatus;
  title: string;
  summary: string;
  /** Evidence, one line each: the CIDs in question. */
  detail?: string[];
};

/** Where the hash check has got to: not asked for, running, or finished. */
export type HashProgress =
  | { state: 'idle' }
  | { state: 'running'; done: number; total: number }
  | { state: 'done'; result: HashCheck };

const count = new Intl.NumberFormat('en-US');

function plural(n: number, one: string, many: string): string {
  return `${count.format(n)} ${n === 1 ? one : many}`;
}

/** At most this many CIDs are listed as evidence; the rest are counted. */
const MAX_LISTED = 5;

function listed(cids: string[]): string[] {
  const shown = cids.slice(0, MAX_LISTED);
  return cids.length > MAX_LISTED ? [...shown, `and ${count.format(cids.length - MAX_LISTED)} more`] : shown;
}

export function archiveChecks(archive: RepoArchive, hashes: HashProgress): ArchiveCheck[] {
  const checks: ArchiveCheck[] = [];
  const { car, commit } = archive;

  checks.push(
    archive.missingNodes.length === 0
      ? {
          id: 'tree',
          status: 'pass',
          title: 'Tree',
          summary: `All ${plural(archive.nodeCount, 'node', 'nodes')} of the tree are in the file, so every record can be listed.`,
        }
      : {
          id: 'tree',
          status: 'fail',
          title: 'Tree',
          summary: `${plural(archive.missingNodes.length, 'part', 'parts')} of the tree ${archive.missingNodes.length === 1 ? 'is' : 'are'} missing from the file or unreadable. The records under ${archive.missingNodes.length === 1 ? 'it' : 'them'} cannot be listed.`,
          detail: listed(archive.missingNodes),
        },
  );

  checks.push(
    archive.missingRecords === 0
      ? {
          id: 'records',
          status: 'pass',
          title: 'Records',
          summary:
            archive.recordCount === 0
              ? 'The tree lists no records.'
              : `All ${plural(archive.recordCount, 'listed record', 'listed records')} ${archive.recordCount === 1 ? 'is' : 'are'} in the file.`,
        }
      : {
          id: 'records',
          status: 'warn',
          title: 'Records',
          summary: `${count.format(archive.missingRecords)} of ${plural(archive.recordCount, 'listed record', 'listed records')} ${archive.missingRecords === 1 ? 'has' : 'have'} no data in the file. A partial export, or a proof for a single record, looks like this.`,
        },
  );

  if (archive.outOfOrder > 0 || archive.malformedKeys > 0) {
    const problems = [
      archive.outOfOrder > 0 ? `${plural(archive.outOfOrder, 'key is', 'keys are')} out of sorted order` : null,
      archive.malformedKeys > 0
        ? `${plural(archive.malformedKeys, 'entry is', 'entries are')} not a collection and a record key`
        : null,
    ].filter(Boolean);
    checks.push({
      id: 'keys',
      status: 'fail',
      title: 'Keys',
      summary: `${problems.join(', and ')}. A tree written by a PDS has neither, so this file was not produced the usual way.`,
    });
  } else {
    checks.push({
      id: 'keys',
      status: 'pass',
      title: 'Keys',
      summary: 'Every key is a collection and a record key, and they are in sorted order.',
    });
  }

  if (archive.unreachedBlocks > 0 || car.duplicates > 0) {
    const parts = [
      archive.unreachedBlocks > 0
        ? `${plural(archive.unreachedBlocks, 'block is', 'blocks are')} not reached from this commit`
        : null,
      car.duplicates > 0 ? `${plural(car.duplicates, 'block appears', 'blocks appear')} more than once` : null,
    ].filter(Boolean);
    checks.push({
      id: 'extra',
      status: 'info',
      title: 'Other blocks',
      summary: `${parts.join(', and ')}. The format allows both, and they are ignored here.`,
    });
  }

  if (commit.version !== 3) {
    checks.push({
      id: 'version',
      status: 'warn',
      title: 'Format version',
      summary: `This commit says version ${commit.version}. Repositories are written as version 3 today, so this may be an old export.`,
    });
  }

  if (hashes.state === 'idle') {
    checks.push({
      id: 'hashes',
      status: 'info',
      title: 'Block hashes',
      summary: 'Not checked yet. Every block can be hashed again and compared with the CID it is filed under.',
    });
  } else if (hashes.state === 'running') {
    checks.push({
      id: 'hashes',
      status: 'pending',
      title: 'Block hashes',
      summary: `Hashing ${count.format(hashes.done)} of ${plural(hashes.total, 'block', 'blocks')}.`,
    });
  } else {
    const { checked, skipped, mismatched } = hashes.result;
    const skippedNote = skipped > 0 ? ` ${plural(skipped, 'block uses', 'blocks use')} another hash and ${skipped === 1 ? 'was' : 'were'} not checked.` : '';
    checks.push(
      mismatched.length === 0
        ? {
            id: 'hashes',
            status: 'pass',
            title: 'Block hashes',
            summary: `All ${plural(checked, 'block hashes', 'blocks hash')} to ${checked === 1 ? 'its CID' : 'their CIDs'}. The file holds the data its addresses say it does.${skippedNote}`,
          }
        : {
            id: 'hashes',
            status: 'fail',
            title: 'Block hashes',
            summary: `${plural(mismatched.length, 'block does', 'blocks do')} not hash to ${mismatched.length === 1 ? 'its CID' : 'their CIDs'}. The file was changed or damaged after it was written.${skippedNote}`,
            detail: listed(mismatched),
          },
    );
  }

  checks.push(
    commit.signatureBytes === null
      ? {
          id: 'signature',
          status: 'warn',
          title: 'Commit signature',
          summary: 'The commit carries no signature, so nothing ties this repository to its account’s key.',
        }
      : {
          id: 'signature',
          status: 'info',
          title: 'Commit signature',
          summary: `Not checked. The commit carries a ${commit.signatureBytes}-byte signature, and verifying it takes a curve the browser’s own crypto does not offer. This page shows what the file holds, not who signed it.`,
        },
  );

  return checks;
}

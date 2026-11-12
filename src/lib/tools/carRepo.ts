/**
 * A repository, read out of the blocks of a CAR file (car.ts).
 *
 * An atproto repository is three kinds of block (the repository spec):
 *
 *   commit   { did, version, data, rev, prev, sig }: whose repository this
 *            is, when it was last written (`rev`, a TID), and `data`, a link
 *            to the top of the tree.
 *   node     { l, e: [{ p, k, v, t }] }: one node of the Merkle search tree
 *            that maps `collection/rkey` to a record. `l` links to the
 *            subtree of keys before this node's first entry; each entry's `t`
 *            links to the subtree of keys after it and before the next.
 *   record   the record itself.
 *
 * Keys are compressed inside a node: an entry stores only the part of its
 * key that differs from the entry before it, as `p`, how many leading bytes
 * the two share, and `k`, the rest. The first entry of a node has `p` 0 and
 * its whole key.
 *
 * Walking the tree left to right visits every key in sorted order, which is
 * how the list of records comes out: grouped by collection, in key order,
 * with no sorting done here.
 *
 * This reads the structure and reports where it is broken (a subtree that is
 * not in the file, keys out of order). It does not check the commit's
 * signature, which needs a curve library, so nothing here says who wrote the
 * repository; only what the file contains.
 */

import { CborError, CidLink, cborToJson, decodeCbor, type CborValue } from './cbor';
import { createCarReader, type CarFile } from './car';

export class RepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoError';
  }
}

export type RepoCommit = {
  /** The commit block's own CID: the file's first root. */
  cid: string;
  did: string;
  version: number;
  /** The TID of the last write. */
  rev: string;
  /** CID of the top node of the tree. */
  data: string;
  /** CID of the commit before this one. Almost always null in version 3. */
  prev: string | null;
  /** Length of the signature in bytes, or null when the commit carries none. */
  signatureBytes: number | null;
};

export type RepoCollection = {
  nsid: string;
  /** Record keys, in the tree's order. */
  rkeys: string[];
  /** The record CID for the key at the same index. */
  cids: string[];
};

export type RepoArchive = {
  commit: RepoCommit;
  /** Collections in the tree's order, which is byte order of their names. */
  collections: RepoCollection[];
  recordCount: number;
  /** Tree nodes the walk visited. */
  nodeCount: number;
  /** Subtrees the tree links to that are not in the file. Their records cannot be listed. */
  missingNodes: string[];
  /** Records the tree lists whose block is not in the file. */
  missingRecords: number;
  /** Blocks in the file that nothing in this commit's tree reaches. */
  unreachedBlocks: number;
  /** Keys that did not sort after the key before them. A well-formed tree has none. */
  outOfOrder: number;
  /** Keys that are not `collection/rkey`. They are left out of the collections. */
  malformedKeys: number;
  car: CarFile;
};

type CborMap = { [key: string]: CborValue };

function isMap(value: CborValue | undefined): value is CborMap {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array) &&
    !(value instanceof CidLink)
  );
}

function decodeBlock(car: CarFile, cid: string, what: string): CborValue {
  const block = car.blocks.get(cid);
  if (!block) throw new RepoError(`The ${what} is not in the file.`);
  try {
    return decodeCbor(block);
  } catch (err) {
    throw new RepoError(`The ${what} could not be read: ${err instanceof CborError ? err.message : 'it is not DAG-CBOR'}.`);
  }
}

function readCommit(car: CarFile): RepoCommit {
  const cid = car.roots[0];
  if (!cid) throw new RepoError('The file names no root, so there is no commit to start from. It may not be a repository export.');
  const value = decodeBlock(car, cid, 'commit the file starts from');
  if (!isMap(value) || typeof value.did !== 'string' || !(value.data instanceof CidLink)) {
    throw new RepoError('The file’s root is not a repository commit. It is a CAR file, but not a repository export.');
  }
  return {
    cid,
    did: value.did,
    version: typeof value.version === 'number' ? value.version : 0,
    rev: typeof value.rev === 'string' ? value.rev : '',
    data: value.data.toString(),
    prev: value.prev instanceof CidLink ? value.prev.toString() : null,
    signatureBytes: value.sig instanceof Uint8Array ? value.sig.length : null,
  };
}

const keyDecoder = new TextDecoder('utf-8');

/** Lexical order of two keys by their bytes, as the tree sorts them. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** The deepest a tree can usefully be. Depth comes from a hash, so a real tree is far shallower. */
const MAX_TREE_DEPTH = 128;

/** One node of the tree, part-way through its entries. */
type Frame = {
  entries: CborValue[];
  index: number;
  /** The subtree before the first entry, until it has been entered. */
  left: string | null;
  /** The last key built in this node, which the next entry's prefix is cut from. */
  last: Uint8Array;
};

/**
 * A repository part-way through being read out of a CAR file. Like the CAR
 * reader, it works in steps so a large tree can be walked without holding up
 * the page: `step` lists up to `budget` more records.
 *
 * The walk keeps its own stack rather than recursing, which is what lets it
 * stop between any two records and pick up again.
 */
export type RepoReader = {
  /** List up to `budget` more records. True once the whole tree has been walked. */
  step(budget: number): boolean;
  /** Records listed so far. */
  recordCount(): number;
  archive(): RepoArchive;
};

export function createRepoReader(car: CarFile): RepoReader {
  const commit = readCommit(car);

  const collections: RepoCollection[] = [];
  const byNsid = new Map<string, RepoCollection>();
  const reached = new Set<string>([commit.cid]);
  const missingNodes: string[] = [];
  const stack: Frame[] = [];
  let recordCount = 0;
  let nodeCount = 0;
  let missingRecords = 0;
  let outOfOrder = 0;
  let malformedKeys = 0;
  let previousKey: Uint8Array | null = null;

  const addEntry = (key: Uint8Array, cid: string) => {
    if (previousKey && compareBytes(previousKey, key) >= 0) outOfOrder++;
    previousKey = key;

    const text = keyDecoder.decode(key);
    const slash = text.indexOf('/');
    if (slash <= 0 || slash === text.length - 1 || text.indexOf('/', slash + 1) !== -1) {
      malformedKeys++;
      return;
    }
    const nsid = text.slice(0, slash);
    let collection = byNsid.get(nsid);
    if (!collection) {
      collection = { nsid, rkeys: [], cids: [] };
      byNsid.set(nsid, collection);
      collections.push(collection);
    }
    collection.rkeys.push(text.slice(slash + 1));
    collection.cids.push(cid);
    recordCount++;
    if (car.blocks.has(cid)) reached.add(cid);
    else missingRecords++;
  };

  const enter = (cid: string) => {
    // A node already visited means the links form a loop, which no honest
    // tree does; following it again would never end.
    if (reached.has(cid) || stack.length >= MAX_TREE_DEPTH) return;
    const block = car.blocks.get(cid);
    if (!block) {
      missingNodes.push(cid);
      return;
    }
    reached.add(cid);
    let node: CborValue;
    try {
      node = decodeCbor(block);
    } catch {
      missingNodes.push(cid);
      return;
    }
    if (!isMap(node) || !Array.isArray(node.e)) {
      missingNodes.push(cid);
      return;
    }
    nodeCount++;
    stack.push({
      entries: node.e,
      index: 0,
      left: node.l instanceof CidLink ? node.l.toString() : null,
      // Key compression runs within one node, so each node starts afresh.
      last: new Uint8Array(0),
    });
  };

  enter(commit.data);

  return {
    recordCount: () => recordCount,
    step(budget) {
      const target = recordCount + budget;
      while (stack.length > 0 && recordCount < target) {
        const frame = stack[stack.length - 1];
        if (frame.left) {
          const left = frame.left;
          frame.left = null;
          enter(left);
          continue;
        }
        if (frame.index >= frame.entries.length) {
          stack.pop();
          continue;
        }
        const entry = frame.entries[frame.index++];
        if (!isMap(entry) || !(entry.k instanceof Uint8Array) || !(entry.v instanceof CidLink)) {
          malformedKeys++;
          continue;
        }
        const shared = typeof entry.p === 'number' ? Math.min(Math.max(entry.p, 0), frame.last.length) : 0;
        const key = new Uint8Array(shared + entry.k.length);
        key.set(frame.last.subarray(0, shared), 0);
        key.set(entry.k, shared);
        frame.last = key;
        addEntry(key, entry.v.toString());
        if (entry.t instanceof CidLink) enter(entry.t.toString());
      }
      return stack.length === 0;
    },
    archive: () => ({
      commit,
      collections,
      recordCount,
      nodeCount,
      missingNodes,
      missingRecords,
      unreachedBlocks: car.blocks.size - reached.size,
      outOfOrder,
      malformedKeys,
      car,
    }),
  };
}

export function readRepo(car: CarFile): RepoArchive {
  const reader = createRepoReader(car);
  reader.step(Infinity);
  return reader.archive();
}

export type OpenProgress =
  /** Reading blocks out of the file: `done` of `total` bytes. */
  | { phase: 'blocks'; done: number; total: number }
  /** Walking the tree: `records` listed so far. */
  | { phase: 'tree'; records: number };

/** Blocks, then records, read between two chances for the page to draw. */
const BLOCKS_PER_SLICE = 20_000;
const RECORDS_PER_SLICE = 20_000;

/**
 * Open a repository export without freezing the page: the same two readers,
 * run a slice at a time with a pause between slices for the browser to
 * paint, report progress and notice a Stop.
 */
export async function openArchive(
  bytes: Uint8Array,
  options: { signal?: AbortSignal; onProgress?: (progress: OpenProgress) => void } = {},
): Promise<RepoArchive> {
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const stopped = () => {
    if (options.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  };

  const car = createCarReader(bytes);
  while (!car.step(BLOCKS_PER_SLICE)) {
    options.onProgress?.({ phase: 'blocks', done: car.offset(), total: bytes.length });
    await pause();
    stopped();
  }

  const repo = createRepoReader(car.file);
  while (!repo.step(RECORDS_PER_SLICE)) {
    options.onProgress?.({ phase: 'tree', records: repo.recordCount() });
    await pause();
    stopped();
  }
  return repo.archive();
}

/** One record as JSON, decoded when asked for. Null when its block is not in the file. */
export function readRecord(archive: RepoArchive, cid: string): unknown | null {
  const block = archive.car.blocks.get(cid);
  if (!block) return null;
  return cborToJson(decodeCbor(block));
}

export type ExportedRecord = { uri: string; cid: string; value: unknown };

/** A record in the shape `com.atproto.repo.listRecords` returns it. */
export function exportRecord(archive: RepoArchive, collection: RepoCollection, index: number): ExportedRecord | null {
  const cid = collection.cids[index];
  let value: unknown;
  try {
    value = readRecord(archive, cid);
  } catch {
    return null;
  }
  if (value === null) return null;
  return { uri: `at://${archive.commit.did}/${collection.nsid}/${collection.rkeys[index]}`, cid, value };
}

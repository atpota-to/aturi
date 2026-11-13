'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Download, Search } from 'lucide-react';
import CopyButton from '@/components/explore/CopyButton';
import { Nsid } from '@/components/explore/lexicons/primitives';
import LexiconFavicon from '@/components/explore/tabs/LexiconFavicon';
import { tidToDate } from '@/utils/atproto/tid';
import { buildJsonExport } from '@/lib/tools/carExport';
import { appOfCollection } from '@/lib/tools/carFormat';
import { readRecord, type RepoArchive, type RepoCollection } from '@/lib/tools/carRepo';
import { ToolCard, ToolEmpty, ToolJson, ToolSection } from './ToolFrame';

/** Record keys drawn at first, and added by each "Show more". */
const PAGE = 200;
/** Above this many collections the list gets a filter field. */
const FILTER_FROM = 12;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const countFormat = new Intl.NumberFormat('en-US');

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // After the click has been handled, so the download has its own handle on the data.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One record's JSON, decoded when its row is opened. */
function OpenRecord({ archive, collection, index }: { archive: RepoArchive; collection: RepoCollection; index: number }) {
  const rkey = collection.rkeys[index];
  const cid = collection.cids[index];
  const uri = `at://${archive.commit.did}/${collection.nsid}/${rkey}`;
  let value: unknown = null;
  let problem: string | null = null;
  try {
    value = readRecord(archive, cid);
    if (value === null) problem = 'The tree lists this record, but its data is not in the file.';
  } catch (err) {
    problem = `This record could not be read: ${err instanceof Error ? err.message : 'it is not DAG-CBOR'}.`;
  }
  return (
    <div className="fn-tool-car-record">
      <dl className="fn-tool-car-record-ids">
        <dt>URI</dt>
        <dd>
          <code>{uri}</code>
          <CopyButton value={uri} label="Copy at:// URI" compact variant="subtle" iconOnly />
        </dd>
        <dt>CID</dt>
        <dd>
          <code>{cid}</code>
          <CopyButton value={cid} label="Copy CID" compact variant="subtle" iconOnly />
        </dd>
      </dl>
      {problem ? <p className="fn-tool-note">{problem}</p> : <ToolJson value={value} label="record" />}
      <div className="fn-tool-car-record-actions">
        <Link
          href={`/explore/${archive.commit.did}/${collection.nsid}/${encodeURIComponent(rkey)}`}
          prefetch={false}
          rel="nofollow"
          className="fx-btn fx-btn-sm"
          title="The record as its PDS serves it now, which may have changed since this export"
        >
          Open the live record
        </Link>
      </div>
    </div>
  );
}

/**
 * The records in an opened archive: collections on the left, the chosen
 * collection's record keys on the right, each opening to its JSON in place.
 *
 * Nothing is decoded until it is looked at. The archive holds every key and
 * CID from the tree walk, so the lists are free; a record's block is only
 * read when its row is opened, and the JSON export reads them in batches.
 */
export default function CarInspectorBrowser({ archive, name }: { archive: RepoArchive; name: string }) {
  const [selected, setSelected] = useState<string | null>(archive.collections[0]?.nsid ?? null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [filter, setFilter] = useState('');
  const [exporting, setExporting] = useState<{ scope: 'all' | 'one'; done: number; total: number } | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const collection = archive.collections.find((c) => c.nsid === selected) ?? null;
  const query = filter.trim().toLowerCase();
  const listed = query ? archive.collections.filter((c) => c.nsid.toLowerCase().includes(query)) : archive.collections;

  function pick(nsid: string) {
    setSelected(nsid);
    setOpenKey(null);
    setShown(PAGE);
  }

  async function download(scope: 'all' | 'one') {
    const collections = scope === 'one' && collection ? [collection] : archive.collections;
    const total = collections.reduce((sum, c) => sum + c.rkeys.length, 0);
    setExporting({ scope, done: 0, total });
    setExportNote(null);
    try {
      const { blob, skipped } = await buildJsonExport(archive, collections, {
        onProgress: (done) => setExporting({ scope, done, total }),
      });
      const base = name.replace(/\.car$/i, '');
      saveBlob(blob, scope === 'one' && collection ? `${base}.${collection.nsid}.json` : `${base}.json`);
      if (skipped > 0) {
        setExportNote(
          `${countFormat.format(skipped)} ${skipped === 1 ? 'record was' : 'records were'} left out, because the data is not in the file.`,
        );
      }
    } catch {
      setExportNote('The JSON file could not be built. The archive may be too large for this browser to hold twice.');
    } finally {
      setExporting(null);
    }
  }

  const exportLabel = (scope: 'all' | 'one', idle: string) =>
    exporting?.scope === scope
      ? `Preparing… ${Math.floor((exporting.done / Math.max(exporting.total, 1)) * 100)}%`
      : idle;

  if (archive.collections.length === 0) {
    return (
      <ToolSection title="Records">
        <ToolEmpty>This repository holds no records.</ToolEmpty>
      </ToolSection>
    );
  }

  return (
    <ToolSection
      title="Records"
      meta={`${countFormat.format(archive.recordCount)} in ${countFormat.format(archive.collections.length)} ${
        archive.collections.length === 1 ? 'collection' : 'collections'
      }`}
    >
      <div className="fn-tool-car-browser">
        <div className="fn-tool-car-side">
          {archive.collections.length >= FILTER_FROM && (
            <label className="fx-field fn-tool-car-filter">
              <Search size={14} aria-hidden />
              <input
                type="text"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter collections"
                aria-label="Filter collections"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}
          <ToolCard flush>
            <ul className="fn-tool-rows fn-tool-car-colls" aria-label="Collections">
              {listed.map((c) => (
                <li key={c.nsid}>
                  <button
                    type="button"
                    className="fn-tool-row fn-tool-car-coll"
                    aria-current={c.nsid === selected ? 'true' : undefined}
                    onClick={() => pick(c.nsid)}
                  >
                    <LexiconFavicon prefix={appOfCollection(c.nsid)} />
                    <span className="fn-tool-row-main">
                      <span className="fn-tool-car-nsid">
                        <Nsid value={c.nsid} />
                      </span>
                    </span>
                    <span className="fn-tool-row-end">{countFormat.format(c.rkeys.length)}</span>
                  </button>
                </li>
              ))}
              {listed.length === 0 && <li className="fn-tool-car-none">No collection matches.</li>}
            </ul>
          </ToolCard>
        </div>

        <div className="fn-tool-car-main">
          {collection && (
            <>
              <div className="fn-tool-bar fn-tool-car-bar">
                <h3 className="fn-tool-car-title">
                  <Nsid value={collection.nsid} />
                </h3>
                <span className="fn-tool-bar-end">
                  <button
                    type="button"
                    className="fx-btn fx-btn-sm"
                    onClick={() => download('one')}
                    disabled={exporting !== null}
                    data-wait={exporting?.scope === 'one' || undefined}
                  >
                    <Download size={13} aria-hidden /> {exportLabel('one', 'This collection as JSON')}
                  </button>
                  <button
                    type="button"
                    className="fx-btn fx-btn-sm"
                    onClick={() => download('all')}
                    disabled={exporting !== null}
                    data-wait={exporting?.scope === 'all' || undefined}
                  >
                    <Download size={13} aria-hidden /> {exportLabel('all', 'Everything as JSON')}
                  </button>
                </span>
              </div>
              {exportNote && (
                <p className="fn-tool-note" role="status">
                  {exportNote}
                </p>
              )}
              <ToolCard flush>
                <ul className="fn-tool-rows fn-tool-car-keys" aria-label={`Records in ${collection.nsid}`}>
                  {collection.rkeys.slice(0, shown).map((rkey, index) => {
                    const open = openKey === rkey;
                    const date = tidToDate(rkey);
                    return (
                      <li key={rkey} className="fn-tool-car-key" data-open={open || undefined}>
                        <button
                          type="button"
                          className="fn-tool-row fn-tool-car-keyrow"
                          aria-expanded={open}
                          onClick={() => setOpenKey(open ? null : rkey)}
                        >
                          <ChevronRight size={14} aria-hidden className="fn-tool-car-chev" />
                          <span className="fn-tool-row-main">
                            <code className="fn-tool-car-rkey">{rkey}</code>
                          </span>
                          {date && (
                            <time className="fn-tool-row-end" dateTime={date.toISOString()}>
                              {dateFormat.format(date)}
                            </time>
                          )}
                        </button>
                        {open && <OpenRecord archive={archive} collection={collection} index={index} />}
                      </li>
                    );
                  })}
                </ul>
                {collection.rkeys.length > shown && (
                  <div className="fn-tool-car-more">
                    <span>
                      {countFormat.format(shown)} of {countFormat.format(collection.rkeys.length)} shown
                    </span>
                    <button type="button" className="fx-btn fx-btn-sm" onClick={() => setShown(shown + PAGE)}>
                      Show more
                    </button>
                  </div>
                )}
              </ToolCard>
            </>
          )}
        </div>
      </div>
      <p className="fn-tool-note fn-tool-car-blobs">
        Blobs are not part of a repository export. An image or video appears here as a link to its CID; the file
        itself stays on the account’s PDS.
      </p>
    </ToolSection>
  );
}

'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, IdCard, Loader2, Plus, Upload, X } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { resolveIdentifier } from '@/utils/atproto/identity';
import { isValidNsid } from '@/utils/atproto/spaceUri';
import { encodeRepo, rkeyFromAtUri, shortDid } from '@/utils/atproto/urls';
import { resolveLexiconDocument } from '@/utils/atproto/lexiconDoc';
import { formFromLexiconDocument } from '@/utils/atproto/lexiconForm';
import {
  blankRecordFrom,
  lexiconFor,
  type Lexicon,
} from '@/utils/atproto/lexicons';
import { CREATE_POINT_COST, recordSpend } from '@/utils/atproto/writeThrottle';
import { FormEditor, ModeToggle, RawJsonEditor } from './recordFields';
import { useMyCollections } from './useRepoCollections';

/**
 * Write a record of any lexicon into your own repo.
 *
 * The explorer could already edit and delete records; this is the missing
 * third verb. It is deliberately not a Bluesky composer — it writes whatever
 * NSID you name, including one no app has published a schema for, because the
 * thing worth having here is the one a general atproto client can do and a
 * product client can't.
 *
 * Two ways in, on one model:
 *
 *   - JSON, always available. The record body as text, with the collection and
 *     the record key as their own fields above it, so the address you are
 *     writing to is visible rather than encoded in the document.
 *   - Form, when the collection's lexicon can be resolved to one. Aturi's own
 *     templates for the handful of lexicons people hand-edit most, and for
 *     everything else the published schema, fetched and translated at the
 *     moment you finish typing the NSID.
 *
 * Both write through `com.atproto.repo.createRecord`, which is create-only: a
 * record key already in use is refused rather than overwritten. Editing what
 * is there is <RecordEditor>'s job, one page away.
 *
 * The target repo is always the signed-in account's. A PDS answers a write
 * aimed at someone else's repo the way it answers a read of a private one, so
 * there is nothing to choose — but the header still spells the address out,
 * because this dialog opens from other people's collection pages too and
 * "which repo is this going into" should never be a guess.
 */

type Props = {
  open: boolean;
  onClose: () => void;
  /** Pre-filled collection NSID — the collection page passes the one you're on. */
  collection?: string;
  /** Pre-filled record key. Rare; the lexicon usually decides. */
  rkey?: string;
};

/**
 * What the PDS should do about lexicon validation, as the three states the
 * parameter has. `unset` omits it, which leaves the host's own default —
 * validate against a schema it knows, accept anything else.
 *
 * `false` is the one that matters: it is how you write a record that a
 * published schema would refuse, which is a legitimate thing to do while
 * designing a lexicon, and impossible in every client that doesn't offer it.
 */
type ValidateMode = 'unset' | 'true' | 'false';

export default function NewRecordDialog({ open, onClose, collection: initialCollection, rkey: initialRkey }: Props) {
  const router = useRouter();
  const { agent, did } = useAtprotoSession();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const jsonRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const [collection, setCollection] = useState(initialCollection ?? '');
  const [rkey, setRkey] = useState(initialRkey ?? '');
  const [rkeyTouched, setRkeyTouched] = useState(Boolean(initialRkey));
  const [mode, setMode] = useState<'form' | 'json'>('json');
  const [value, setValue] = useState<Record<string, unknown>>({});
  const [rawText, setRawText] = useState('');
  const [validate, setValidate] = useState<ValidateMode>('unset');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);

  /**
   * Whether anything in the body came from the user rather than from the
   * collection's template. It is what changing the collection consults before
   * reseeding: a template is replaceable, a draft is not.
   *
   * A ref rather than state because the seeding effect has to read it without
   * listing it as a dependency — a dependency would re-run the seed on the
   * very keystroke that set it.
   */
  const dirtyRef = useRef(false);
  const rkeyTouchedRef = useRef(rkeyTouched);
  rkeyTouchedRef.current = rkeyTouched;

  const myCollections = useMyCollections();
  const listId = useId();

  // Drive the native modal from `open`, and mirror its own closes back.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    const handleClose = () => onClose();
    dlg.addEventListener('close', handleClose);
    return () => dlg.removeEventListener('close', handleClose);
  }, [onClose]);

  // Every open starts clean. The alternative — keeping the last draft — sounds
  // kinder until the dialog is opened from a different collection's page and
  // shows a body belonging to the previous one under the new address.
  useEffect(() => {
    if (!open) return;
    setCollection(initialCollection ?? '');
    setRkey(initialRkey ?? '');
    setRkeyTouched(Boolean(initialRkey));
    setRawText('');
    dirtyRef.current = false;
    setValue({});
    setMode('json');
    setError(null);
  }, [open, initialCollection, initialRkey]);

  // The handle for the header. Falls back to the DID, which is what the
  // address is made of anyway.
  useEffect(() => {
    if (!did) return undefined;
    let cancelled = false;
    resolveIdentifier(did)
      .then((id) => {
        if (!cancelled) setHandle(id.handle || null);
      })
      .catch(() => {
        // Cosmetic; the DID below is already correct.
      });
    return () => {
      cancelled = true;
    };
  }, [did]);

  const [schema, setSchema] = useState<SchemaState>({ status: 'idle' });

  /**
   * Resolve the collection to a form.
   *
   * Aturi's own template wins where it has one: those six are curated down to
   * the fields a person actually fills, where the published schema for the same
   * NSID is a wall of embeds and facets. Everything else — which is to say the
   * whole rest of the network — comes from the schema its authority published.
   * Either way the provenance is stated under the toggle, because "are these
   * all the fields?" is not a question a form should leave open.
   */
  useEffect(() => {
    const nsid = collection.trim();
    if (!open || !isValidNsid(nsid)) {
      setSchema({ status: 'idle' });
      return undefined;
    }

    const builtIn = lexiconFor(nsid);
    if (builtIn) {
      setSchema({ status: 'ok', lexicon: builtIn, source: 'aturi' });
      return undefined;
    }

    let cancelled = false;
    setSchema({ status: 'loading' });
    // Debounced: the NSID passes validation several keystrokes before the user
    // has finished typing it (`com.example.foo` is valid on the way to
    // `com.example.foobar`), and each attempt is a DNS query and a PDS read.
    const timer = window.setTimeout(() => {
      resolveLexiconDocument(nsid)
        .then((resolved) => {
          if (cancelled) return;
          if (!resolved) {
            setSchema({
              status: 'none',
              reason: `No published schema found for ${nsid}. You can still write any JSON under it.`,
            });
            return;
          }
          const form = formFromLexiconDocument(nsid, resolved.doc);
          if (form.ok) {
            setSchema({ status: 'ok', lexicon: form.lexicon, source: 'published' });
          } else {
            setSchema({ status: 'none', reason: form.reason });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSchema({ status: 'none', reason: 'Could not reach that lexicon’s publisher.' });
          }
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [collection, open]);

  const lexicon = schema.status === 'ok' ? schema.lexicon : null;

  /**
   * Seed the body (and the record key) from whatever the collection resolved
   * to, without overwriting anything typed.
   */
  useEffect(() => {
    if (!open || dirtyRef.current) return;
    const nsid = collection.trim();

    const seed = lexicon
      ? blankRecordFrom(lexicon)
      : nsid
        ? ({ $type: nsid } as Record<string, unknown>)
        : {};
    const seedText = Object.keys(seed).length ? `${JSON.stringify(seed, null, 2)}\n` : '';

    setRawText(seedText);
    setValue(seed);
    if (!rkeyTouchedRef.current) {
      setRkey(lexicon?.rkeyMode === 'fixed' ? lexicon.rkeyDefault || '' : '');
    }
  }, [lexicon, collection, open]);

  const updateField = useCallback((key: string, next: unknown) => {
    dirtyRef.current = true;
    setValue((prev) => ({ ...prev, [key]: next }));
  }, []);

  const updateRawText = useCallback((next: string) => {
    dirtyRef.current = true;
    setRawText(next);
  }, []);

  /**
   * The record as it will be sent.
   *
   * Mirrors <RecordEditor>'s: `$type` is asserted from the lexicon, and empty
   * optional fields are dropped rather than written as `""`, which a schema
   * with a `minLength` would refuse and which means something different from
   * absent in every schema that doesn't.
   */
  const buildRecord = useCallback((): Record<string, unknown> => {
    const nsid = collection.trim();
    if (mode === 'json') {
      const parsed = JSON.parse(rawText || '{}') as Record<string, unknown>;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('A record has to be a JSON object.');
      }
      return parsed;
    }
    const next: Record<string, unknown> = { ...value };
    if (nsid) next.$type = nsid;
    if (lexicon) {
      for (const f of lexicon.fields) {
        const v = next[f.key];
        if (!f.required && (v === '' || v === undefined || v === null)) {
          delete next[f.key];
        }
        if (f.type === 'tags' && Array.isArray(v) && v.length === 0 && !f.required) {
          delete next[f.key];
        }
      }
    }
    return next;
  }, [collection, mode, rawText, value, lexicon]);

  function toggleMode() {
    if (mode === 'json') {
      try {
        const parsed = JSON.parse(rawText || '{}') as Record<string, unknown>;
        setValue(parsed);
        setError(null);
      } catch (err) {
        setError(`Can't switch to the form: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      setMode('form');
      return;
    }
    try {
      setRawText(`${JSON.stringify(buildRecord(), null, 2)}\n`);
    } catch {
      // A form can't produce unserialisable JSON; if it somehow did, keep the
      // text that's there rather than blanking the draft.
    }
    setMode('json');
  }

  /** Splice text in at the JSON editor's caret, replacing any selection. */
  const insertAtCaret = useCallback((text: string) => {
    const el = jsonRef.current;
    dirtyRef.current = true;
    setRawText((prev) => {
      if (!el) return prev + text;
      const start = el.selectionStart ?? prev.length;
      const end = el.selectionEnd ?? start;
      const next = prev.slice(0, start) + text + prev.slice(end);
      // Put the caret after what was inserted, once React has re-rendered
      // with the new value — setting it now would be overwritten.
      window.requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + text.length, start + text.length);
      });
      return next;
    });
    setAddOpen(false);
  }, []);

  async function handleUpload(file: File) {
    if (!agent) return;
    setUploading(true);
    setError(null);
    try {
      // The File goes straight to the transport, which accepts a Blob — no
      // reason to read a video into a JS array on the way past. `encoding`
      // is passed explicitly because a file the OS couldn't type arrives with
      // an empty `type`, and a PDS needs one to store the blob under.
      const res = await agent.com.atproto.repo.uploadBlob(file, {
        encoding: file.type || 'application/octet-stream',
      });
      const blob = (res?.data || res) as { blob?: unknown };
      const ref = blob.blob;
      // BlobRef serialises itself to the `{$type, ref, mimeType, size}` shape
      // a record carries; a plain object from a host that answered differently
      // is passed through as-is.
      const json =
        ref && typeof (ref as { toJSON?: () => unknown }).toJSON === 'function'
          ? (ref as { toJSON: () => unknown }).toJSON()
          : ref;
      insertAtCaret(JSON.stringify(json, null, 2));
    } catch (err) {
      setError(describeWriteError(err, 'upload'));
    } finally {
      setUploading(false);
    }
  }

  async function handleCreate() {
    const nsid = collection.trim();
    if (!agent || !did) return;
    if (!nsid) {
      setError('Name the collection to write into.');
      return;
    }
    if (!isValidNsid(nsid)) {
      setError(`“${nsid}” isn’t a valid NSID. Collections look like com.example.thing.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const record = buildRecord();
      const chosenRkey = rkey.trim();
      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: nsid,
        ...(chosenRkey ? { rkey: chosenRkey } : {}),
        ...(validate === 'unset' ? {} : { validate: validate === 'true' }),
        record,
      });
      // Same budget the bulk delete paces against, so a session that composed
      // its way through the hourly limit finds out here rather than there.
      recordSpend(did, CREATE_POINT_COST);

      const uri = ((res?.data || res) as { uri?: string })?.uri || '';
      const written = chosenRkey || rkeyFromAtUri(uri) || '';
      const repoSeg = encodeRepo(handle || did);
      const collectionPath = `/explore/${repoSeg}/${encodeURIComponent(nsid)}`;
      setSaving(false);
      onClose();
      // Straight to what was just written. A host that answered without a URI
      // and wasn't given a key leaves nothing to address, so the collection it
      // landed in is the next best place to look.
      router.push(
        written ? `${collectionPath}/${encodeURIComponent(written)}` : collectionPath,
      );
    } catch (err) {
      setError(describeWriteError(err, 'create'));
      setSaving(false);
    }
  }

  const repoLabel = handle ? handle : did ? shortDid(did) : '';
  const busy = saving || uploading;
  // Enabled whenever there is a session and nothing in flight, including when
  // the collection is empty or malformed: pressing it then answers why, where
  // a greyed-out button with no explanation leaves the user hunting.
  const canSubmit = Boolean(agent && did) && !busy;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="new-record-dialog"
      onCancel={(e) => {
        // A write in flight has nothing to cancel — the request is already at
        // the host — and a form that vanished mid-create leaves the user with
        // no address and no error. (An open menu takes its own Escape; see
        // <Popover>.)
        if (busy) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current && !busy) onClose();
      }}
    >
      <div className="new-record-panel">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <h2
            id={titleId}
            style={{
              margin: 0,
              flex: 1,
              minWidth: 0,
              fontFamily: 'var(--font-serif)',
              fontWeight: 400,
              fontSize: '1.05rem',
              color: 'var(--text-primary)',
            }}
          >
            Creating record
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              flexShrink: 0,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* The address being written to, laid out as the AT URI it is. The
            repo is fixed — a PDS only takes writes for the account that
            authorized them — so it reads as text, not as a field. */}
        <div className="new-record-address">
          <span className="new-record-scheme">at://</span>
          <span className="new-record-repo" title={did || undefined}>
            {repoLabel}
          </span>
          <span className="new-record-slash">/</span>
          <input
            className="explore-input explore-mono"
            type="text"
            list={listId}
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            placeholder="com.example.record"
            aria-label="Collection NSID"
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
          />
          <datalist id={listId}>
            {[...(myCollections ?? [])].sort().map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <span className="new-record-slash">/</span>
          <input
            className="explore-input explore-mono"
            type="text"
            value={rkey}
            onChange={(e) => {
              setRkey(e.target.value);
              setRkeyTouched(true);
            }}
            placeholder={rkeyPlaceholder(lexicon)}
            aria-label="Record key"
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
          />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
          }}
        >
          <ModeToggle
            mode={mode}
            onChange={toggleMode}
            formDisabled={!lexicon}
            formTitle={
              lexicon
                ? undefined
                : 'A form needs a lexicon this collection resolves to'
            }
          />
          <SchemaNote state={schema} />
        </div>

        <div className={mode === 'json' ? 'new-record-body new-record-json' : 'new-record-body'}>
          {mode === 'form' && lexicon ? (
            <FormEditor lex={lexicon} value={value} onChange={updateField} />
          ) : (
            <RawJsonEditor
              value={rawText}
              onChange={updateRawText}
              rows={16}
              label=""
              textareaRef={jsonRef}
            />
          )}
        </div>

        {error && (
          <p role="alert" className="explore-error" style={{ margin: 0 }}>
            {error}
          </p>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          {mode === 'json' && (
            <div style={{ position: 'relative' }}>
              <SecondaryButton
                onClick={() => {
                  setAddOpen((v) => !v);
                  setAdvancedOpen(false);
                }}
                disabled={busy}
                expanded={addOpen}
              >
                {uploading ? (
                  <Loader2 size={12} className="explore-spin" aria-hidden />
                ) : (
                  <Plus size={12} aria-hidden />
                )}
                {uploading ? 'Uploading…' : 'Add'}
              </SecondaryButton>
              {addOpen && (
                <Popover onDismiss={() => setAddOpen(false)} align="start">
                  <MenuItem
                    icon={<IdCard size={13} aria-hidden />}
                    onClick={() => did && insertAtCaret(JSON.stringify(did))}
                  >
                    Insert DID
                  </MenuItem>
                  <MenuItem
                    icon={<Clock size={13} aria-hidden />}
                    onClick={() => insertAtCaret(JSON.stringify(new Date().toISOString()))}
                  >
                    Insert timestamp
                  </MenuItem>
                  <MenuItem
                    icon={<Upload size={13} aria-hidden />}
                    onClick={() => {
                      setAddOpen(false);
                      fileRef.current?.click();
                    }}
                  >
                    Upload blob
                  </MenuItem>
                </Popover>
              )}
            </div>
          )}

          <span style={{ flex: 1 }} />

          <div style={{ position: 'relative' }}>
            <SecondaryButton
              onClick={() => {
                setAdvancedOpen((v) => !v);
                setAddOpen(false);
              }}
              disabled={busy}
              expanded={advancedOpen}
            >
              Advanced
              {validate !== 'unset' && (
                <span style={{ color: 'var(--text-accent)' }}>· validate {validate}</span>
              )}
            </SecondaryButton>
            {advancedOpen && (
              <Popover onDismiss={() => setAdvancedOpen(false)} align="end">
                <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '17rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span
                      className="explore-small-caps"
                      style={{ flex: 1, color: 'var(--text-secondary)', fontSize: '0.75rem' }}
                    >
                      Validate
                    </span>
                    <div role="radiogroup" aria-label="Validate" style={{ display: 'inline-flex', border: '1px solid var(--border-medium)' }}>
                      {(['unset', 'true', 'false'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          role="radio"
                          aria-checked={validate === v}
                          onClick={() => setValidate(v)}
                          style={{
                            padding: '0.3rem 0.6rem',
                            background: validate === v ? 'var(--accent-moss)' : 'transparent',
                            color: validate === v ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                            border: 0,
                            fontFamily: 'var(--font-serif)',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                          }}
                        >
                          {v === 'unset' ? 'Unset' : v === 'true' ? 'True' : 'False'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.75rem', lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
                    Set to ‘false’ to skip lexicon schema validation by the PDS, ‘true’ to
                    require it, or leave unset to validate only for known lexicons.
                  </p>
                </div>
              </Popover>
            )}
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={!canSubmit}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 1rem',
              background: 'var(--accent-moss)',
              color: 'var(--text-on-accent)',
              border: '1px solid var(--accent-moss)',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.85rem',
              cursor: !canSubmit ? 'not-allowed' : 'pointer',
              opacity: !canSubmit ? 0.5 : 1,
            }}
          >
            {saving && <Loader2 size={12} className="explore-spin" aria-hidden />}
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so picking the same file twice fires again.
            e.target.value = '';
            if (file) void handleUpload(file);
          }}
        />
      </div>

      <style jsx>{`
        .new-record-dialog {
          margin: auto;
          padding: 1.5rem;
          border: none;
          background: transparent;
          /* An explicit width, not just a max on the panel. A dialog element
             sizes to fit-content, so a percentage inside it resolves against
             a box that has already shrunk to the textarea's default column
             count, and the composer came out half the width it asked for. */
          width: min(58rem, 100vw);
          max-height: 100vh;
          overflow: visible;
        }
        .new-record-dialog::backdrop {
          background: var(--modal-backdrop);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        .new-record-panel {
          width: 100%;
          max-height: 85vh;
          overflow-y: auto;
          background: var(--modal-bg);
          border: 1px solid var(--border-medium);
          box-shadow: var(--modal-shadow);
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1.25rem;
        }
        .new-record-address {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          flex-wrap: wrap;
        }
        .new-record-address :global(input) {
          flex: 3 1 14rem;
          min-width: 0;
          font-size: 0.82rem;
        }
        /* The record key takes the smaller share of a row that fits, and a
           line of its own on a phone, where the flex basis stops both from
           being squeezed below readable. */
        .new-record-address :global(input:last-of-type) {
          flex: 2 1 12rem;
        }
        .new-record-scheme,
        .new-record-slash {
          font-family: var(--font-mono);
          font-size: 0.82rem;
          color: var(--text-tertiary);
          flex-shrink: 0;
        }
        .new-record-repo {
          font-family: var(--font-mono);
          font-size: 0.82rem;
          color: var(--text-primary);
          padding: 0.55rem 0.6rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-subtle);
          max-width: 14rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex-shrink: 0;
        }
        /* Only the raw-JSON box. Scoped to the mode rather than to the body,
           because the form's own textareas are sized by their field's rows and
           a blanket minimum turns a 300-character post box into a wall. */
        .new-record-json :global(textarea) {
          min-height: 18rem;
        }
      `}</style>
    </dialog>
  );
}

type SchemaState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; lexicon: Lexicon; source: 'aturi' | 'published' }
  | { status: 'none'; reason: string };

/**
 * Where the form's fields came from, or why there isn't one.
 *
 * Worth a line of its own: a generated form shows the fields one schema
 * declares, and a user deciding whether to trust it needs to know whether that
 * schema is the lexicon's own or this app's abridgement of it.
 */
function SchemaNote({ state }: { state: SchemaState }) {
  const base: React.CSSProperties = {
    margin: 0,
    fontSize: '0.75rem',
    color: 'var(--text-tertiary)',
    textAlign: 'right',
    flex: '1 1 12rem',
    minWidth: 0,
  };
  if (state.status === 'idle') return null;
  if (state.status === 'loading') {
    return <p style={base}>Looking for a published lexicon…</p>;
  }
  if (state.status === 'none') return <p style={base}>{state.reason}</p>;
  return (
    <p style={base}>
      {state.source === 'aturi'
        ? 'Aturi’s template for this lexicon — common fields only.'
        : 'Form built from the published lexicon.'}
    </p>
  );
}

/** The record key field's placeholder, which is the lexicon's key type. */
function rkeyPlaceholder(lexicon: Lexicon | null): string {
  if (lexicon?.rkeyMode === 'fixed') return lexicon.rkeyPlaceholder || 'rkey';
  return 'Record key (default: TID)';
}

function SecondaryButton({
  onClick,
  disabled,
  expanded,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  expanded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.45rem 0.8rem',
        background: 'var(--bg-tertiary)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-medium)',
        fontFamily: 'var(--font-serif)',
        fontSize: '0.82rem',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

/**
 * A small menu anchored to the button that opened it.
 *
 * Not a `<dialog>`: this one lives *inside* a modal dialog, where a second
 * modal would fight the first for the top layer. It dismisses on Escape and on
 * a pointer down outside itself, which is what a menu owes a keyboard user
 * that the surrounding modal doesn't already provide.
 *
 * Contract: render it as a sibling of its trigger inside a relatively
 * positioned wrapper. That wrapper is what counts as "inside" — dismissing on
 * anything outside the panel alone would fire on the trigger's own second
 * click, closing the menu a moment before that click reopened it.
 */
function Popover({
  onDismiss,
  align,
  children,
}: {
  onDismiss: () => void;
  align: 'start' | 'end';
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Captured at the document, ahead of the surrounding dialog: a close
      // request is the key's default action, so preventing it is what stops
      // one Escape from dismissing the menu and the composer together.
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
    }
    function onPointer(e: PointerEvent) {
      const wrapper = ref.current?.parentElement;
      if (wrapper && !wrapper.contains(e.target as Node)) onDismiss();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 0.35rem)',
        [align === 'end' ? 'right' : 'left']: 0,
        zIndex: 2,
        background: 'var(--modal-bg)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--modal-shadow)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: '11rem',
      }}
    >
      {children}
    </div>
  );
}

function MenuItem({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.55rem',
        padding: '0.55rem 0.8rem',
        background: 'transparent',
        border: 0,
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-serif)',
        fontSize: '0.85rem',
        textAlign: 'left',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-tertiary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ color: 'var(--text-tertiary)', display: 'inline-flex' }}>{icon}</span>
      {children}
    </button>
  );
}

/**
 * The error the user sees.
 *
 * Two are worth rewriting because the raw text names a cause the user has no
 * way to connect to a remedy: a missing scope is a box that wasn't ticked at
 * sign-in, and a key collision is a record that already exists and can be
 * edited instead. Everything else passes through verbatim — a PDS's validation
 * message is the most useful thing on the screen, and paraphrasing it would
 * cost the field name it names.
 */
function describeWriteError(err: unknown, action: 'create' | 'upload'): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/scope/i.test(raw) && /(missing|insufficient|not .*grant)/i.test(raw)) {
    const permission = action === 'upload' ? '“Upload”' : '“Create”';
    return `Your PDS refused this: the sign-in didn't include ${permission}. Sign out and back in with that box ticked. (${raw})`;
  }
  if (/already exists/i.test(raw)) {
    return `${raw} — pick another record key, or edit the existing record from its own page.`;
  }
  return raw;
}

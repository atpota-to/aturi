'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  Braces,
  Check,
  ChevronDown,
  Clock,
  IdCard,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import { isValidNsid } from '@/utils/atproto/spaceUri';
import { encodeRepo, rkeyFromAtUri } from '@/utils/atproto/urls';
import { lexiconPathFor } from '@/utils/ufos/nsid';
import { resolveLexiconDocument } from '@/utils/atproto/lexiconDoc';
import { formFromLexiconDocument } from '@/utils/atproto/lexiconForm';
import { checkRecord, checkRecordKey, type RecordProblem } from '@/utils/atproto/lexiconValidate';
import { blankRecordFrom, lexiconFor, type Lexicon } from '@/utils/atproto/lexicons';
import { CREATE_POINT_COST, recordSpend } from '@/utils/atproto/writeThrottle';
import { clearDraft, draftDiffersFrom, loadDraft, saveDraft } from '@/utils/recordDrafts';
import RecordPreview from '@/components/RecordPreview';
import AppearIn from './AppearIn';
import Breadcrumb from './Breadcrumb';
import NsidCombobox from './NsidCombobox';
import SignInPanel from './SignInPanel';
import { FormEditor } from './recordFields';
import { useRepoCollections } from './useRepoCollections';

/**
 * Write a record of any lexicon into your own repo.
 *
 * The explorer could already edit and delete records; this is the missing third
 * verb. It is deliberately not a Bluesky composer — it writes whatever NSID you
 * name, including one no app has published a schema for, because the thing
 * worth having here is what a general atproto client can do and a product
 * client can't.
 *
 * A page rather than a dialog, and a page laid out as two panes rather than two
 * modes. Both follow from what this actually is: not a confirmation step but an
 * authoring session, where the record body is the thing being worked on and
 * should never be hidden behind a toggle to see the fields, or the fields
 * hidden to see the body. The left pane is the address and the form; the right
 * pane is the record that will be written and a rendering of it. Editing either
 * side moves the other, because they are two views of one object and treating
 * them as two documents to reconcile is what makes a mode switch feel lossy.
 *
 * The schema does three jobs, not one. It builds the form, it checks the draft
 * as it is typed, and it says what the record key has to look like — so a
 * missing required field or a datetime without a timezone is something you fix
 * while writing rather than something a 400 tells you about afterwards. None of
 * it blocks: writing a record a published schema would refuse is a legitimate
 * thing to do while designing a lexicon, which is why the PDS validation
 * setting is on the page rather than buried.
 *
 * The write goes through `com.atproto.repo.createRecord`, which is create-only:
 * a record key already in use is refused rather than overwritten. Editing what
 * is already there is <RecordEditor>'s job, on the record's own page.
 */

type Props = {
  /** From `?collection=`, so a collection page can hand over what you were on. */
  initialCollection: string;
  /** From `?rkey=`. Rare; the lexicon usually decides. */
  initialRkey: string;
};

/**
 * What the PDS should do about lexicon validation, as the three states the
 * `validate` parameter has. Unset omits it and leaves the host's own rule:
 * check against a schema it knows, accept anything else.
 */
type ValidateMode = 'unset' | 'true' | 'false';

type SchemaState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'resolved'; doc: Record<string, unknown> }
  | { status: 'unresolved'; reason: string };

export default function RecordComposer({ initialCollection, initialRkey }: Props) {
  const { did, loading: sessionLoading } = useAtprotoSession();
  const [identity, setIdentity] = useState<IdentityBundle | null>(null);

  useEffect(() => {
    if (!did) {
      setIdentity(null);
      return undefined;
    }
    let cancelled = false;
    resolveIdentifier(did)
      .then((id) => {
        if (!cancelled) setIdentity(id);
      })
      .catch(() => {
        // The composer can write without this; only the breadcrumb and the
        // preview's blob thumbnails need the resolved repo.
      });
    return () => {
      cancelled = true;
    };
  }, [did]);

  if (!did && !sessionLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '32rem' }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontSize: '1.4rem',
            color: 'var(--text-primary)',
          }}
        >
          Write a record
        </h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Records are written into your own repository, so this needs a signed-in
          account. Sign in and you can create a record of any lexicon — including
          one nothing has published a schema for.
        </p>
        <SignInPanel />
      </div>
    );
  }

  // Keyed on the DID so switching accounts starts a clean composer rather than
  // carrying one account's draft and collection list into another's session.
  return <Composer key={did || 'anon'} did={did} identity={identity} initialCollection={initialCollection} initialRkey={initialRkey} />;
}

function Composer({
  did,
  identity,
  initialCollection,
  initialRkey,
}: {
  did: string | null;
  identity: IdentityBundle | null;
  initialCollection: string;
  initialRkey: string;
}) {
  const router = useRouter();
  const { agent } = useAtprotoSession();
  const jsonRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const collectionFieldId = useId();
  const rkeyFieldId = useId();

  const [collection, setCollection] = useState(initialCollection);
  const [rkey, setRkey] = useState(initialRkey);
  const [rkeyTouched, setRkeyTouched] = useState(Boolean(initialRkey));
  const [record, setRecord] = useState<Record<string, unknown>>({});
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [validate, setValidate] = useState<ValidateMode>('unset');
  const [insertOpen, setInsertOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  /**
   * The collection the body on screen was written for, which is not always the
   * one named above it: changing the collection deliberately leaves a draft in
   * place rather than destroying it, and the schema check then says plainly
   * that `$type` and the address disagree.
   *
   * Drafts are filed under this rather than under the field, so a body typed
   * for one collection is never stored as another's.
   */
  const [bodyNsid, setBodyNsid] = useState('');

  /**
   * Which pane last changed the record, so the other can follow without the
   * two fighting. A ref, because it is read inside the sync effect and must
   * not itself cause one.
   */
  const sourceRef = useRef<'form' | 'json'>('form');
  /**
   * True once the user has put something of their own into the body.
   *
   * State and a ref, because it is read in two incompatible ways: the Discard
   * button renders from it, which a ref cannot drive, and the seeding effect
   * consults it, which state would make a dependency — re-running the seed on
   * the keystroke that set it, over the draft it was protecting.
   */
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setDirty(true);
  }, []);
  const rkeyTouchedRef = useRef(rkeyTouched);
  rkeyTouchedRef.current = rkeyTouched;

  const ownCollections = useRepoCollections(did, identity?.pds);
  const nsid = collection.trim();
  const nsidValid = isValidNsid(nsid);

  const [schema, setSchema] = useState<SchemaState>({ status: 'idle' });

  /**
   * Fetch the published lexicon for whatever collection is named.
   *
   * Always, even where Aturi carries its own template for that NSID. The two
   * answer different questions: the template decides which fields the form
   * offers, and the published document decides whether the draft is valid. A
   * form built from the abridged template and checked against nothing would be
   * the worst of both.
   */
  useEffect(() => {
    if (!nsidValid) {
      setSchema({ status: 'idle' });
      return undefined;
    }
    let cancelled = false;
    setSchema({ status: 'loading' });
    // Debounced: an NSID passes validation several keystrokes before it is
    // finished (`com.example.foo` on the way to `com.example.foobar`), and
    // each attempt costs a DNS query and a repo read.
    const timer = window.setTimeout(() => {
      resolveLexiconDocument(nsid)
        .then((resolved) => {
          if (cancelled) return;
          setSchema(
            resolved
              ? { status: 'resolved', doc: resolved.doc }
              : {
                  status: 'unresolved',
                  reason: `No published lexicon found for ${nsid}. The record pane still writes whatever you put in it.`,
                },
          );
        })
        .catch(() => {
          if (!cancelled) {
            setSchema({
              status: 'unresolved',
              reason: 'Could not reach that lexicon’s publisher. The record pane still works.',
            });
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [nsid, nsidValid]);

  const schemaDoc = schema.status === 'resolved' ? schema.doc : null;

  /**
   * The form. Aturi's own template wins where it has one — those are curated
   * down to the fields people actually fill, against a published schema for the
   * same NSID that is a wall of facets and embeds — and everything else is
   * derived from the document above. Where neither yields a form, the record
   * pane is the whole interface, which is the correct answer for a lexicon with
   * no schema anywhere.
   */
  const form = useMemo<{ lexicon: Lexicon; source: 'aturi' | 'published' } | null>(() => {
    if (!nsidValid) return null;
    const builtIn = lexiconFor(nsid);
    if (builtIn) return { lexicon: builtIn, source: 'aturi' };
    if (!schemaDoc) return null;
    const derived = formFromLexiconDocument(nsid, schemaDoc);
    return derived.ok ? { lexicon: derived.lexicon, source: 'published' } : null;
  }, [nsid, nsidValid, schemaDoc]);

  const lexicon = form?.lexicon ?? null;

  /** The starting body for this collection: `$type` plus the schema's defaults. */
  const seedText = useMemo(() => {
    const seed = lexicon
      ? blankRecordFrom(lexicon)
      : nsid
        ? ({ $type: nsid } as Record<string, unknown>)
        : {};
    return Object.keys(seed).length ? `${JSON.stringify(seed, null, 2)}\n` : '';
  }, [lexicon, nsid]);

  // Seed the body, or restore the draft that was left for this collection.
  // Never over a draft in progress: a template is replaceable, work is not.
  useEffect(() => {
    if (dirtyRef.current) return;
    const stored = did && nsid ? loadDraft(did, nsid) : null;
    const text = stored?.json ?? seedText;

    setBodyNsid(nsid);
    sourceRef.current = 'json';
    setJsonText(text);
    try {
      const parsed: unknown = text.trim() ? JSON.parse(text) : {};
      setRecord(isPlainObject(parsed) ? parsed : {});
      setJsonError(null);
    } catch {
      setRecord({});
    }

    if (stored) {
      markDirty();
      // Only announce a restore that restored something. The seed gets saved
      // like any other body, so a notice over an untouched template would be
      // claiming work that was never done.
      setDraftRestored(draftDiffersFrom(stored.json, seedText));
      if (stored.rkey && !rkeyTouchedRef.current) setRkey(stored.rkey);
      return;
    }

    setDraftRestored(false);
    if (!rkeyTouchedRef.current) {
      setRkey(lexicon?.rkeyMode === 'fixed' ? lexicon.rkeyDefault || '' : '');
    }
  }, [seedText, lexicon, nsid, did, markDirty]);

  // record → JSON, whenever the form was what moved it.
  useEffect(() => {
    if (sourceRef.current === 'json') return;
    setJsonText(`${JSON.stringify(record, null, 2)}\n`);
    setJsonError(null);
  }, [record]);

  // Keep the draft, debounced so a fast typist isn't writing to disk on every
  // keystroke. Only once there is something of the user's own in it.
  useEffect(() => {
    if (!did || !bodyNsid || !dirty) return undefined;
    const timer = window.setTimeout(() => {
      saveDraft(did, { collection: bodyNsid, rkey, json: jsonText });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [did, bodyNsid, rkey, jsonText, dirty]);

  const updateField = useCallback((key: string, next: unknown) => {
    markDirty();
    sourceRef.current = 'form';
    setRecord((prev) => {
      // An optional field emptied back out is absent, not an empty string:
      // "" and missing mean different things in every schema that has both.
      const out = { ...prev };
      if (next === undefined || next === '') delete out[key];
      else out[key] = next;
      return out;
    });
  }, [markDirty]);

  const updateJson = useCallback((next: string) => {
    markDirty();
    sourceRef.current = 'json';
    setJsonText(next);
    if (!next.trim()) {
      setRecord({});
      setJsonError(null);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(next);
      if (!isPlainObject(parsed)) {
        setJsonError('A record has to be a JSON object.');
        return;
      }
      setRecord(parsed);
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
    }
  }, [markDirty]);

  /** Splice text in at the record pane's caret, replacing any selection. */
  const insertAtCaret = useCallback(
    (text: string) => {
      const el = jsonRef.current;
      const current = el?.value ?? jsonText;
      const start = el?.selectionStart ?? current.length;
      const end = el?.selectionEnd ?? start;
      updateJson(current.slice(0, start) + text + current.slice(end));
      setInsertOpen(false);
      // After React has rendered the new value; setting it now would be undone.
      window.requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + text.length, start + text.length);
      });
    },
    [jsonText, updateJson],
  );

  async function handleUpload(file: File) {
    if (!agent) return;
    setUploading(true);
    setWriteError(null);
    try {
      // The File goes straight to the transport, which takes a Blob — no
      // reason to read a video into a JS array on the way past. `encoding` is
      // explicit because a file the OS couldn't type arrives with an empty
      // `type`, and a PDS needs one to store the blob under.
      const res = await agent.com.atproto.repo.uploadBlob(file, {
        encoding: file.type || 'application/octet-stream',
      });
      const ref = ((res?.data || res) as { blob?: unknown }).blob;
      const json =
        ref && typeof (ref as { toJSON?: () => unknown }).toJSON === 'function'
          ? (ref as { toJSON: () => unknown }).toJSON()
          : ref;
      insertAtCaret(JSON.stringify(json, null, 2));
    } catch (err) {
      setWriteError(describeWriteError(err, 'upload'));
    } finally {
      setUploading(false);
    }
  }

  /**
   * Everything the schema disagrees with, recomputed as the record moves.
   *
   * Runs against the published document rather than the derived form, so the
   * constraints a form can't express — byte ceilings, formats, blob accept
   * lists — are checked even where the form came from Aturi's own template.
   */
  const problems = useMemo(
    () => (nsidValid ? checkRecord(nsid, schemaDoc, record) : []),
    [nsid, nsidValid, schemaDoc, record],
  );
  const keyProblem = useMemo(
    () => (nsidValid ? checkRecordKey(schemaDoc, rkey) : null),
    [nsidValid, schemaDoc, rkey],
  );

  const problemsByField = useMemo(() => {
    const map = new Map<string, RecordProblem[]>();
    for (const problem of problems) {
      if (!problem.field) continue;
      const list = map.get(problem.field);
      if (list) list.push(problem);
      else map.set(problem.field, [problem]);
    }
    return map;
  }, [problems]);

  // Anything the form isn't already showing in place: record-level findings,
  // and properties with no control of their own. Listing the rest again under
  // the button would say everything twice.
  const formKeys = useMemo(
    () => new Set((lexicon?.fields ?? []).map((f) => f.key)),
    [lexicon],
  );
  const unattached = problems.filter((p) => !p.field || !formKeys.has(p.field));
  const errorCount = problems.filter((p) => p.severity === 'error').length;
  const warningCount = problems.length - errorCount;

  const repoSeg = identity ? encodeRepo(identity.handle || identity.did) : '';

  async function handleWrite() {
    if (!agent || !did || saving) return;
    if (!nsid) {
      setWriteError('Name the collection to write into.');
      return;
    }
    if (!nsidValid) {
      setWriteError(`“${nsid}” isn’t a valid NSID. Collections look like com.example.thing.`);
      return;
    }
    if (jsonError) {
      setWriteError(`The record pane doesn’t parse: ${jsonError}`);
      return;
    }

    setSaving(true);
    setWriteError(null);
    try {
      const chosenRkey = rkey.trim();
      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: nsid,
        ...(chosenRkey ? { rkey: chosenRkey } : {}),
        ...(validate === 'unset' ? {} : { validate: validate === 'true' }),
        record,
      });
      // The same budget the bulk delete paces against, so a session that
      // composed its way through the hourly limit finds out here, not there.
      recordSpend(did, CREATE_POINT_COST);
      clearDraft(did, nsid);

      const uri = ((res?.data || res) as { uri?: string })?.uri || '';
      const written = chosenRkey || rkeyFromAtUri(uri) || '';
      const collectionPath = `/explore/${repoSeg || encodeRepo(did)}/${encodeURIComponent(nsid)}`;
      router.push(written ? `${collectionPath}/${encodeURIComponent(written)}` : collectionPath);
    } catch (err) {
      setWriteError(describeWriteError(err, 'create'));
      setSaving(false);
    }
  }

  function discardDraft() {
    // Both, because the body may have been written for a different collection
    // than the one now named: its own stored draft is what "discard" means,
    // and the current collection's is what would otherwise be restored a
    // moment later.
    if (did) {
      if (bodyNsid) clearDraft(did, bodyNsid);
      if (nsid && nsid !== bodyNsid) clearDraft(did, nsid);
    }
    setBodyNsid(nsid);
    dirtyRef.current = false;
    setDirty(false);
    sourceRef.current = 'json';
    setJsonText(seedText);
    try {
      setRecord(seedText.trim() ? (JSON.parse(seedText) as Record<string, unknown>) : {});
    } catch {
      setRecord({});
    }
    setJsonError(null);
    setDraftRestored(false);
  }

  return (
    <div
      className="composer"
      onKeyDown={(e) => {
        // The write shortcut every editor has. Bound on the page rather than a
        // form, because the two panes are not one form and Enter inside either
        // has to keep meaning "newline" or "pick a suggestion".
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          void handleWrite();
        }
      }}
    >
      <AppearIn rise>
        <Breadcrumb
          handle={identity?.handle ?? null}
          did={did || ''}
          pds={identity?.pds}
          collection={nsidValid ? nsid : undefined}
          trailing="new record"
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <div className="composer-grid">
          {/* ---------------------------------------------------------- left */}
          <div className="composer-col">
            <section className="composer-panel composer-where">
              <PanelHeading>Where it goes</PanelHeading>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label htmlFor={collectionFieldId} className="composer-label">
                    Collection
                  </label>
                  <NsidCombobox
                    id={collectionFieldId}
                    value={collection}
                    onChange={setCollection}
                    ownCollections={ownCollections}
                    autoFocus={!initialCollection}
                  />
                  <SchemaNote state={schema} nsid={nsid} nsidValid={nsidValid} form={form} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label htmlFor={rkeyFieldId} className="composer-label">
                    Record key
                  </label>
                  <input
                    id={rkeyFieldId}
                    className="explore-input explore-mono"
                    type="text"
                    value={rkey}
                    onChange={(e) => {
                      setRkey(e.target.value);
                      setRkeyTouched(true);
                    }}
                    placeholder="assigned by your PDS"
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    style={{ fontSize: '0.82rem' }}
                  />
                  {keyProblem ? (
                    <ProblemLine problem={keyProblem} />
                  ) : (
                    <p className="composer-note">
                      {rkey.trim()
                        ? 'This exact key. Creating fails if a record already has it.'
                        : 'Left empty, your PDS mints a timestamp key.'}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="composer-panel composer-fields">
              <PanelHeading>
                Fields
                {lexicon && (
                  <span className="composer-heading-aside">
                    {lexicon.fields.length} in this lexicon
                  </span>
                )}
              </PanelHeading>
              {lexicon ? (
                <FormEditor
                  lex={lexicon}
                  value={record}
                  onChange={updateField}
                  problems={problemsByField}
                />
              ) : (
                <p className="composer-note" style={{ margin: 0 }}>
                  {!nsidValid
                    ? 'Name a collection above and its fields appear here, if its lexicon is published.'
                    : schema.status === 'loading'
                      ? 'Looking for a published lexicon…'
                      : 'No form for this one. Write the record in the pane on the right — it will be accepted exactly as you put it.'}
                </p>
              )}
            </section>

            <section className="composer-panel composer-actions">
              <PanelHeading>Before you write</PanelHeading>

              <CheckSummary
                nsidValid={nsidValid}
                hasSchema={Boolean(schemaDoc)}
                errorCount={errorCount}
                warningCount={warningCount}
              />

              {unattached.length > 0 && (
                <ul className="composer-problems">
                  {unattached.map((problem, i) => (
                    <li key={i}>
                      <ProblemLine problem={problem} showField />
                    </li>
                  ))}
                </ul>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <span className="composer-label" id="composer-validate-label">
                  PDS validation
                </span>
                <div
                  role="radiogroup"
                  aria-labelledby="composer-validate-label"
                  className="composer-segmented"
                >
                  {(
                    [
                      { value: 'unset', label: 'Default' },
                      { value: 'true', label: 'Require' },
                      { value: 'false', label: 'Skip' },
                    ] as const
                  ).map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={validate === value}
                      onClick={() => setValidate(value)}
                      className={validate === value ? 'is-on' : undefined}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="composer-note">
                  {validate === 'unset'
                    ? 'Your PDS checks the record against any lexicon it knows, and accepts the rest.'
                    : validate === 'true'
                      ? 'Your PDS refuses the write unless it can resolve the lexicon and the record matches it.'
                      : 'Your PDS skips the schema check. This is how you write a record a published lexicon would refuse.'}
                </p>
              </div>

              {writeError && (
                <p role="alert" className="explore-error" style={{ margin: 0 }}>
                  {writeError}
                </p>
              )}

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => void handleWrite()}
                  disabled={saving || !agent}
                  className="composer-write"
                >
                  {saving ? (
                    <Loader2 size={13} className="explore-spin" aria-hidden />
                  ) : (
                    <Check size={13} aria-hidden />
                  )}
                  {saving ? 'Writing…' : 'Write record'}
                </button>
                {dirty && (
                  <button type="button" onClick={discardDraft} className="composer-secondary">
                    <Trash2 size={12} aria-hidden /> Discard draft
                  </button>
                )}
                <span className="composer-note" style={{ marginLeft: 'auto' }}>
                  ⌘↵ writes
                </span>
              </div>
            </section>
          </div>

          {/* --------------------------------------------------------- right */}
          <div className="composer-col composer-aside">
            <section className="composer-panel composer-record">
              <PanelHeading>
                Record
                <span className="composer-heading-actions">
                  <button
                    type="button"
                    className="composer-tool"
                    onClick={() => {
                      sourceRef.current = 'form';
                      setRecord((r) => ({ ...r }));
                    }}
                    disabled={Boolean(jsonError)}
                    title="Re-indent the record"
                  >
                    <Braces size={12} aria-hidden /> Tidy
                  </button>
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    <button
                      type="button"
                      className="composer-tool"
                      aria-expanded={insertOpen}
                      onClick={() => setInsertOpen((v) => !v)}
                      disabled={uploading}
                    >
                      {uploading ? (
                        <Loader2 size={12} className="explore-spin" aria-hidden />
                      ) : (
                        <ChevronDown size={12} aria-hidden />
                      )}
                      {uploading ? 'Uploading…' : 'Insert'}
                    </button>
                    {insertOpen && (
                      <InsertMenu
                        onDismiss={() => setInsertOpen(false)}
                        onDid={() => did && insertAtCaret(JSON.stringify(did))}
                        onTimestamp={() => insertAtCaret(JSON.stringify(new Date().toISOString()))}
                        onBlob={() => {
                          setInsertOpen(false);
                          fileRef.current?.click();
                        }}
                      />
                    )}
                  </span>
                </span>
              </PanelHeading>

              <textarea
                ref={jsonRef}
                className="explore-input explore-textarea explore-mono composer-json"
                value={jsonText}
                onChange={(e) => updateJson(e.target.value)}
                spellCheck={false}
                aria-label="Record JSON"
                placeholder={'{\n  "$type": "com.example.record"\n}'}
              />
              {jsonError ? (
                <p className="composer-json-error">Not valid JSON yet: {jsonError}</p>
              ) : (
                <p className="composer-note">
                  Edit here or in the fields — each follows the other.
                  {draftRestored && ' Restored from a draft you left.'}
                </p>
              )}
            </section>

            <section className="composer-panel composer-previewed">
              <PanelHeading>Preview</PanelHeading>
              {isEmptyRecord(record) ? (
                <p className="composer-note" style={{ margin: 0 }}>
                  Nothing to render yet.
                </p>
              ) : (
                <div className="composer-preview">
                  <RecordPreview
                    record={{
                      uri: `at://${did || ''}/${nsid}/${rkey.trim() || 'new'}`,
                      cid: '',
                      value: record,
                    }}
                    collection={nsid || 'record'}
                    handle={identity?.handle || did || ''}
                    rkey={rkey.trim() || 'new'}
                    pds={identity?.pds}
                    hideExplorerCtas
                  />
                </div>
              )}
            </section>
          </div>
        </div>
      </AppearIn>

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
  );
}

/* ------------------------------------------------------------------ pieces */

function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="composer-panel-heading">
      {children}
    </h2>
  );
}

/**
 * Where the form came from, or why there isn't one.
 *
 * Worth its own line: a generated form shows the fields one schema declares,
 * and someone deciding whether to trust it needs to know whether that schema is
 * the lexicon's own or this app's abridgement of it. The link goes to the
 * lexicon page, which is where the full answer lives.
 */
function SchemaNote({
  state,
  nsid,
  nsidValid,
  form,
}: {
  state: SchemaState;
  nsid: string;
  nsidValid: boolean;
  form: { source: 'aturi' | 'published' } | null;
}) {
  if (!nsid) return <p className="composer-note">Any NSID. Yours are suggested first.</p>;
  if (!nsidValid) {
    return (
      <p className="composer-note">
        Not an NSID yet — they look like <code>com.example.thing</code>.
      </p>
    );
  }
  if (state.status === 'loading') return <p className="composer-note">Looking up the lexicon…</p>;

  return (
    <p className="composer-note">
      {form?.source === 'aturi'
        ? 'Aturi’s own form for this lexicon: the common fields, not all of them. '
        : form?.source === 'published'
          ? 'Form and checks built from the published lexicon. '
          : state.status === 'unresolved'
            ? `${state.reason} `
            : ''}
      <Link href={lexiconPathFor(nsid)} className="composer-link">
        About {nsid}
      </Link>
    </p>
  );
}

/**
 * The one-line verdict above the write button.
 *
 * Says what was checked as well as what was found, because "no problems" means
 * something different when nothing could be checked — and a composer that
 * looked equally confident either way would be lying by omission.
 */
function CheckSummary({
  nsidValid,
  hasSchema,
  errorCount,
  warningCount,
}: {
  nsidValid: boolean;
  hasSchema: boolean;
  errorCount: number;
  warningCount: number;
}) {
  if (!nsidValid) return null;
  if (!hasSchema) {
    return (
      <p className="composer-check">
        No published lexicon to check against. Your PDS has the final say.
      </p>
    );
  }
  if (errorCount === 0 && warningCount === 0) {
    return (
      <p className="composer-check is-ok">
        <Check size={13} aria-hidden /> Matches the published lexicon.
      </p>
    );
  }
  const parts = [
    errorCount ? `${errorCount} problem${errorCount === 1 ? '' : 's'}` : '',
    warningCount ? `${warningCount} to check` : '',
  ].filter(Boolean);
  return (
    <p className={errorCount ? 'composer-check is-bad' : 'composer-check is-warn'}>
      <AlertTriangle size={13} aria-hidden /> {parts.join(' · ')}. You can still write it.
    </p>
  );
}

function ProblemLine({ problem, showField }: { problem: RecordProblem; showField?: boolean }) {
  return (
    <span
      style={{
        display: 'block',
        fontSize: '0.75rem',
        lineHeight: 1.45,
        color: problem.severity === 'error' ? 'var(--danger)' : 'var(--text-secondary)',
      }}
    >
      {problem.severity === 'error' ? '✕ ' : '! '}
      {showField && problem.field && (
        <code style={{ background: 'transparent', padding: 0, color: 'inherit' }}>
          {problem.field}
        </code>
      )}
      {showField && problem.field ? ' — ' : ''}
      {problem.message}
    </span>
  );
}

/**
 * The record pane's three insertions — the values that are tedious to produce
 * by hand and easy to get subtly wrong.
 *
 * Anchored to its trigger rather than made a dialog, and dismissed on Escape or
 * a pointer outside the wrapper it shares with that trigger. The wrapper is
 * what counts as inside: dismissing on anything outside the menu alone would
 * fire on the trigger's own second click, closing the menu a moment before that
 * click reopened it.
 */
function InsertMenu({
  onDismiss,
  onDid,
  onTimestamp,
  onBlob,
}: {
  onDismiss: () => void;
  onDid: () => void;
  onTimestamp: () => void;
  onBlob: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss();
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
    <div ref={ref} className="composer-menu">
      <button type="button" onClick={onDid}>
        <IdCard size={13} aria-hidden /> Your DID
      </button>
      <button type="button" onClick={onTimestamp}>
        <Clock size={13} aria-hidden /> Timestamp, now
      </button>
      <button type="button" onClick={onBlob}>
        <Upload size={13} aria-hidden /> Upload a blob
      </button>
    </div>
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only `$type` (or nothing) means the record has no content to render. */
function isEmptyRecord(record: Record<string, unknown>): boolean {
  return Object.keys(record).filter((k) => k !== '$type').length === 0;
}

/**
 * The error the user sees.
 *
 * Two are worth rewriting, because the raw text names a cause with no visible
 * remedy: a missing scope is a box that wasn't ticked at sign-in, and a key
 * collision is a record that already exists and can be edited instead.
 * Everything else passes through verbatim — a PDS's validation message is the
 * most useful thing on the screen, and paraphrasing it would cost the field
 * name it names.
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

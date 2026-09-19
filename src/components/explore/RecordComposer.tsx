'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Braces,
  Check,
  ChevronDown,
  Clock,
  IdCard,
  Loader2,
  PencilLine,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import { isValidNsid } from '@/utils/atproto/spaceUri';
import { encodeRepo, rkeyFromAtUri, shortDid } from '@/utils/atproto/urls';
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
import LinkifiedJson from './LinkifiedJson';
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
 * Three steps, one column. The explorer is a reading-measure site and every
 * other page in it is a single column you work down; a composer that broke out
 * into two panes was a different app wearing the same header. The steps follow
 * the order the decisions actually come in:
 *
 *   1. Which collection. Names the lexicon, and so decides everything below.
 *   2. The record. A form when the lexicon can be turned into one, raw JSON
 *      when it can't or when that's what you want; the two are views of one
 *      object and switching between them converts rather than discards.
 *   3. Review. The address, the exact JSON that will be written, a rendering of
 *      it, everything the schema disagrees with, and the write.
 *
 * The schema does three jobs, not one. It builds the form, it checks the draft
 * as it is typed, and it says what the record key has to look like — so a
 * missing required field or a datetime without a timezone is something you fix
 * on step two rather than something a 400 tells you about after step three.
 * None of it blocks: writing a record a published schema would refuse is a
 * legitimate thing to do while designing a lexicon, which is why the PDS
 * validation setting is on the review step rather than buried.
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

type Step = 1 | 2 | 3;

const STEPS: { n: Step; label: string; title: string; blurb: string }[] = [
  {
    n: 1,
    label: 'Collection',
    title: 'Which collection?',
    blurb: 'The lexicon this record belongs to. Yours are suggested first; any NSID works.',
  },
  {
    n: 2,
    label: 'Record',
    title: 'Fill in the record',
    blurb: 'From the fields the lexicon declares, or as JSON. Either way it is checked as you go.',
  },
  {
    n: 3,
    label: 'Review',
    title: 'Review and write',
    blurb: 'Exactly what will be written, where, and anything the schema disagrees with.',
  },
];

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
        <h1 className="composer-title">Write a record</h1>
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
  return (
    <Composer
      key={did || 'anon'}
      did={did}
      identity={identity}
      initialCollection={initialCollection}
      initialRkey={initialRkey}
    />
  );
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
  const topRef = useRef<HTMLDivElement>(null);
  const jsonRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const collectionFieldId = useId();
  const rkeyFieldId = useId();

  // A collection handed over by the page you came from is a decision already
  // made, so the composer opens on the record rather than asking again.
  const startStep: Step = isValidNsid(initialCollection.trim()) ? 2 : 1;
  const [step, setStep] = useState<Step>(startStep);
  /** The furthest step visited, which is how far the stepper lets you jump. */
  const [reached, setReached] = useState<Step>(startStep);
  const [stepError, setStepError] = useState<string | null>(null);

  const [collection, setCollection] = useState(initialCollection);
  const [rkey, setRkey] = useState(initialRkey);
  const [rkeyTouched, setRkeyTouched] = useState(Boolean(initialRkey));
  const [record, setRecord] = useState<Record<string, unknown>>({});
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [validate, setValidate] = useState<ValidateMode>('unset');
  const [insertOpen, setInsertOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  /**
   * The collection the body on screen was written for. Drafts are filed under
   * this rather than under the collection field, so a body typed for one
   * collection is never stored as another's — and changing the collection can
   * safely swap the body out, because the old one is already in its own draft.
   */
  const [bodyNsid, setBodyNsid] = useState('');

  /**
   * Which editor last changed the record, so the other can follow without the
   * two fighting. A ref, because it is read inside the sync effect and must
   * not itself cause one.
   */
  const sourceRef = useRef<'form' | 'json'>('form');
  /**
   * True once the user has edited the body in this session. A draft restored
   * from storage does not count: it is protected by being stored, not by being
   * here, and treating it as an edit would stop the collection field from
   * swapping in the right body for a lexicon you have only just named.
   *
   * State and a ref, because it is read in two incompatible ways: the discard
   * affordance renders from it, which a ref cannot drive, and the seeding
   * effect consults it, which state would make a dependency — re-running the
   * seed on the keystroke that set it, over the draft it was protecting.
   */
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setDirty(true);
  }, []);
  // Mirrors the seeding effect reads without depending on. See `dirtyRef`.
  const rkeyTouchedRef = useRef(rkeyTouched);
  rkeyTouchedRef.current = rkeyTouched;
  const rkeyRef = useRef(rkey);
  rkeyRef.current = rkey;
  const jsonTextRef = useRef(jsonText);
  jsonTextRef.current = jsonText;
  const bodyNsidRef = useRef(bodyNsid);
  bodyNsidRef.current = bodyNsid;

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
                  reason: `No published lexicon found for ${nsid}. You can still write any JSON under it.`,
                },
          );
        })
        .catch(() => {
          if (!cancelled) {
            setSchema({
              status: 'unresolved',
              reason: 'Could not reach that lexicon’s publisher. You can still write any JSON under it.',
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
   * derived from the document above. Where neither yields a form, JSON is the
   * whole interface, which is the correct answer for a lexicon with no schema
   * anywhere.
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
  // JSON is the only editor there is without a form, whatever was picked.
  const editor: 'form' | 'json' = lexicon ? mode : 'json';

  /** The starting body for this collection: `$type` plus the schema's defaults. */
  const seedText = useMemo(() => {
    const seed = lexicon
      ? blankRecordFrom(lexicon)
      : nsid
        ? ({ $type: nsid } as Record<string, unknown>)
        : {};
    return Object.keys(seed).length ? `${JSON.stringify(seed, null, 2)}\n` : '';
  }, [lexicon, nsid]);

  /**
   * Seed the body for the named collection, or restore the draft left for it.
   *
   * Runs when the collection changes and when its lexicon arrives. A body
   * edited this session is left alone in the second case — a template is
   * replaceable, work is not — but swapped out in the first, after filing it
   * under its own collection: naming a different lexicon means a different
   * record, and the one you were writing is a step back away in its draft.
   */
  useEffect(() => {
    const collectionChanged = bodyNsidRef.current !== nsid;
    if (!collectionChanged && dirtyRef.current) return;

    // Ahead of the debounced save, which the swap below would otherwise cancel
    // with the last few hundred milliseconds of typing still unsaved.
    if (collectionChanged && dirtyRef.current && did && bodyNsidRef.current) {
      saveDraft(did, {
        collection: bodyNsidRef.current,
        rkey: rkeyRef.current,
        json: jsonTextRef.current,
      });
    }

    const stored = did && nsid ? loadDraft(did, nsid) : null;
    const text = stored?.json ?? seedText;

    bodyNsidRef.current = nsid;
    setBodyNsid(nsid);
    dirtyRef.current = false;
    setDirty(false);
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
  }, [seedText, lexicon, nsid, did]);

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

  const updateField = useCallback(
    (key: string, next: unknown) => {
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
    },
    [markDirty],
  );

  const updateJson = useCallback(
    (next: string) => {
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
    },
    [markDirty],
  );

  /** Splice text in at the JSON editor's caret, replacing any selection. */
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

  // What the record step shows. The required-field findings wait until the
  // user has started, so a fresh form isn't red before anything was typed.
  const shownProblems = useMemo(
    () => (dirty ? problems : problems.filter((p) => p.code !== 'required')),
    [problems, dirty],
  );

  const problemsByField = useMemo(() => {
    const map = new Map<string, RecordProblem[]>();
    for (const problem of shownProblems) {
      if (!problem.field) continue;
      const list = map.get(problem.field);
      if (list) list.push(problem);
      else map.set(problem.field, [problem]);
    }
    return map;
  }, [shownProblems]);

  // On the record step the form shows its own fields' findings in place, so
  // the list under it carries only what has no control: record-level findings
  // and properties the form doesn't offer. The review step has no fields on
  // screen and lists everything.
  const formKeys = useMemo(() => new Set((lexicon?.fields ?? []).map((f) => f.key)), [lexicon]);
  const unattached = shownProblems.filter((p) => !p.field || !formKeys.has(p.field));
  const errorCount = problems.filter((p) => p.severity === 'error').length;
  const warningCount = problems.length - errorCount;

  const repoSeg = identity ? encodeRepo(identity.handle || identity.did) : '';
  const repoLabel = identity?.handle ? `@${identity.handle}` : did ? shortDid(did) : '';

  /**
   * Move between steps, refusing to leave one whose answer isn't usable yet.
   * Forward only through this; the stepper can jump anywhere already reached.
   */
  function goTo(next: Step) {
    if (next > 1 && !nsidValid) {
      setStepError(
        nsid
          ? `“${nsid}” isn’t a valid NSID. Collections look like com.example.thing.`
          : 'Name the collection to write into.',
      );
      return;
    }
    if (next > 2 && jsonError) {
      setStepError(`The JSON doesn’t parse yet: ${jsonError}`);
      return;
    }
    setStepError(null);
    setWriteError(null);
    setStep(next);
    setReached((r) => (next > r ? next : r));
    // The stepper is at the top and the next step starts there; a long form
    // otherwise leaves you looking at the bottom of the previous one.
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function switchEditor(next: 'form' | 'json') {
    if (next === mode) return;
    if (next === 'form' && jsonError) {
      setStepError(`Fix the JSON before switching to the fields: ${jsonError}`);
      return;
    }
    setStepError(null);
    setMode(next);
  }

  async function handleWrite() {
    if (!agent || !did || saving) return;
    if (!nsidValid || jsonError) {
      goTo(3);
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
    bodyNsidRef.current = nsid;
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

  const current = STEPS[step - 1];
  const hasDraft = dirty || draftRestored;

  return (
    <div
      ref={topRef}
      className="composer"
      onKeyDown={(e) => {
        // One shortcut for "proceed": the next step, or on the last one the
        // write. Bound on the page rather than a form, because Enter inside a
        // field has to keep meaning "newline" or "pick a suggestion".
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          if (step === 3) void handleWrite();
          else goTo((step + 1) as Step);
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
        <ol className="composer-steps" aria-label="Steps">
          {STEPS.map((s) => {
            const state =
              s.n === step ? 'current' : s.n < step ? 'done' : s.n <= reached ? 'open' : 'todo';
            return (
              <li
                key={s.n}
                className={`composer-step is-${state}`}
                aria-current={s.n === step ? 'step' : undefined}
              >
                <button
                  type="button"
                  disabled={s.n > reached || s.n === step}
                  onClick={() => goTo(s.n)}
                >
                  <span className="composer-step-num" aria-hidden>
                    {state === 'done' ? <Check size={11} /> : s.n}
                  </span>
                  <span className="composer-step-label">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </AppearIn>

      {/* Keyed on the step so each one fades in fresh rather than morphing
          out of the last. */}
      <AppearIn key={step} delay={0.05} rise>
        <div className="composer-step-head">
          <h1 className="composer-title">{current.title}</h1>
          <p className="composer-blurb">{current.blurb}</p>
        </div>

        {/* ================================================== 1. collection */}
        {step === 1 && (
          <section className="composer-panel">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label htmlFor={collectionFieldId} className="composer-label">
                Collection
              </label>
              <NsidCombobox
                id={collectionFieldId}
                value={collection}
                onChange={(v) => {
                  setCollection(v);
                  setStepError(null);
                }}
                ownCollections={ownCollections}
                autoFocus
              />
              <SchemaNote state={schema} nsid={nsid} nsidValid={nsidValid} form={form} />
            </div>

            {nsidValid && (
              <LexiconGlance
                state={schema}
                lexicon={lexicon}
                source={form?.source ?? null}
              />
            )}
          </section>
        )}

        {/* ====================================================== 2. record */}
        {step === 2 && (
          <section className="composer-panel">
            <div className="composer-editor-bar">
              {lexicon ? (
                <div role="radiogroup" aria-label="Editor" className="composer-segmented">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={editor === 'form'}
                    className={editor === 'form' ? 'is-on' : undefined}
                    onClick={() => switchEditor('form')}
                  >
                    Fields
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={editor === 'json'}
                    className={editor === 'json' ? 'is-on' : undefined}
                    onClick={() => switchEditor('json')}
                  >
                    JSON
                  </button>
                </div>
              ) : (
                <span className="composer-label">
                  {schema.status === 'loading' ? 'Looking up the lexicon…' : 'JSON'}
                </span>
              )}

              {editor === 'json' && (
                <span className="composer-heading-actions">
                  <button
                    type="button"
                    className="composer-tool"
                    onClick={() => {
                      sourceRef.current = 'form';
                      setRecord((r) => ({ ...r }));
                    }}
                    disabled={Boolean(jsonError)}
                    title="Re-indent the JSON"
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
                        onTimestamp={() =>
                          insertAtCaret(JSON.stringify(new Date().toISOString()))
                        }
                        onBlob={() => {
                          setInsertOpen(false);
                          fileRef.current?.click();
                        }}
                      />
                    )}
                  </span>
                </span>
              )}
            </div>

            {draftRestored && (
              <p className="composer-note composer-restored">
                Restored from a draft you left for this collection.
                <button type="button" className="composer-inline-action" onClick={discardDraft}>
                  Start over
                </button>
              </p>
            )}

            {editor === 'form' && lexicon ? (
              <>
                <FormEditor
                  lex={lexicon}
                  value={record}
                  onChange={updateField}
                  problems={problemsByField}
                />
                {form?.source === 'aturi' && (
                  <p className="composer-note">
                    These are the common fields. Anything else this lexicon allows
                    goes in through JSON.
                  </p>
                )}
              </>
            ) : (
              <>
                {!lexicon && schema.status !== 'loading' && (
                  <p className="composer-note">
                    No form for this one — nothing published a schema Aturi could turn
                    into fields. Whatever you write here is sent exactly as it is.
                  </p>
                )}
                <textarea
                  ref={jsonRef}
                  className="explore-input explore-textarea explore-mono composer-json"
                  value={jsonText}
                  onChange={(e) => updateJson(e.target.value)}
                  spellCheck={false}
                  aria-label="Record JSON"
                  placeholder={'{\n  "$type": "com.example.record"\n}'}
                />
                {jsonError && (
                  <p className="composer-json-error">Not valid JSON yet: {jsonError}</p>
                )}
              </>
            )}

            {/* Findings with no field to sit under, so they aren't lost until
                review. In JSON mode that is all of them. */}
            {(editor === 'json' ? shownProblems : unattached).length > 0 && (
              <ul className="composer-problems">
                {(editor === 'json' ? shownProblems : unattached).map((problem, i) => (
                  <li key={i}>
                    <ProblemLine problem={problem} showField />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ====================================================== 3. review */}
        {step === 3 && (
          <>
            <section className="composer-panel">
              <PanelHeading>Where it goes</PanelHeading>
              <dl className="composer-dl">
                <div>
                  <dt>Repository</dt>
                  <dd>
                    <code>{repoLabel}</code>
                  </dd>
                </div>
                <div>
                  <dt>Collection</dt>
                  <dd>
                    <code>{nsid}</code>
                    <button
                      type="button"
                      className="composer-inline-action"
                      onClick={() => goTo(1)}
                    >
                      Change
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>
                    <label htmlFor={rkeyFieldId}>Record key</label>
                  </dt>
                  <dd style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
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
                      style={{ fontSize: '0.82rem', maxWidth: '22rem' }}
                    />
                    {keyProblem ? (
                      <ProblemLine problem={keyProblem} />
                    ) : (
                      <span className="composer-note">
                        {rkey.trim()
                          ? 'This exact key. Creating fails if a record already has it.'
                          : 'Left empty, your PDS mints a timestamp key.'}
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="composer-panel">
              <PanelHeading>
                Record
                <span className="composer-heading-actions">
                  <button
                    type="button"
                    className="composer-tool"
                    onClick={() => {
                      setMode('json');
                      goTo(2);
                    }}
                  >
                    <PencilLine size={12} aria-hidden /> Edit
                  </button>
                </span>
              </PanelHeading>
              <LinkifiedJson value={record} className="explore-json" />
            </section>

            {!isEmptyRecord(record) && (
              <section className="composer-panel">
                <PanelHeading>How it renders</PanelHeading>
                <div className="composer-preview">
                  <RecordPreview
                    record={{
                      uri: `at://${did || ''}/${nsid}/${rkey.trim() || 'new'}`,
                      cid: '',
                      value: record,
                    }}
                    collection={nsid}
                    handle={identity?.handle || did || ''}
                    rkey={rkey.trim() || 'new'}
                    pds={identity?.pds}
                    hideExplorerCtas
                  />
                </div>
              </section>
            )}

            <section className="composer-panel">
              <PanelHeading>Before you write</PanelHeading>

              <CheckSummary
                hasSchema={Boolean(schemaDoc)}
                errorCount={errorCount}
                warningCount={warningCount}
              />

              {problems.length > 0 && (
                <ul className="composer-problems">
                  {problems.map((problem, i) => (
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
            </section>
          </>
        )}

        {(stepError || writeError) && (
          <p role="alert" className="explore-error composer-alert">
            {stepError || writeError}
          </p>
        )}

        {/* ------------------------------------------------------- nav */}
        <div className="composer-nav">
          {step > 1 ? (
            <button
              type="button"
              className="composer-secondary"
              onClick={() => goTo((step - 1) as Step)}
              disabled={saving}
            >
              <ArrowLeft size={12} aria-hidden /> Back
            </button>
          ) : (
            <span />
          )}

          <span className="composer-nav-aside">
            {hasDraft && step === 2 && (
              <button type="button" className="composer-secondary is-quiet" onClick={discardDraft}>
                <Trash2 size={12} aria-hidden /> Discard draft
              </button>
            )}
            <span className="composer-note composer-shortcut">
              {step === 3 ? '⌘↵ writes' : '⌘↵ next'}
            </span>
          </span>

          {step < 3 ? (
            <button
              type="button"
              className="composer-write"
              onClick={() => goTo((step + 1) as Step)}
              disabled={step === 1 && !nsidValid}
            >
              {step === 1 ? 'Next: the record' : 'Next: review'}{' '}
              <ArrowRight size={13} aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              className="composer-write"
              onClick={() => void handleWrite()}
              disabled={saving || !agent}
            >
              {saving ? (
                <Loader2 size={13} className="explore-spin" aria-hidden />
              ) : (
                <Check size={13} aria-hidden />
              )}
              {saving ? 'Writing…' : 'Write record'}
            </button>
          )}
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
  return <h2 className="composer-panel-heading">{children}</h2>;
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
        ? 'Aturi has its own form for this lexicon: the common fields, not all of them. '
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
 * What choosing this collection commits you to, before you have.
 *
 * Three facts a person wants before pressing Next — how much there is to fill
 * in, how much of it is mandatory, and whether they get to name the record —
 * pulled up here so the first step isn't a bare field with a button under it.
 */
function LexiconGlance({
  state,
  lexicon,
  source,
}: {
  state: SchemaState;
  lexicon: Lexicon | null;
  source: 'aturi' | 'published' | null;
}) {
  if (state.status === 'loading' && !lexicon) return null;
  if (!lexicon) {
    return (
      <dl className="composer-dl">
        <div>
          <dt>Fields</dt>
          <dd>None known. You’ll write the record as JSON.</dd>
        </div>
        <div>
          <dt>Record key</dt>
          <dd>Yours to choose, or left to your PDS.</dd>
        </div>
      </dl>
    );
  }
  const required = lexicon.fields.filter((f) => f.required).length;
  return (
    <dl className="composer-dl">
      <div>
        <dt>Fields</dt>
        <dd>
          {lexicon.fields.length}
          {required ? `, ${required} required` : ', none required'}
          {source === 'aturi' ? ' (the common ones)' : ''}
        </dd>
      </div>
      <div>
        <dt>Record key</dt>
        <dd>
          {lexicon.rkeyMode === 'fixed' && lexicon.rkeyDefault
            ? `Always “${lexicon.rkeyDefault}” — one record of this kind per repo.`
            : lexicon.rkeyMode === 'fixed'
              ? 'Yours to choose.'
              : 'A timestamp, minted by your PDS.'}
        </dd>
      </div>
      {lexicon.summary && (
        <div>
          <dt>About</dt>
          <dd>{lexicon.summary}</dd>
        </div>
      )}
    </dl>
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
  hasSchema,
  errorCount,
  warningCount,
}: {
  hasSchema: boolean;
  errorCount: number;
  warningCount: number;
}) {
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
 * The JSON editor's three insertions — the values that are tedious to produce
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

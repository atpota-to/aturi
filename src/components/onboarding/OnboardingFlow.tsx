'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CloudOff,
  Compass,
  Globe,
  LogIn,
  RefreshCw,
  Telescope,
  TriangleAlert,
} from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { usePreferences, type FlushResult } from '@/components/PreferencesProvider';
import { useSessionProfile } from '@/components/useSessionProfile';
import ScopeSelector from '@/components/oauth/ScopeSelector';
import { useSignInFlow } from '@/components/oauth/useSignInFlow';
import { ColorSchemePicker, ThemePicker } from '@/components/account/AppearanceControls';
import { usePreferredClientsPublisher } from '@/components/account/usePreferredClientsPublisher';
import Toggle from '@/components/account/Toggle';
import { COLOR_SCHEMES } from '@/lib/colorScheme';
import { markOnboardingComplete, markOnboardingDismissed } from '@/utils/preferences';
import {
  answerFor,
  applyAnswer,
  setupQuestions,
  waypointDomain,
} from '@/utils/onboardingQuestions';
import { PREFERRED_CLIENTS_NSID } from '@/utils/preferredClients';
import { WAYPOINT_DESTINATIONS } from '@/utils/waypoints';
import ClientChoice from './ClientChoice';

/**
 * Guided setup. Optional, resumable, and skippable at every step.
 *
 * The middle of the flow is generated from the waypoint catalog: each
 * question covers one group of apps that render the same data, and an answer
 * writes `preferredClients` rules for the scopes that group owns (see
 * `onboardingQuestions.ts`). So this file describes the flow and nothing
 * about which apps exist.
 *
 * Answers are written as they are made rather than batched at the end, so
 * abandoning halfway keeps whatever was answered. For a signed-in user the
 * same preferences record syncs to their PDS; the closing step additionally
 * offers to publish the public declaration other Atmosphere apps can read.
 */

const QUESTIONS = setupQuestions();

type StepId = 'intro' | 'appearance' | 'finish' | (string & {});

const STEP_IDS: StepId[] = [
  'intro',
  ...QUESTIONS.map((q) => q.id),
  'appearance',
  'finish',
];

/** How many client questions there are. The palette step isn't one of them. */
const NUMBERED_STEPS = QUESTIONS.length;

function stepLabel(id: StepId): string {
  if (id === 'intro') return 'Start';
  if (id === 'appearance') return 'Palette';
  if (id === 'finish') return 'Done';
  return QUESTIONS.find((q) => q.id === id)?.shortLabel ?? String(id);
}

/**
 * The URL fragment is the flow's source of truth, so a step survives a
 * reload, a shared link, and (the reason it matters) the OAuth round trip,
 * which remembers path plus hash and drops the user back where they were.
 *
 * Read through `useSyncExternalStore` rather than mirrored into state: the
 * server has no URL to read, and this is the one shape that renders the
 * default on the server and the real step on the client without a mismatch
 * or a setState-in-effect. `replaceState` doesn't emit `hashchange`, so
 * navigation dispatches a synthetic event to close the loop, the same
 * pattern the theme and font-scale controls use.
 */
const STEP_EVENT = 'aturi:onboarding-step';

function subscribeStep(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  window.addEventListener(STEP_EVENT, onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener(STEP_EVENT, onChange);
  };
}

function getStepSnapshot(): StepId {
  const hash = window.location.hash.replace(/^#/, '');
  return (STEP_IDS as string[]).includes(hash) ? hash : 'intro';
}

function getStepServerSnapshot(): StepId {
  return 'intro';
}

/** Honour the reduce-motion setting for the scroll that follows each step. */
function prefersReducedMotion(): boolean {
  return document.documentElement.dataset.reduceMotion === 'true';
}

export default function OnboardingFlow() {
  const { prefs, update } = usePreferences();
  const { did } = useAtprotoSession();
  const profile = useSessionProfile(did);

  const stepId = useSyncExternalStore(
    subscribeStep,
    getStepSnapshot,
    getStepServerSnapshot,
  );
  const index = Math.max(0, STEP_IDS.indexOf(stepId));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedStep = useRef<StepId | null>(null);

  // Move focus to the new step's heading so the panel swap is announced and
  // keyboard users don't have to tab back through the rail. Skipped on first
  // render: stealing focus from a page the user just opened is hostile.
  useEffect(() => {
    if (lastFocusedStep.current === null) {
      lastFocusedStep.current = stepId;
      return;
    }
    if (lastFocusedStep.current === stepId) return;
    lastFocusedStep.current = stepId;
    headingRef.current?.focus();
  }, [stepId]);

  const goTo = useCallback((next: StepId) => {
    const url = new URL(window.location.href);
    url.hash = String(next);
    // `replaceState` rather than a push: the wizard's own Back button already
    // walks the steps, and stacking six history entries would make the
    // browser's Back button useless for leaving the page.
    window.history.replaceState(null, '', url.toString());
    window.dispatchEvent(new Event(STEP_EVENT));
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, []);

  const goNext = useCallback(
    () => goTo(STEP_IDS[Math.min(index + 1, STEP_IDS.length - 1)]),
    [goTo, index],
  );
  const goBack = useCallback(
    () => goTo(STEP_IDS[Math.max(index - 1, 0)]),
    [goTo, index],
  );

  const question = QUESTIONS.find((q) => q.id === stepId) ?? null;
  // Which questions already have an answer, for the rail's checkmarks. A step
  // you walked past without answering shouldn't claim to be done.
  const answeredIds = useMemo(
    () => new Set(QUESTIONS.filter((q) => answerFor(prefs, q)).map((q) => q.id)),
    [prefs],
  );

  return (
    <div className="onboarding">
      <ProgressRail
        current={index}
        answeredIds={answeredIds}
        onJump={(i) => goTo(STEP_IDS[i])}
      />

      <div className="onboarding-panel">
        {stepId === 'intro' && (
          <IntroStep
            headingRef={headingRef}
            signedIn={Boolean(did)}
            onStart={goNext}
            onSkip={() => update(markOnboardingDismissed)}
          />
        )}

        {question && (
          <div className="onboarding-step">
            <StepHead
              headingRef={headingRef}
              eyebrow={`Question ${index} of ${NUMBERED_STEPS}`}
              title={question.question}
              blurb={question.blurb}
            />
            <ClientChoice
              name={`setup-${question.id}`}
              label={question.question}
              options={question.options}
              selectedId={answerFor(prefs, question)}
              onSelect={(id) => update((p) => applyAnswer(p, question, id))}
              previewHandle={profile?.handle ?? null}
              previewDid={did}
            />
          </div>
        )}

        {stepId === 'appearance' && (
          <div className="onboarding-step">
            <StepHead
              headingRef={headingRef}
              eyebrow="Appearance"
              title="Pick a palette"
              blurb={`${COLOR_SCHEMES.length} palettes, each with a dark and a light variant. The palette follows your account; dark or light stays on this device.`}
            />
            <div className="onboarding-appearance">
              <ColorSchemePicker description="Applies as you click." />
              <ThemePicker />
            </div>
          </div>
        )}

        {stepId === 'finish' && <FinishStep headingRef={headingRef} />}
      </div>

      {stepId !== 'intro' && (
        <nav className="onboarding-actions" aria-label="Setup navigation">
          <button type="button" className="onboarding-btn is-quiet" onClick={goBack}>
            <ArrowLeft size={15} aria-hidden />
            Back
          </button>

          <span className="onboarding-actions-spacer" />

          {stepId === 'finish' ? (
            <Link href="/explore" className="onboarding-btn is-primary">
              <Telescope size={15} aria-hidden />
              Start exploring
            </Link>
          ) : (
            <button type="button" className="onboarding-btn is-primary" onClick={goNext}>
              {question && !answeredIds.has(question.id) ? 'Skip' : 'Continue'}
              <ArrowRight size={15} aria-hidden />
            </button>
          )}
        </nav>
      )}
    </div>
  );
}

function ProgressRail({
  current,
  answeredIds,
  onJump,
}: {
  current: number;
  answeredIds: Set<string>;
  onJump: (index: number) => void;
}) {
  return (
    <ol className="onboarding-rail">
      {STEP_IDS.map((id, i) => {
        const answered = answeredIds.has(String(id));
        const state = [
          i === current ? 'is-current' : '',
          answered ? 'is-answered' : '',
          i < current ? 'is-visited' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <li key={String(id)} className={`onboarding-rail-item ${state}`}>
            <button
              type="button"
              onClick={() => onJump(i)}
              aria-current={i === current ? 'step' : undefined}
            >
              <span className="onboarding-rail-dot" aria-hidden>
                {answered ? <Check size={11} /> : i + 1}
              </span>
              <span className="onboarding-rail-label">{stepLabel(id)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

type HeadingRef = React.RefObject<HTMLHeadingElement | null>;

function StepHead({
  headingRef,
  eyebrow,
  title,
  blurb,
}: {
  headingRef: HeadingRef;
  eyebrow: string;
  title: string;
  blurb: string;
}) {
  return (
    <header className="onboarding-head">
      <span className="onboarding-eyebrow">{eyebrow}</span>
      {/* tabIndex -1 so step changes can move focus here without adding a
          tab stop of their own. */}
      <h1 className="onboarding-title" ref={headingRef} tabIndex={-1}>
        {title}
      </h1>
      <p className="onboarding-blurb">{blurb}</p>
    </header>
  );
}

function IntroStep({
  headingRef,
  signedIn,
  onStart,
  onSkip,
}: {
  headingRef: HeadingRef;
  signedIn: boolean;
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="onboarding-step">
      <StepHead
        headingRef={headingRef}
        eyebrow="Optional setup"
        title="Which apps do you actually use?"
        blurb={`More than one app can render any atproto record, so every shared link answers "open this where?" on your behalf. Today it answers with whichever client the catalog lists first. ${QUESTIONS.length} questions and the answer is yours.`}
      />

      <ul className="onboarding-facts">
        <li>
          <strong>Skippable.</strong> Every question takes a pass as readily as
          an answer.
        </li>
        <li>
          <strong>Nothing gets hidden.</strong> Your pick leads the list; the
          apps you passed over stay underneath it.
        </li>
        <li>
          {signedIn ? (
            <>
              <strong>Stored in your repository</strong>, not this browser. The
              last step can also publish them as{' '}
              <code>{PREFERRED_CLIENTS_NSID}</code> for other Atmosphere apps to
              read.
            </>
          ) : (
            <>
              <strong>No account needed.</strong> Answers stay in this browser
              until you sign in at the last step.
            </>
          )}
        </li>
      </ul>

      <div className="onboarding-actions is-inline">
        <button type="button" className="onboarding-btn is-primary" onClick={onStart}>
          <Compass size={15} aria-hidden />
          Get started
        </button>
        <Link href="/" className="onboarding-btn is-quiet" onClick={onSkip}>
          No thanks
        </Link>
      </div>
    </div>
  );
}

/**
 * Closing step: confirm what was chosen, get it somewhere durable, and offer
 * the one thing that makes these answers useful outside Aturi, which is
 * publishing them where other apps can read them.
 */
function FinishStep({ headingRef }: { headingRef: HeadingRef }) {
  const { prefs, update, flush } = usePreferences();
  const { did } = useAtprotoSession();
  const profile = useSessionProfile(did);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | FlushResult>('idle');
  const completedRef = useRef(false);

  // Reaching this step means the work is done: every answer is already
  // persisted. Record completion here rather than behind a final button, so
  // closing the tab at the finish line doesn't leave the invitation nagging.
  useEffect(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    update(markOnboardingComplete);
  }, [update]);

  // Retry path. An event handler, so it can announce 'saving' up front.
  const save = useCallback(async () => {
    setSaveState('saving');
    setSaveState(await flush());
  }, [flush]);

  // Push to the PDS on arrival, so the confirmation below reports a finished
  // write rather than an intention. The result lands in state from the
  // promise callback rather than synchronously in the effect body; until it
  // resolves, the initial `idle` already renders as "writing".
  const savedForDid = useRef<string | null>(null);
  useEffect(() => {
    if (!did || savedForDid.current === did) return;
    savedForDid.current = did;
    let cancelled = false;
    void flush().then((result) => {
      if (!cancelled) setSaveState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [did, flush]);

  const summary = useMemo(
    () =>
      QUESTIONS.map((q) => {
        const id = answerFor(prefs, q);
        return { question: q, waypoint: id ? WAYPOINT_DESTINATIONS[id] : null };
      }),
    [prefs],
  );
  const answered = summary.filter((s) => s.waypoint).length;

  return (
    <div className="onboarding-step">
      <StepHead
        headingRef={headingRef}
        eyebrow="Done"
        title={answered > 0 ? 'What you picked' : 'Nothing set'}
        blurb={
          answered > 0
            ? 'These go first wherever a record could open in more than one place.'
            : 'The picker keeps its own recommendations. Settings has these choices whenever you want them.'
        }
      />

      {answered > 0 && (
        <ul className="onboarding-summary">
          {summary.map(({ question, waypoint }) => (
            <li key={question.id}>
              <span className="onboarding-summary-scope">{question.shortLabel}</span>
              {waypoint ? (
                <span className="onboarding-summary-pick">
                  <span className="onboarding-summary-icon" aria-hidden>
                    {waypoint.icon}
                  </span>
                  {waypoint.name}
                  {waypointDomain(waypoint) && (
                    <span className="onboarding-summary-domain">
                      {waypointDomain(waypoint)}
                    </span>
                  )}
                </span>
              ) : (
                <span className="onboarding-summary-pick is-empty">no preference</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {did ? (
        <>
          <SaveStatus state={saveState} handle={profile?.handle ?? did} onRetry={save} />
          {answered > 0 && <PublishOffer actor={profile?.handle ?? did} />}
        </>
      ) : (
        <SignInOffer />
      )}

      <p className="onboarding-footnote">
        <Link href="/account#clients">Settings → Clients</Link> holds the same
        rules, plus per-lexicon scopes and fallbacks. The browser extension
        keeps its own separate redirect settings.
      </p>
    </div>
  );
}

function SaveStatus({
  state,
  handle,
  onRetry,
}: {
  state: 'idle' | 'saving' | FlushResult;
  handle: string;
  onRetry: () => void;
}) {
  if (state === 'error') {
    return (
      <div className="onboarding-status is-error" role="status">
        <TriangleAlert size={16} aria-hidden />
        <span>
          Couldn&apos;t reach your PDS. Your answers are saved in this browser,
          and the next setting you change will push them up.
        </span>
        <button type="button" className="onboarding-btn is-quiet" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden />
          Try again
        </button>
      </div>
    );
  }

  if (state === 'saved') {
    return (
      <div className="onboarding-status is-ok" role="status">
        <Check size={16} aria-hidden />
        <span>
          Saved to <strong>{handle}</strong>. Your preferences live in your
          repository, so they move with the account.
        </span>
      </div>
    );
  }

  return (
    <div className="onboarding-status" role="status">
      <RefreshCw size={16} aria-hidden className="onboarding-spin" />
      <span>Writing to your PDS…</span>
    </div>
  );
}

/**
 * The step that makes these answers portable. Settings sync privately by
 * default; this writes a separate record other people's software can read, so
 * it is an explicit opt-in with the consequence stated, not a checkbox that
 * arrives pre-ticked.
 */
function PublishOffer({ actor }: { actor: string }) {
  const { prefs } = usePreferences();
  const { state, error, setPublishing } = usePreferredClientsPublisher();
  const published = prefs.publishPreferredClients;
  const recordUri = `at://${actor}/${PREFERRED_CLIENTS_NSID}/self`;

  return (
    <div className="onboarding-publish">
      <Toggle
        id="onboarding-publish"
        label="Let other apps read these choices"
        description={`Writes a public ${PREFERRED_CLIENTS_NSID} record. Any app that links to atproto records can read it and send you to the client you picked, and so can anyone who knows your handle. Switching this off deletes it.`}
        checked={published}
        onChange={setPublishing}
      />

      {published && (
        <p className="onboarding-publish-state" role="status">
          {state === 'published' && (
            <>
              <Globe size={13} aria-hidden />
              <span>Published.</span>
              <Link href={`/explore/${actor}/${PREFERRED_CLIENTS_NSID}/self`}>
                Read it back
              </Link>
              <code>{recordUri}</code>
            </>
          )}
          {(state === 'publishing' || state === 'checking') && <span>Publishing…</span>}
          {state === 'removing' && <span>Deleting the published record…</span>}
          {state === 'empty' && <span>Nothing to publish. Answer a question first.</span>}
          {state === 'error' && (
            <span className="is-error">{error ?? 'Publishing failed.'}</span>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * The signed-out close. Signing in isn't required to have finished setup, as
 * the answers are already in this browser's storage, so this states what an
 * account adds rather than blocking on it.
 */
function SignInOffer() {
  const [value, setValue] = useState('');
  const { step, pendingAccount, busy, error, proceedToScopes, backToHandle, submitScopes } =
    useSignInFlow();

  if (step === 'scopes') {
    return (
      <div className="onboarding-signin">
        <ScopeSelector
          account={pendingAccount}
          busy={busy}
          error={error}
          onBack={backToHandle}
          onContinue={submitScopes}
        />
      </div>
    );
  }

  return (
    <div className="onboarding-signin">
      <div className="onboarding-signin-head">
        <CloudOff size={16} aria-hidden />
        <div>
          <strong>Saved in this browser</strong>
          <p>
            Sign in and they move to your repository, where your phone and your
            next laptop will find them. atproto OAuth: no password, and you
            pick the permissions on the next screen.
          </p>
        </div>
      </div>

      <form
        className="onboarding-signin-form"
        onSubmit={(e) => {
          e.preventDefault();
          proceedToScopes(value);
        }}
      >
        <input
          type="text"
          autoComplete="username"
          spellCheck={false}
          placeholder="handle or DID"
          aria-label="Your handle or DID"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="onboarding-btn is-primary" disabled={!value.trim()}>
          <LogIn size={15} aria-hidden />
          Sign in and save
        </button>
      </form>
      {error && <p className="onboarding-signin-error">{error}</p>}
    </div>
  );
}

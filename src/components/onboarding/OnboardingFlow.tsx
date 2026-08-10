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
 * `onboardingQuestions.ts`). That means this file describes the *flow* and
 * nothing about which apps exist.
 *
 * Answers are written as they're made rather than batched at the end, so
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

/** Steps that ask the user for something — intro and finish don't. */
const NUMBERED_STEPS = STEP_IDS.length - 2;

function stepLabel(id: StepId): string {
  if (id === 'intro') return 'Start';
  if (id === 'appearance') return 'Look';
  if (id === 'finish') return 'Save';
  return QUESTIONS.find((q) => q.id === id)?.shortLabel ?? String(id);
}

/**
 * The URL fragment is the flow's source of truth, so a step survives a
 * reload, a shared link, and — the reason it matters — the OAuth round trip,
 * which remembers path + hash and drops the user back where they were.
 *
 * Read through `useSyncExternalStore` rather than mirrored into state: the
 * server has no URL to read, and this is the one shape that renders the
 * default on the server and the real step on the client without a mismatch
 * or a setState-in-effect. `replaceState` doesn't emit `hashchange`, so
 * navigation dispatches a synthetic event to close the loop — the same
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

  const goTo = useCallback((next: StepId) => {
    const url = new URL(window.location.href);
    url.hash = String(next);
    // `replaceState` rather than a push: the wizard's Back button already
    // walks the steps, and stacking six history entries would make the
    // browser's Back button useless for leaving the page.
    window.history.replaceState(null, '', url.toString());
    window.dispatchEvent(new Event(STEP_EVENT));
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  return (
    <div className="onboarding">
      <ProgressRail current={index} onJump={(i) => goTo(STEP_IDS[i])} />

      <div className="onboarding-panel">
        {stepId === 'intro' && (
          <IntroStep
            signedIn={Boolean(did)}
            onStart={goNext}
            onSkip={() => update(markOnboardingDismissed)}
          />
        )}

        {question && (
          <div className="onboarding-step">
            <StepHead
              eyebrow={`Question ${index} of ${NUMBERED_STEPS}`}
              title={question.question}
              blurb={question.blurb}
            />
            <ClientChoice
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
              eyebrow={`Question ${index} of ${NUMBERED_STEPS}`}
              title="Make it yours"
              blurb="Aturi ships several palettes, each with a dark and a light variant. The palette travels with the rest of your preferences; dark-vs-light stays on this device, so a bright office and a dim couch can disagree."
            />
            <div className="onboarding-appearance">
              <ColorSchemePicker description="Applies as you click — try a few." />
              <ThemePicker />
            </div>
          </div>
        )}

        {stepId === 'finish' && <FinishStep />}
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
              Continue
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
  onJump,
}: {
  current: number;
  onJump: (index: number) => void;
}) {
  return (
    <ol className="onboarding-rail">
      {STEP_IDS.map((id, i) => {
        const state = i === current ? 'is-current' : i < current ? 'is-done' : '';
        return (
          <li key={String(id)} className={`onboarding-rail-item ${state}`}>
            <button
              type="button"
              onClick={() => onJump(i)}
              aria-current={i === current ? 'step' : undefined}
            >
              <span className="onboarding-rail-dot" aria-hidden>
                {i < current ? <Check size={11} /> : i + 1}
              </span>
              <span className="onboarding-rail-label">{stepLabel(id)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepHead({
  eyebrow,
  title,
  blurb,
}: {
  eyebrow: string;
  title: string;
  blurb: string;
}) {
  return (
    <header className="onboarding-head">
      <span className="onboarding-eyebrow">{eyebrow}</span>
      <h1 className="onboarding-title">{title}</h1>
      <p className="onboarding-blurb">{blurb}</p>
    </header>
  );
}

function IntroStep({
  signedIn,
  onStart,
  onSkip,
}: {
  signedIn: boolean;
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="onboarding-step">
      <StepHead
        eyebrow="Optional setup"
        title="Which apps do you actually use?"
        blurb="On atproto your posts, articles, and photos are records in your own repository, and any number of apps can render the same record. That's the good part — but it means every shared link has to guess where you want to open it, and the ecosystem's guess is whichever app got there first. Answer that here instead and the guessing stops."
      />

      <ul className="onboarding-facts">
        <li>
          <strong>{QUESTIONS.length} questions.</strong> One per group of apps
          that render the same kind of record. Skip any of them.
        </li>
        <li>
          <strong>Not a filter.</strong> Your answer leads the list; every other
          app stays right underneath it. Nothing gets hidden and nothing locks.
        </li>
        <li>
          {signedIn ? (
            <>
              <strong>Stored in your repository.</strong> Answers are saved to
              your own PDS, so they follow your account rather than this
              browser. At the end you can also publish them as a{' '}
              <code>{PREFERRED_CLIENTS_NSID}</code> record, which any other
              Atmosphere app can read to route you the same way.
            </>
          ) : (
            <>
              <strong>No account needed.</strong> Answers are saved in this
              browser. Sign in at the end and they move to your own repository
              instead, where other Atmosphere apps can read them too.
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
          Not now
        </Link>
      </div>
    </div>
  );
}

/**
 * Closing step: confirm what was chosen, get it somewhere durable, and offer
 * the one thing that makes these answers useful outside Aturi — publishing
 * them where other apps can read them.
 */
function FinishStep() {
  const { prefs, update, flush } = usePreferences();
  const { did } = useAtprotoSession();
  const profile = useSessionProfile(did);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | FlushResult>('idle');
  const completedRef = useRef(false);

  // Reaching this step means the work is done — every answer is already
  // persisted. Record completion here rather than behind a final button, so
  // closing the tab at the finish line doesn't leave the invitation nagging.
  useEffect(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    update(markOnboardingComplete);
  }, [update]);

  // Retry path — an event handler, so it can announce 'saving' up front.
  const save = useCallback(async () => {
    setSaveState('saving');
    setSaveState(await flush());
  }, [flush]);

  // Push to the PDS on arrival, so the confirmation below reports a finished
  // write rather than an intention. The result lands in state from the
  // promise callback rather than synchronously in the effect body; until it
  // resolves, the initial `idle` already renders as "writing…".
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
        eyebrow="Done"
        title={answered > 0 ? 'Here’s what you picked' : 'All set'}
        blurb={
          answered > 0
            ? 'These lead the list whenever a record could open in more than one place — on shared aturi.to links, in the picker, and anywhere else that reads your preferences.'
            : 'You skipped every question, which is a perfectly good answer. Aturi will keep offering its own recommendations, and Settings is there whenever you change your mind.'
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
        Change any of this any time in{' '}
        <Link href="/account#clients">Settings → Clients</Link>, where you can
        also add rules for specific lexicons and set fallbacks. Running the
        browser extension? Its redirect favorites are separate, under the
        extension&apos;s own options.
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
      <div className="onboarding-status is-error">
        <TriangleAlert size={16} aria-hidden />
        <span>
          Couldn&apos;t reach your PDS just now. Your answers are safe in this
          browser and Aturi will keep retrying — or push them up again now.
        </span>
        <button type="button" className="onboarding-btn is-quiet" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden />
          Retry
        </button>
      </div>
    );
  }

  if (state === 'saved') {
    return (
      <div className="onboarding-status is-ok">
        <Check size={16} aria-hidden />
        <span>
          Saved to <strong>{handle}</strong>. Your settings live in your own
          repository, so they travel with the account rather than the browser.
        </span>
      </div>
    );
  }

  return (
    <div className="onboarding-status">
      <RefreshCw size={16} aria-hidden className="onboarding-spin" />
      <span>Writing your preferences to your PDS…</span>
    </div>
  );
}

/**
 * The step that makes these answers portable. Settings sync privately by
 * default; this writes a separate, public record other people's software can
 * read — so it's an explicit opt-in with the consequences said plainly, not a
 * checkbox that comes pre-ticked.
 */
function PublishOffer({ actor }: { actor: string }) {
  const { prefs } = usePreferences();
  const { state, error, setPublishing } = usePreferredClientsPublisher();
  const published = prefs.publishPreferredClients;

  return (
    <div className="onboarding-publish">
      <Toggle
        id="onboarding-publish"
        label="Let other Atmosphere apps read these choices"
        description={`Publishes a public ${PREFERRED_CLIENTS_NSID} record in your repository. Any app that links out to atproto records can read it and send you to the client you picked instead of guessing. It's a public record — anyone can see which apps you prefer. Turning it back off deletes the record.`}
        checked={published}
        onChange={setPublishing}
      />

      {published && (
        <p className="onboarding-publish-state">
          {state === 'published' && (
            <>
              <Globe size={13} aria-hidden /> Published at{' '}
              <code>{`at://${actor}/${PREFERRED_CLIENTS_NSID}/self`}</code>.
            </>
          )}
          {(state === 'publishing' || state === 'checking') && <>Publishing…</>}
          {state === 'removing' && <>Removing the published record…</>}
          {state === 'empty' && (
            <>Nothing to publish yet — answer a question above first.</>
          )}
          {state === 'error' && (
            <span className="is-error">{error ?? 'Publishing failed.'}</span>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * The signed-out close. Signing in isn't required to have finished setup —
 * the answers are already in localStorage — so this sells the upgrade rather
 * than blocking on it.
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
            Sign in with your handle and the same answers go to your own
            repository instead — there on your phone, on a new laptop, and
            available to any other Atmosphere app you let read them. No
            password: atproto OAuth, and you choose which permissions to grant
            on the next screen.
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
          Sign in &amp; save
        </button>
      </form>
      {error && <p className="onboarding-signin-error">{error}</p>}
    </div>
  );
}

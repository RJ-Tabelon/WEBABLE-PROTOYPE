'use client';

import {
  analyzeLadder,
  isLargePrint,
  ringInputOf,
  type DeviceContext,
  type FitProfile,
} from '@webable/core';
import { fitUiVars } from '@webable/core/profile/describe';
import { Actions, Button, ProgressRuler, Sheet } from '@webable/ui';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { TaskShell } from '../shell/TaskShell';
import {
  applyFitUi,
  readFitUi,
  writeFitUi,
  type FitUiState,
} from '../shell/fit-ui';
import { YourFit, type SaveState } from './fit/YourFit';
import {
  browserDefaultFontPx,
  deviceContextFrom,
  guessInput,
  probeEnvironment,
} from './flow/device';
import {
  initialTuneState,
  moduleMeasured,
  progressOf,
  stashOf,
  summarizePointingDraft,
  summarizeReadingDraft,
  tuneReducer,
  type TuneAction,
  type TuneStash,
  type TuneState,
} from './flow/machine';
import {
  abandonSession,
  persistFit,
  type TuneServerActions,
} from './flow/persist';
import { deriveProfile } from './flow/record';
import {
  MODULE_LABEL,
  MODULE_TASKS,
  MODULES,
  STEP_INFO,
  isStepActive,
  stepsOfModule,
  type ModuleId,
  type Setup,
} from './flow/steps';
import {
  clearProgress,
  readProgress,
  writePendingFit,
  writeProgress,
} from './flow/storage';
import { Chips, FindText, NextAction, Preferences } from './focus/Tasks';
import { Search } from './focus/Search';
import {
  planFindText,
  planNextAction,
  planPairs,
  planSearch,
} from './focus/plan';
import { Drag } from './pointing/Drag';
import { Hold } from './pointing/Hold';
import { PointingPreview } from './pointing/PointingPreview';
import { ReturnBlock, Ring, Warmup } from './pointing/RingScreens';
import { Comfort } from './reading/Comfort';
import { Contrast } from './reading/Contrast';
import {
  comfortStartPx,
  fontPxFromLogX,
  measureStimulusFont,
  tuneChromeScale,
  type StimulusMetrics,
} from './reading/geometry';
import { Ladder } from './reading/Ladder';
import { Polarity } from './reading/Polarity';
import { ReadingPreview } from './reading/ReadingPreview';
import {
  Intro,
  KeyboardPointing,
  Resume,
  SavedForLater,
  SavedLocally,
  SavedSignedIn,
  ScreenReaderRoute,
  SIGN_IN_TO_SAVE,
} from './screens';
import { Deck, Rest } from './shared/primitives';

export type { TuneServerActions } from './flow/persist';

export interface TuneFlowProps {
  /** Present when signed in; the fit is then saved to the account. */
  actions: TuneServerActions | null;
  /** /tune?recalibrate=1 and a current fit exists. */
  previous: FitProfile | null;
  previousDate: string | null;
  /** Seed for tests; defaults to a random value per Tune. */
  seed?: number;
}

const RULER_SECTIONS = MODULES.map((id) => ({
  id,
  label: MODULE_LABEL[id],
  tasks: MODULE_TASKS[id],
}));

function randomSeed(): number {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] ?? 1;
  } catch {
    return Math.floor(Math.random() * 2 ** 31);
  }
}

function now(): number {
  return performance.now();
}

/** "about 2 minutes" for one module, from its active screens. */
function moduleMinutes(module: ModuleId, setup: Setup | null): number {
  const ctx = {
    setup,
    express: false,
    pointingElapsedSec: null,
    hasStash: false,
  };
  const seconds = stepsOfModule(module)
    .filter((s) => isStepActive(s, ctx))
    .reduce((sum, s) => sum + STEP_INFO[s].estimateSec, 0);
  return Math.max(1, Math.round(seconds / 60));
}

function minutesWord(n: number): string {
  return `about ${n} ${n === 1 ? 'minute' : 'minutes'}`;
}

function dateLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The whole Tune flow on one client component: the reducer decides screens,
 * each screen reports what happened, and the fit is derived, adjusted and
 * saved at the end. Raw trials live only in this component's memory.
 */
export function TuneFlow({
  actions,
  previous,
  previousDate,
  seed: seedProp,
}: TuneFlowProps) {
  const [state, dispatch] = useReducer(tuneReducer, undefined, () =>
    initialTuneState(),
  );
  const [rootFontPx, setRootFontPx] = useState(16);
  const [defaultInput, setDefaultInput] = useState<Setup['input']>('mouse');
  const [stash, setStash] = useState<
    (TuneStash & { savedOn: string | null }) | null
  >(null);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [leftForLater, setLeftForLater] = useState(false);
  const device = useRef<DeviceContext | null>(null);
  const metrics = useRef<StimulusMetrics>({
    xHeightRatio: 0.52,
    advanceEm: 0.5,
  });
  const seedRef = useRef<number>(seedProp ?? 1);
  const storedUi = useRef<FitUiState | null>(null);
  const committedUi = useRef(false);
  /** The account's calibration session, opened when Tune begins (signed in only). */
  const session = useRef<Promise<string | null> | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const recalibrating = previous !== null;

  // Browser-only facts, read after the first render so server and client agree.
  useEffect(() => {
    const probe = probeEnvironment();
    setRootFontPx(browserDefaultFontPx());
    setDefaultInput(guessInput(probe));
    storedUi.current = readFitUi();
    if (seedProp === undefined) seedRef.current = randomSeed();
    const saved = readProgress();
    if (saved) {
      setStash({ ...saved, savedOn: dateLabel(saved.startedAt) });
      dispatch({ type: 'stashFound' });
    }
    return () => {
      // Leaving Tune without choosing a fit puts WebAble's own look back.
      if (!committedUi.current) applyFitUi(readFitUi());
      // A session opened for a Tune that was left unfinished is closed as abandoned.
      if (actionsRef.current && session.current) {
        void abandonSession(actionsRef.current, session.current);
        session.current = null;
      }
    };
  }, [seedProp]);

  const send = useCallback((action: TuneAction) => dispatch(action), []);
  const step = state.step;
  const setup = state.setup;
  const active = !state.paused;
  const epoch = state.pauseEpoch;

  // The chrome wears the chosen reading size from the first screen on (design-final §9.2).
  const comfortPx =
    state.reading.comfortPx ?? state.summaries.reading?.comfortPx ?? null;
  useEffect(() => {
    if (comfortPx === null || committedUi.current) return;
    const base = storedUi.current ?? { v: 1 as const, vars: {} };
    const scale = tuneChromeScale(comfortPx, rootFontPx);
    applyFitUi({
      ...base,
      vars: { ...base.vars, '--wa-text-scale': String(scale) },
    });
  }, [comfortPx, rootFontPx]);

  const captureDevice = (
    input: Setup['input'],
  ): { reducedMotion: boolean; forcedColors: boolean } => {
    const probe = probeEnvironment();
    device.current = deviceContextFrom(probe, input);
    metrics.current = measureStimulusFont();
    return {
      reducedMotion: probe.reducedMotion,
      forcedColors: probe.forcedColors,
    };
  };

  /** Best effort; a session that fails to open is opened again when the fit is saved. */
  const openSession = () => {
    if (!actions || !device.current) return;
    const previousSession = session.current;
    if (previousSession) void abandonSession(actions, previousSession);
    session.current = actions
      .startCalibrationSession({ device: device.current })
      .then((result) => (result.ok ? result.data.id : null))
      .catch(() => null);
  };

  const begin = (choice: Pick<Setup, 'input' | 'assistive'>) => {
    const env = captureDevice(choice.input);
    clearProgress();
    openSession();
    send({
      type: 'begin',
      setup: { ...choice, ...env, recalibrate: recalibrating },
      startedAt: new Date().toISOString(),
      rootFontPx,
      now: now(),
    });
  };

  const resume = () => {
    if (!stash) return;
    const env = captureDevice(stash.setup.input);
    openSession();
    send({
      type: 'restore',
      stash: { ...stash, setup: { ...stash.setup, ...env } },
      rootFontPx,
      now: now(),
    });
  };

  const restart = () => {
    clearProgress();
    setStash(null);
    send({ type: 'restart' });
  };

  /* ---------- Per-Tune plans and derived sizes ---------- */

  const seed = seedRef.current;
  const reducedMotion = setup?.reducedMotion ?? false;
  const plans = useMemo(
    () => ({
      search: planSearch(seed, reducedMotion),
      next: planNextAction(seed),
      text: planFindText(seed),
      pairs: planPairs(seed),
    }),
    [seed, reducedMotion],
  );

  const ratio = state.reading.referenceXHeightRatio;
  const ladder = useMemo(
    () =>
      analyzeLadder(state.reading.ladder, {
        referenceXHeightRatio: ratio,
        comfortPx: state.reading.comfortPx,
      }),
    [state.reading.ladder, state.reading.comfortPx, ratio],
  );
  const cpsPx =
    ladder.xCps !== null ? fontPxFromLogX(ladder.xCps, ratio) : null;
  const readingComfort = state.reading.comfortPx ?? comfortStartPx(rootFontPx);
  const largePrint = isLargePrint(state.reading.comfortPx, rootFontPx);

  const provisional = useMemo(() => {
    if (!device.current || !state.startedAt) return null;
    const reading =
      step === 'reading.preview'
        ? summarizeReadingDraft(state.reading, rootFontPx, 0)
        : state.summaries.reading;
    return deriveProfile({
      device: device.current,
      modules: { ...(reading ? { reading } : {}) },
      startedAt: state.startedAt,
      completedAt: state.startedAt,
    }).profile;
  }, [
    step,
    state.reading,
    state.summaries.reading,
    state.startedAt,
    rootFontPx,
  ]);

  const mockBasePx = Math.round(
    Math.min(22, Math.max(16, provisional?.vision.textMinPx.value ?? 16)),
  );

  const predictedMoveMs = useMemo(() => {
    const blocks = state.summaries.pointing?.blocks ?? [];
    if (blocks.length === 0) return 0;
    const nearest = blocks.reduce((a, b) =>
      Math.abs(b.targetPx - 44) < Math.abs(a.targetPx - 44) ? b : a,
    );
    return nearest.medianMoveMs;
  }, [state.summaries.pointing]);

  /* ---------- Your fit ---------- */

  const [finished, setFinished] = useState<{
    profile: FitProfile;
    record: ReturnType<typeof deriveProfile>['record'];
  } | null>(null);
  useEffect(() => {
    if (step !== 'fit' || finished || !device.current || !state.startedAt)
      return;
    const completedAt = new Date().toISOString();
    setFinished(
      deriveProfile({
        device: device.current,
        modules: state.summaries,
        startedAt: state.startedAt,
        completedAt,
        previous,
      }),
    );
  }, [step, finished, state.summaries, state.startedAt, previous]);

  const chooseFit = async (profile: FitProfile) => {
    if (!finished || save.kind === 'saving') return;
    // WebAble's own UI wears the fit at once (design-final §2.3).
    const ui = fitUiVars(profile);
    writeFitUi({
      vars: ui.style,
      ...(ui.attributes['data-wa-motion'] === 'reduce'
        ? { motion: 'reduce' as const }
        : {}),
    });
    committedUi.current = true;
    const source = recalibrating ? 'recalibration' : 'calibration';

    if (!actions) {
      // Signed out: the fit waits in this browser until /tune/save stores it.
      writePendingFit({ profile, record: finished.record, source });
      clearProgress();
      send({ type: 'saved' });
      return;
    }

    setSave({ kind: 'saving' });
    const outcome = await persistFit(actions, {
      profile,
      record: finished.record,
      source,
      sessionId: session.current ? await session.current : null,
    });
    if (outcome.kind === 'signed-out') {
      // The session ended during Tune: keep the fit here and sign in again.
      writePendingFit({ profile, record: finished.record, source });
      clearProgress();
      window.location.assign(SIGN_IN_TO_SAVE);
      return;
    }
    if (outcome.kind === 'error') {
      setSave({ kind: 'error', message: outcome.message });
      return;
    }
    session.current = null;
    clearProgress();
    setSave({ kind: 'idle' });
    send({ type: 'saved' });
  };

  /* ---------- Pause and skip ---------- */

  const pause = () => send({ type: 'pause' });
  const finishLater = () => {
    const kept = stashOf(state, now());
    if (kept) writeProgress(kept);
    if (actions) void abandonSession(actions, session.current);
    session.current = null;
    // Close the sheet first: the dialog hands focus back as it closes, and the
    // next screen's heading must take focus after that, not before.
    send({ type: 'unpause' });
    window.setTimeout(() => setLeftForLater(true), 0);
  };
  const skip = () => send({ type: 'skipPart', step, now: now() });

  /* ---------- Screens ---------- */

  const progress = progressOf(state, now());
  const input = setup?.input ?? 'mouse';
  const ringInput = ringInputOf(input);

  let screen: ReactNode = null;
  switch (step) {
    case 'intro':
      screen = (
        <Intro
          key={defaultInput}
          defaultInput={defaultInput}
          recalibrate={recalibrating}
          onBegin={begin}
        />
      );
      break;
    case 'resume':
      screen = stash ? (
        <Resume
          module={stash.resumeModule}
          savedOn={stash.savedOn}
          onContinue={resume}
          onRestart={restart}
        />
      ) : null;
      break;
    case 'sr-route':
      screen = (
        <ScreenReaderRoute
          onContinue={() => send({ type: 'continue', step, now: now() })}
        />
      );
      break;
    case 'reading.comfort':
      screen = (
        <Comfort
          rootFontPx={rootFontPx}
          metrics={metrics.current}
          active={active}
          onDone={(px) =>
            send({
              type: 'reading/comfort',
              step,
              comfortPx: px,
              referenceXHeightRatio: metrics.current.xHeightRatio,
              now: now(),
            })
          }
        />
      );
      break;
    case 'reading.ladder':
      screen = (
        <Ladder
          comfortPx={readingComfort}
          metrics={metrics.current}
          largePrint={largePrint}
          seed={seed}
          active={active}
          epoch={epoch}
          onDone={(trials, displayLimited) =>
            send({
              type: 'reading/ladder',
              step,
              trials,
              displayLimited,
              now: now(),
            })
          }
        />
      );
      break;
    case 'reading.contrast':
      screen = (
        <Contrast
          targetPx={2 * (cpsPx ?? readingComfort / 2)}
          advanceEm={metrics.current.advanceEm}
          largePrint={largePrint}
          seed={seed}
          active={active}
          onDone={(trials) =>
            send({ type: 'reading/contrast', step, trials, now: now() })
          }
        />
      );
      break;
    case 'reading.polarity':
      screen = (
        <Polarity
          targetPx={cpsPx !== null ? cpsPx * 10 ** 0.1 : readingComfort}
          advanceEm={metrics.current.advanceEm}
          largePrint={largePrint}
          seed={seed}
          usedCount={state.reading.ladder.length}
          active={active}
          onDone={(trials, stated) =>
            send({ type: 'reading/polarity', step, trials, stated, now: now() })
          }
        />
      );
      break;
    case 'reading.preview':
      screen = provisional ? (
        <ReadingPreview
          vision={provisional.vision}
          rootFontPx={rootFontPx}
          onDone={(overrides) =>
            send({ type: 'reading/preview', step, overrides, now: now() })
          }
        />
      ) : null;
      break;
    case 'before.pointing':
      screen = (
        <Rest
          done={moduleMeasured(state, 'reading') ? 'Reading is done.' : null}
          title="Next, pointing."
          action={
            <Button
              variant="primary"
              size="task"
              arrow="forward"
              onClick={() => send({ type: 'continue', step, now: now() })}
            >
              Continue
            </Button>
          }
        >
          <Deck>
            Click a few circles at your own pace,{' '}
            {minutesWord(moduleMinutes('pointing', setup))}.
            {setup?.assistive === 'magnifier'
              ? ' Keep your magnifier the way you normally use it.'
              : ''}
            {comfortPx !== null && tuneChromeScale(comfortPx, rootFontPx) > 1
              ? ' The text here now uses your reading size.'
              : ''}
          </Deck>
        </Rest>
      );
      break;
    case 'pointing.keyboard':
      screen = (
        <KeyboardPointing
          readingDone={moduleMeasured(state, 'reading')}
          onContinue={() => send({ type: 'continue', step, now: now() })}
        />
      );
      break;
    case 'pointing.warmup':
      screen = (
        <Warmup
          input={ringInput}
          active={active}
          epoch={epoch}
          onSkip={skip}
          onDone={() => send({ type: 'continue', step, now: now() })}
        />
      );
      break;
    case 'pointing.ring':
      screen = (
        <Ring
          input={ringInput}
          active={active}
          epoch={epoch}
          onSkip={skip}
          onDone={(blocks, express) =>
            send({ type: 'pointing/ring', step, blocks, express, now: now() })
          }
        />
      );
      break;
    case 'pointing.hold':
      screen = (
        <Hold
          touch={ringInput === 'touch'}
          active={active}
          epoch={epoch}
          reducedMotion={reducedMotion}
          onSkip={skip}
          onDone={(holds) =>
            send({ type: 'pointing/hold', step, holds, now: now() })
          }
        />
      );
      break;
    case 'pointing.drag':
      screen = (
        <Drag
          touch={ringInput === 'touch'}
          active={active}
          epoch={epoch}
          onDone={(drags) =>
            send({ type: 'pointing/drag', step, drags, now: now() })
          }
        />
      );
      break;
    case 'pointing.return':
      screen = (
        <ReturnBlock
          input={ringInput}
          active={active}
          epoch={epoch}
          onSkip={skip}
          onDone={(block) =>
            send({ type: 'pointing/return', step, block, now: now() })
          }
        />
      );
      break;
    case 'pointing.preview':
      screen = (
        <PointingPreviewStep
          state={state}
          touch={ringInput === 'touch'}
          onDone={(chosenPx) =>
            send({ type: 'pointing/preview', step, chosenPx, now: now() })
          }
        />
      );
      break;
    case 'before.focus': {
      const screenReader = setup?.assistive === 'screen-reader';
      screen = (
        <Rest
          done={moduleMeasured(state, 'pointing') ? 'Pointing is done.' : null}
          title={
            screenReader ? 'One last question.' : 'Next, a few everyday pages.'
          }
          action={
            <Button
              variant="primary"
              size="task"
              arrow="forward"
              onClick={() => send({ type: 'continue', step, now: now() })}
            >
              {screenReader ? 'Continue' : 'Start'}
            </Button>
          }
        >
          <Deck>
            {screenReader
              ? 'It is about what gets in your way on web pages.'
              : `These tasks look at pages, not at you. Go at your normal pace, ${minutesWord(moduleMinutes('focus', setup))}.`}
            {!screenReader && reducedMotion
              ? ' You asked for less motion, so everything here stays still.'
              : ''}
            {!screenReader && !reducedMotion
              ? ' Some pages move; you can stop them at any time.'
              : ''}
          </Deck>
        </Rest>
      );
      break;
    }
    case 'focus.search':
      screen = (
        <Search
          plan={plans.search}
          predictedMoveMs={input === 'keyboard' ? 0 : predictedMoveMs}
          basePx={mockBasePx}
          active={active}
          epoch={epoch}
          onDone={(trials, motionShown, stopMotionPressed) =>
            send({
              type: 'focus/search',
              step,
              trials,
              motionShown,
              stopMotionPressed,
              now: now(),
            })
          }
        />
      );
      break;
    case 'focus.next':
      screen = (
        <NextAction
          plan={plans.next}
          basePx={mockBasePx}
          active={active}
          epoch={epoch}
          onDone={(trials) =>
            send({ type: 'focus/next', step, trials, now: now() })
          }
        />
      );
      break;
    case 'focus.text':
      screen = (
        <FindText
          plan={plans.text}
          choicesFirst={input === 'keyboard' || input === 'touch'}
          basePx={mockBasePx}
          active={active}
          epoch={epoch}
          onDone={(trials) =>
            send({ type: 'focus/text', step, trials, now: now() })
          }
        />
      );
      break;
    case 'focus.prefs':
      screen = (
        <Preferences
          pairs={plans.pairs}
          search={plans.search}
          next={plans.next}
          text={plans.text}
          reducedMotion={reducedMotion}
          onDone={(preferences) =>
            send({ type: 'focus/prefs', step, preferences, now: now() })
          }
        />
      );
      break;
    case 'focus.chips':
      screen = (
        <Chips
          screenReader={setup?.assistive === 'screen-reader'}
          onDone={(chips) =>
            send({ type: 'focus/chips', step, chips, now: now() })
          }
        />
      );
      break;
    case 'fit':
      screen = finished ? (
        <YourFit
          profile={finished.profile}
          previous={previous}
          previousDate={previousDate}
          rootFontPx={rootFontPx}
          signedIn={actions !== null}
          save={save}
          onUse={(p) => void chooseFit(p)}
        />
      ) : null;
      break;
    case 'done':
      screen = actions ? (
        <SavedSignedIn recalibration={recalibrating} />
      ) : (
        <SavedLocally />
      );
      break;
  }

  if (leftForLater) screen = <SavedForLater />;

  const hideActions = leftForLater || !STEP_INFO[step].actions;
  const progressText =
    step === 'intro' || step === 'resume'
      ? `3 parts · about 6 min`
      : (progress.text ?? undefined);
  const announcement =
    step === 'fit'
      ? 'All 3 parts done. Your fit is ready.'
      : step === 'done'
        ? 'Your fit is saved.'
        : (progress.text ?? '');

  return (
    <>
      <TaskShell
        ruler={
          <ProgressRuler
            sections={RULER_SECTIONS}
            current={progress.section}
            taskIndex={progress.taskIndex}
          />
        }
        progressText={leftForLater ? undefined : progressText}
        onPause={hideActions ? undefined : pause}
        onSkip={hideActions ? undefined : skip}
        hideActions={hideActions}
        idleKey={`${step}-${epoch}`}
        announcement={announcement}
      >
        <div className="tn-screen" data-step={step}>
          {screen}
        </div>
      </TaskShell>
      <Sheet
        open={state.paused}
        onOpenChange={(open) => {
          if (!open) send({ type: 'unpause' });
        }}
        title="Paused"
        description="Your answers so far are saved."
        closeLabel="Resume"
        actions={
          <Actions>
            <Button
              variant="primary"
              size="task"
              onClick={() => send({ type: 'unpause' })}
            >
              Resume
            </Button>
            <Button variant="secondary" size="task" onClick={finishLater}>
              Save and finish later
            </Button>
          </Actions>
        }
      />
    </>
  );
}

/** S6 needs S* from the ring: summarized once, when the screen opens. */
function PointingPreviewStep({
  state,
  touch,
  onDone,
}: {
  state: TuneState;
  touch: boolean;
  onDone: (chosenPx: number) => void;
}) {
  const { pointing, setup } = state;
  const recommended = useMemo(
    () =>
      summarizePointingDraft(pointing, setup?.input ?? 'mouse', 0)
        .recommendedPx,
    [pointing, setup],
  );
  return (
    <PointingPreview
      recommendedPx={recommended}
      touch={touch}
      onDone={onDone}
    />
  );
}

'use client';

import {
  analyzeLadder,
  isLargePrint,
  ringInputOf,
  type DeviceClass,
  type DeviceContext,
  type FitProfile,
} from '@webable/core';
import { fitRows, fitUiVars } from '@webable/core/profile/describe';
import type { FitRowId } from '@webable/core/profile/describe';
import { Actions, Button, ProgressRuler, Sheet } from '@webable/ui';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { nudgeExtension } from '../../lib/extension/bridge';
import { TaskShell } from '../shell/TaskShell';
import {
  applyFitUi,
  readFitUi,
  writeFitUi,
  type FitUiState,
} from '../shell/fit-ui';
import { YourFit, type SaveState, type YourFitControl } from './fit/YourFit';
import {
  browserDefaultFontPx,
  deviceClassOf,
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
  moduleOf,
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
import { FitLine, rowValue } from './shared/fit';
import { ScreenContext } from './shared/hooks';
import { Deck, loadStimulusFont, Rest } from './shared/primitives';

export type { TuneServerActions } from './flow/persist';

export interface TuneFlowProps {
  /** Present when signed in; the fit is then saved to the account. */
  actions: TuneServerActions | null;
  /**
   * The account's current fit, whenever there is one (signed in). Tune then
   * keeps what the person set, shows Keep new / Keep old, and saves the result
   * as a recalibration, whatever the entry point.
   */
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

const SKIP_LABEL: Readonly<Record<ModuleId, string>> = {
  reading: 'Skip reading',
  pointing: 'Skip pointing',
  focus: 'Skip focus',
};

/**
 * Skip and Continue are ignored this long after a screen changes, so a double
 * press on "Skip pointing" never also skips Focus.
 */
export const SCREEN_SETTLE_MS = 300;

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
  const [deviceClass, setDeviceClass] = useState<DeviceClass | null>(null);
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
  const screenRef = useRef<HTMLDivElement>(null);
  const fitControl = useRef<YourFitControl>(null);
  const recalibrating = previous !== null;

  // Browser-only facts, read after the first render so server and client agree.
  useEffect(() => {
    const probe = probeEnvironment();
    setRootFontPx(browserDefaultFontPx());
    setDefaultInput(guessInput(probe));
    setDeviceClass(deviceClassOf(probe));
    storedUi.current = readFitUi();
    if (seedProp === undefined) seedRef.current = randomSeed();
    const saved = readProgress();
    if (saved) {
      setStash({ ...saved, savedOn: dateLabel(saved.startedAt) });
      dispatch({ type: 'stashFound' });
    }
    // Load the stimulus face now; its metrics are measured once it is in.
    void loadStimulusFont().then(() => {
      metrics.current = measureStimulusFont();
    });
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
  const screenKey = leftForLater ? 'later' : step;

  // Skip and Continue wait out a short settle after every screen change.
  const screenAt = useRef(0);
  useLayoutEffect(() => {
    screenAt.current = performance.now();
    // A new screen starts at the top, like a new page (the bars pinned or not).
    const main = screenRef.current?.closest('main');
    if (main) main.scrollTop = 0;
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  }, [screenKey]);
  const settled = () =>
    performance.now() - screenAt.current >= SCREEN_SETTLE_MS;
  const next = () => {
    if (!settled()) return;
    send({ type: 'continue', step, now: now() });
  };

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
      stash: {
        ...stash,
        setup: { ...stash.setup, ...env, recalibrate: recalibrating },
      },
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

  /**
   * The rest screens' one real value from the part that just finished: the
   * fit so far, against what sites do on their own ("Text size 16 → 20 px").
   */
  const partSoFar = useMemo(() => {
    const rest =
      step === 'before.pointing' ||
      step === 'before.focus' ||
      step === 'pointing.keyboard';
    if (!rest || !device.current || !state.startedAt) return null;
    const { profile } = deriveProfile({
      device: device.current,
      modules: state.summaries,
      startedAt: state.startedAt,
      completedAt: state.startedAt,
    });
    return fitRows(profile, undefined, { browserDefaultPx: rootFontPx });
  }, [step, state.summaries, state.startedAt, rootFontPx]);

  const restFit = (module: ModuleId, id: FitRowId): ReactNode => {
    if (!moduleMeasured(state, module)) return null;
    const row = partSoFar?.find((r) => r.id === id);
    if (!row || !row.changesPages) return null;
    const value = rowValue(row);
    return value.kind === 'same' ? null : (
      <FitLine label={row.label} value={value} />
    );
  };

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

  const [chosen, setChosen] = useState<FitProfile | null>(null);
  const chooseFit = async (profile: FitProfile) => {
    if (!finished || save.kind === 'saving') return;
    setChosen(profile);
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
    // The extension in this browser picks the new fit up now, not at its next sync.
    void nudgeExtension();
    setSave({ kind: 'idle' });
    send({ type: 'saved' });
  };

  /** The chosen fit's rows, for the end screen's list of values. */
  const keptProfile = chosen ?? finished?.profile ?? null;
  const doneRows = useMemo(
    () =>
      keptProfile
        ? fitRows(keptProfile, undefined, { browserDefaultPx: rootFontPx })
        : [],
    [keptProfile, rootFontPx],
  );

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
  const skip = () => {
    if (!settled()) return;
    send({ type: 'skipPart', step, now: now() });
  };

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
          deviceClass={deviceClass}
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
      screen = <ScreenReaderRoute onContinue={next} />;
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
          fit={restFit('reading', 'textSize')}
          title="Next, pointing."
          action={
            <Button
              variant="primary"
              size="task"
              arrow="forward"
              onClick={next}
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
          fit={restFit('reading', 'textSize')}
          onContinue={next}
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
          fit={restFit('pointing', 'targets')}
          title={
            screenReader ? 'One last question.' : 'Next, a few everyday pages.'
          }
          action={
            <Button
              variant="primary"
              size="task"
              arrow="forward"
              onClick={next}
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
          onDone={(chips) => {
            if (!settled()) return;
            send({ type: 'focus/chips', step, chips, now: now() });
          }}
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
          controlRef={fitControl}
        />
      ) : null;
      break;
    case 'done':
      screen = actions ? <SavedSignedIn /> : <SavedLocally rows={doneRows} />;
      break;
  }

  if (leftForLater) screen = <SavedForLater />;

  /* ---------- The frame: ruler, progress line, action bar ---------- */

  const module = moduleOf(step);
  const taskScreen = !leftForLater && STEP_INFO[step].actions;
  const fitStep = !leftForLater && step === 'fit' && finished !== null;

  let ruler: ReactNode | false = (
    <ProgressRuler
      sections={RULER_SECTIONS}
      current={progress.section}
      taskIndex={progress.taskIndex}
    />
  );
  let progressFull: string | undefined = progress.text ?? undefined;
  let progressShort: string | undefined = progress.short ?? undefined;
  if (leftForLater || step === 'intro' || step === 'sr-route') {
    // The intro's list of parts is its ruler; the other two are not in a part.
    ruler = false;
    progressFull = undefined;
    progressShort = undefined;
  } else if (step === 'resume') {
    // The part the saved Tune picks up at.
    ruler = stash ? (
      <ProgressRuler
        sections={RULER_SECTIONS}
        current={MODULES.indexOf(stash.resumeModule)}
        taskIndex={0}
      />
    ) : (
      false
    );
    progressFull = undefined;
    progressShort = undefined;
  }

  const saving = save.kind === 'saving';
  const fitActions = fitStep ? (
    <>
      <Button
        variant="primary"
        size="task"
        arrow="forward"
        busy={saving}
        busyLabel="Saving…"
        onClick={() => fitControl.current?.use()}
      >
        {recalibrating ? 'Save my fit' : 'Use this fit'}
      </Button>
      <Button
        variant="secondary"
        size="task"
        disabled={saving}
        onClick={() => fitControl.current?.adjustFirst()}
      >
        Adjust first
      </Button>
    </>
  ) : undefined;

  const announcement =
    step === 'fit'
      ? 'All 3 parts done. Your fit is ready.'
      : step === 'done'
        ? 'Your fit is saved.'
        : (progress.text ?? '');

  return (
    <>
      <TaskShell
        ruler={ruler}
        progress={progressFull}
        progressShort={progressShort}
        skipLabel={module ? SKIP_LABEL[module] : undefined}
        onPause={taskScreen ? pause : undefined}
        onSkip={taskScreen ? skip : undefined}
        actions={fitActions}
        hideActions={!taskScreen && !fitStep}
        idleKey={`${step}-${epoch}`}
        announcement={announcement}
      >
        <ScreenContext.Provider value={screenRef}>
          <div
            key={screenKey}
            ref={screenRef}
            className="tn-screen"
            data-step={step}
            // Clicking inside the screen keeps focus in it, so the task keys
            // still work; they never fire from the action bar (WCAG 2.1.4).
            tabIndex={-1}
          >
            {screen}
          </div>
        </ScreenContext.Provider>
      </TaskShell>
      <Sheet
        open={state.paused}
        onOpenChange={(open) => {
          if (!open) send({ type: 'unpause' });
        }}
        title="Paused"
        description="Your answers so far are saved."
        // Resume and Esc close the sheet; it has no close button of its own.
        className="tn-pause"
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

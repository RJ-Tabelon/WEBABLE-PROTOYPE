import {
  summarizeFocus,
  summarizePointing,
  summarizeReading,
  type AttentionSummary,
  type CalibrationModules,
  type ContrastTrial,
  type DragTrial,
  type FindTextTrial,
  type FocusSession,
  type HoldTrial,
  type MotorSummary,
  type NextActionTrial,
  type PointerBlock,
  type PolarityTrial,
  type ReadingSession,
  type ReadingTrial,
  type SearchTrial,
  type VisionSummary,
} from '@webable/core';

import {
  emptyFocus,
  emptyPointing,
  emptyReading,
  focusSession,
  pointingSession,
  readingSession,
  type FocusDraft,
  type PointingDraft,
  type ReadingDraft,
} from './record';
import {
  firstStepOfModule,
  isStepActive,
  MODULE_LABEL,
  MODULES,
  moduleOf,
  nextActiveStep,
  STEP_INFO,
  STEP_ORDER,
  stepAfterModule,
  type ModuleId,
  type Setup,
  type StepContext,
  type StepId,
} from './steps';

/**
 * The Tune flow as a pure reducer. Screens report what happened ("the ladder
 * finished with these trials"); the reducer stores it, decides the next screen,
 * and reduces a module to its summary the moment the person leaves it. Raw
 * trials never outlive their module. Every action names the step it belongs to,
 * so a late or doubled event from an old screen is ignored.
 */

export type ModuleOutcome = 'pending' | 'done' | 'skipped';

export interface TuneState {
  step: StepId;
  setup: Setup | null;
  /** ISO time the person pressed Begin (or the time of the Tune being resumed). */
  startedAt: string | null;
  /** The browser's default font size, for the large-print rule. */
  rootFontPx: number;
  outcomes: Record<ModuleId, ModuleOutcome>;
  summaries: CalibrationModules;
  reading: ReadingDraft;
  pointing: PointingDraft;
  focus: FocusDraft;
  /** performance.now() when each module opened. */
  moduleStartMs: Record<ModuleId, number | null>;
  paused: boolean;
  /** Increments on every resume from Pause: screens restart their current trial. */
  pauseEpoch: number;
}

/** Summaries kept from a Tune the person chose to finish later (see flow/storage). */
export interface TuneStash {
  setup: Setup;
  startedAt: string;
  summaries: CalibrationModules;
  outcomes: Record<ModuleId, ModuleOutcome>;
  resumeModule: ModuleId;
}

export type TuneAction =
  | {
      type: 'begin';
      setup: Setup;
      startedAt: string;
      rootFontPx: number;
      now: number;
    }
  | { type: 'restore'; stash: TuneStash; rootFontPx: number; now: number }
  /** A saved Tune was found in this browser after the first render. */
  | { type: 'stashFound' }
  | { type: 'restart' }
  | { type: 'continue'; step: StepId; now: number }
  | {
      type: 'reading/comfort';
      step: StepId;
      comfortPx: number;
      referenceXHeightRatio: number;
      now: number;
    }
  | {
      type: 'reading/ladder';
      step: StepId;
      trials: ReadingTrial[];
      displayLimited: boolean;
      now: number;
    }
  | {
      type: 'reading/contrast';
      step: StepId;
      trials: ContrastTrial[];
      now: number;
    }
  | {
      type: 'reading/polarity';
      step: StepId;
      trials: PolarityTrial[];
      stated: ReadingSession['statedPolarity'];
      now: number;
    }
  | {
      type: 'reading/preview';
      step: StepId;
      overrides: ReadingSession['overrides'];
      now: number;
    }
  | {
      type: 'pointing/ring';
      step: StepId;
      blocks: PointerBlock[];
      express: boolean;
      now: number;
    }
  | { type: 'pointing/hold'; step: StepId; holds: HoldTrial[]; now: number }
  | {
      type: 'pointing/drag';
      step: StepId;
      drags: DragTrial[] | 'skipped';
      now: number;
    }
  | {
      type: 'pointing/return';
      step: StepId;
      block: PointerBlock | null;
      now: number;
    }
  | {
      type: 'pointing/preview';
      step: StepId;
      chosenPx: number | null;
      now: number;
    }
  | {
      type: 'focus/search';
      step: StepId;
      trials: SearchTrial[];
      motionShown: boolean;
      stopMotionPressed: boolean;
      now: number;
    }
  | {
      type: 'focus/next';
      step: StepId;
      trials: NextActionTrial[];
      now: number;
    }
  | {
      type: 'focus/text';
      step: StepId;
      trials: FindTextTrial[];
      now: number;
    }
  | {
      type: 'focus/prefs';
      step: StepId;
      preferences: FocusSession['preferences'];
      now: number;
    }
  | {
      type: 'focus/chips';
      step: StepId;
      chips: FocusSession['chips'];
      now: number;
    }
  | { type: 'skipPart'; step: StepId; now: number }
  | { type: 'pause' }
  | { type: 'unpause' }
  | { type: 'saved' };

const PENDING: Record<ModuleId, ModuleOutcome> = {
  reading: 'pending',
  pointing: 'pending',
  focus: 'pending',
};

const NO_STARTS: Record<ModuleId, number | null> = {
  reading: null,
  pointing: null,
  focus: null,
};

export function initialTuneState(
  options: { hasStash?: boolean; rootFontPx?: number } = {},
): TuneState {
  return {
    step: options.hasStash ? 'resume' : 'intro',
    setup: null,
    startedAt: null,
    rootFontPx: options.rootFontPx ?? 16,
    outcomes: { ...PENDING },
    summaries: {},
    reading: emptyReading(),
    pointing: emptyPointing(),
    focus: emptyFocus(),
    moduleStartMs: { ...NO_STARTS },
    paused: false,
    pauseEpoch: 0,
  };
}

export function stepContext(state: TuneState, now: number): StepContext {
  const start = state.moduleStartMs.pointing;
  return {
    setup: state.setup,
    express: state.pointing.express,
    pointingElapsedSec:
      start === null || state.outcomes.pointing !== 'pending'
        ? null
        : Math.max(0, (now - start) / 1000),
    hasStash: false,
  };
}

/* ------------------------------------------------------------------------ */
/* Module summaries                                                           */
/* ------------------------------------------------------------------------ */

function durationSec(state: TuneState, module: ModuleId, now: number): number {
  const start = state.moduleStartMs[module];
  return start === null ? 0 : Math.max(0, (now - start) / 1000);
}

export function summarizeReadingDraft(
  draft: ReadingDraft,
  rootFontPx: number,
  seconds: number,
): VisionSummary {
  return summarizeReading(readingSession(draft, seconds), { rootFontPx });
}

export function summarizePointingDraft(
  draft: PointingDraft,
  input: Setup['input'],
  seconds: number,
): MotorSummary {
  return summarizePointing(pointingSession(draft, input, seconds));
}

export function summarizeFocusDraft(
  draft: FocusDraft,
  seconds: number,
): AttentionSummary {
  return summarizeFocus(focusSession(draft, seconds));
}

/** Reduce a module to its summary and drop its raw trials. */
function finalize(
  state: TuneState,
  module: ModuleId,
  outcome: Exclude<ModuleOutcome, 'pending'>,
  now: number,
): TuneState {
  if (state.outcomes[module] !== 'pending') return state;
  const seconds = durationSec(state, module, now);
  const input = state.setup?.input ?? 'mouse';
  // A module the person never opened keeps a summary saved from a paused Tune.
  const untouched = state.moduleStartMs[module] === null;
  const existing = state.summaries[module];
  const summaries: CalibrationModules = { ...state.summaries };
  // A fresh summary wins, unless it is empty and a measured one was saved before.
  const pick = <T extends { status: 'measured' | 'skipped' }>(
    next: T,
    saved: T | undefined,
  ): T =>
    next.status === 'skipped' && saved?.status === 'measured' ? saved : next;
  if (untouched && existing) {
    // Keep what was saved before.
  } else if (module === 'reading') {
    summaries.reading = pick(
      summarizeReadingDraft(state.reading, state.rootFontPx, seconds),
      state.summaries.reading,
    );
  } else if (module === 'pointing') {
    summaries.pointing = pick(
      summarizePointingDraft(state.pointing, input, seconds),
      state.summaries.pointing,
    );
  } else {
    summaries.focus = pick(
      summarizeFocusDraft(state.focus, seconds),
      state.summaries.focus,
    );
  }
  return {
    ...state,
    summaries,
    outcomes: { ...state.outcomes, [module]: outcome },
    ...(module === 'reading' ? { reading: emptyReading() } : {}),
    ...(module === 'pointing' ? { pointing: emptyPointing() } : {}),
    ...(module === 'focus' ? { focus: emptyFocus() } : {}),
  };
}

function moduleIndex(module: ModuleId | null, step: StepId): number {
  if (module) return MODULES.indexOf(module);
  return step === 'fit' || step === 'done' ? MODULES.length : -1;
}

/**
 * Move to `next`. Every module the move leaves behind is reduced to its summary:
 * the one being left counts as `leaving`, modules passed over without a single
 * screen (a screen-reader route, for example) count as skipped.
 */
function goTo(
  state: TuneState,
  next: StepId,
  now: number,
  leaving: Exclude<ModuleOutcome, 'pending'> = 'done',
): TuneState {
  let s = state;
  const fromModule = moduleOf(state.step);
  const toModule = moduleOf(next);
  const toIndex = moduleIndex(toModule, next);
  for (const module of MODULES) {
    const index = MODULES.indexOf(module);
    if (index >= toIndex || s.outcomes[module] !== 'pending') continue;
    const outcome =
      module === fromModule
        ? leaving
        : s.moduleStartMs[module] === null
          ? 'skipped'
          : 'done';
    s = finalize(s, module, outcome, now);
  }
  if (toModule && s.moduleStartMs[toModule] === null) {
    s = { ...s, moduleStartMs: { ...s.moduleStartMs, [toModule]: now } };
  }
  return { ...s, step: next, paused: false };
}

function advance(state: TuneState, now: number): TuneState {
  return goTo(state, nextActiveStep(state.step, stepContext(state, now)), now);
}

/* ------------------------------------------------------------------------ */
/* Reducer                                                                    */
/* ------------------------------------------------------------------------ */

export function tuneReducer(state: TuneState, action: TuneAction): TuneState {
  switch (action.type) {
    case 'begin': {
      if (state.step !== 'intro') return state;
      const started: TuneState = {
        ...initialTuneState({ rootFontPx: action.rootFontPx }),
        setup: action.setup,
        startedAt: action.startedAt,
        step: 'intro',
      };
      return advance(started, action.now);
    }
    case 'restore': {
      if (state.step !== 'resume') return state;
      const { stash } = action;
      const restored: TuneState = {
        ...initialTuneState({ rootFontPx: action.rootFontPx }),
        setup: stash.setup,
        startedAt: stash.startedAt,
        summaries: stash.summaries,
        outcomes: { ...stash.outcomes, [stash.resumeModule]: 'pending' },
      };
      // Later modules open fresh, even if a partial summary was saved for them.
      for (const module of MODULES) {
        if (MODULES.indexOf(module) > MODULES.indexOf(stash.resumeModule))
          restored.outcomes[module] = 'pending';
      }
      const ctx = stepContext(restored, action.now);
      return goTo(
        { ...restored, step: 'resume' },
        firstStepOfModule(stash.resumeModule, ctx),
        action.now,
      );
    }
    case 'stashFound':
      return state.step === 'intro' ? { ...state, step: 'resume' } : state;
    case 'restart':
      return initialTuneState({ rootFontPx: state.rootFontPx });
    case 'pause':
      return STEP_INFO[state.step].actions && !state.paused
        ? { ...state, paused: true }
        : state;
    case 'unpause':
      return state.paused
        ? { ...state, paused: false, pauseEpoch: state.pauseEpoch + 1 }
        : state;
    case 'saved':
      return state.step === 'fit' ? { ...state, step: 'done' } : state;
    default:
      break;
  }

  if (action.step !== state.step) return state;
  const now = action.now;

  switch (action.type) {
    case 'continue':
      return advance(state, now);
    case 'skipPart': {
      const module = moduleOf(state.step);
      if (!module) return state;
      const next = stepAfterModule(module, stepContext(state, now));
      return goTo(state, next, now, 'skipped');
    }
    case 'reading/comfort':
      return advance(
        {
          ...state,
          reading: {
            ...state.reading,
            comfortPx: action.comfortPx,
            referenceXHeightRatio: action.referenceXHeightRatio,
          },
        },
        now,
      );
    case 'reading/ladder':
      return advance(
        {
          ...state,
          reading: {
            ...state.reading,
            ladder: action.trials,
            displayLimited: action.displayLimited,
          },
        },
        now,
      );
    case 'reading/contrast':
      return advance(
        { ...state, reading: { ...state.reading, contrast: action.trials } },
        now,
      );
    case 'reading/polarity':
      return advance(
        {
          ...state,
          reading: {
            ...state.reading,
            polarity: action.trials,
            statedPolarity: action.stated,
          },
        },
        now,
      );
    case 'reading/preview':
      return advance(
        {
          ...state,
          reading: { ...state.reading, overrides: action.overrides },
        },
        now,
      );
    case 'pointing/ring':
      return advance(
        {
          ...state,
          pointing: {
            ...state.pointing,
            blocks: action.blocks,
            express: action.express,
          },
        },
        now,
      );
    case 'pointing/hold':
      return advance(
        { ...state, pointing: { ...state.pointing, holds: action.holds } },
        now,
      );
    case 'pointing/drag':
      return advance(
        { ...state, pointing: { ...state.pointing, drags: action.drags } },
        now,
      );
    case 'pointing/return':
      return advance(
        {
          ...state,
          pointing: { ...state.pointing, returnBlock: action.block },
        },
        now,
      );
    case 'pointing/preview':
      return advance(
        {
          ...state,
          pointing: { ...state.pointing, chosenPx: action.chosenPx },
        },
        now,
      );
    case 'focus/search':
      return advance(
        {
          ...state,
          focus: {
            ...state.focus,
            search: action.trials,
            motionShown: action.motionShown,
            stopMotionPressed: action.stopMotionPressed,
          },
        },
        now,
      );
    case 'focus/next':
      return advance(
        { ...state, focus: { ...state.focus, nextAction: action.trials } },
        now,
      );
    case 'focus/text':
      return advance(
        { ...state, focus: { ...state.focus, findText: action.trials } },
        now,
      );
    case 'focus/prefs':
      return advance(
        {
          ...state,
          focus: { ...state.focus, preferences: action.preferences },
        },
        now,
      );
    case 'focus/chips':
      return advance(
        { ...state, focus: { ...state.focus, chips: action.chips } },
        now,
      );
  }
}

/* ------------------------------------------------------------------------ */
/* Selectors                                                                  */
/* ------------------------------------------------------------------------ */

export interface TuneProgress {
  /** Ruler section: 0..2, or 3 when every part is done. */
  section: number;
  /** Tasks done in the current section. */
  taskIndex: number;
  /** "Part 2 of 3 · Pointing · about 3 min left", or null on screens without one. */
  text: string | null;
  /** Rounded up; at least 1 while a part is running. */
  minutesLeft: number;
}

/** Remaining time in whole minutes (rounded up), from the current screen on. */
export function minutesLeft(state: TuneState, now: number): number {
  const ctx = stepContext(state, now);
  const from = STEP_ORDER.indexOf(state.step);
  let seconds = 0;
  for (let i = Math.max(0, from); i < STEP_ORDER.length; i++) {
    const step = STEP_ORDER[i];
    if (step && isStepActive(step, ctx)) seconds += STEP_INFO[step].estimateSec;
  }
  return Math.max(1, Math.ceil(seconds / 60));
}

export function progressOf(state: TuneState, now: number): TuneProgress {
  const module = moduleOf(state.step);
  const left = minutesLeft(state, now);
  if (!module) {
    const done = state.step === 'fit' || state.step === 'done';
    return {
      section: done ? MODULES.length : 0,
      taskIndex: 0,
      text: done ? 'All 3 parts done' : null,
      minutesLeft: left,
    };
  }
  const section = MODULES.indexOf(module);
  return {
    section,
    taskIndex: STEP_INFO[state.step].taskIndex,
    text: `Part ${section + 1} of ${MODULES.length} · ${MODULE_LABEL[module]} · about ${left} min left`,
    minutesLeft: left,
  };
}

/** The stash to keep when the person chooses "Save and finish later". */
export function stashOf(state: TuneState, now: number): TuneStash | null {
  if (!state.setup || !state.startedAt) return null;
  const module = moduleOf(state.step);
  if (!module) return null;
  // Summarize the module in progress with the answers given so far.
  const partial = finalize(state, module, 'skipped', now);
  return {
    setup: state.setup,
    startedAt: state.startedAt,
    summaries: partial.summaries,
    outcomes: partial.outcomes,
    resumeModule: module,
  };
}

/** Whether the module finished with measurements (for the calm "done" line). */
export function moduleMeasured(state: TuneState, module: ModuleId): boolean {
  return state.summaries[module]?.status === 'measured';
}

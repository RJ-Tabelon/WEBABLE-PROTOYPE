import {
  CALIBRATION_VERSION,
  calibrationRecordSchema,
  deriveFitProfile,
  type CalibrationModules,
  type CalibrationRecord,
  type ContrastTrial,
  type DeviceContext,
  type DragTrial,
  type FindTextTrial,
  type FitProfile,
  type FocusSession,
  type HoldTrial,
  type InputClass,
  type NextActionTrial,
  type PointerBlock,
  type PointingSession,
  type PolarityTrial,
  type ReadingSession,
  type ReadingTrial,
  type SearchTrial,
  type SystemSignals,
} from '@webable/core';

/**
 * Raw per-trial drafts (memory only) and their reduction to the core session
 * types. Summaries are computed by `summarizeReading` / `summarizePointing` /
 * `summarizeFocus` in the flow machine the moment a module ends; the drafts are
 * then dropped.
 */

export const DEFAULT_XHEIGHT_RATIO = 0.52;

export interface ReadingDraft {
  comfortPx: number | null;
  referenceXHeightRatio: number;
  displayLimited: boolean;
  ladder: ReadingTrial[];
  contrast: ContrastTrial[];
  polarity: PolarityTrial[];
  statedPolarity: ReadingSession['statedPolarity'];
  overrides: ReadingSession['overrides'];
}

export interface PointingDraft {
  blocks: PointerBlock[];
  holds: HoldTrial[];
  drags: DragTrial[] | 'skipped';
  returnBlock: PointerBlock | null;
  chosenPx: number | null;
  express: boolean;
}

export interface FocusDraft {
  motionShown: boolean;
  stopMotionPressed: boolean;
  search: SearchTrial[];
  nextAction: NextActionTrial[];
  findText: FindTextTrial[];
  preferences: FocusSession['preferences'];
  chips: FocusSession['chips'];
}

export function emptyReading(): ReadingDraft {
  return {
    comfortPx: null,
    referenceXHeightRatio: DEFAULT_XHEIGHT_RATIO,
    displayLimited: false,
    ladder: [],
    contrast: [],
    polarity: [],
    statedPolarity: null,
    overrides: {},
  };
}

export function emptyPointing(): PointingDraft {
  return {
    blocks: [],
    holds: [],
    drags: [],
    returnBlock: null,
    chosenPx: null,
    express: false,
  };
}

export function emptyFocus(): FocusDraft {
  return {
    motionShown: false,
    stopMotionPressed: false,
    search: [],
    nextAction: [],
    findText: [],
    preferences: { still: null, clean: null, chunked: null, hierarchy: null },
    chips: [],
  };
}

export function readingSession(
  draft: ReadingDraft,
  durationSec: number,
): ReadingSession {
  return {
    comfortPx: draft.comfortPx,
    ladder: draft.ladder,
    contrast: draft.contrast,
    polarity: draft.polarity,
    statedPolarity: draft.statedPolarity,
    overrides: draft.overrides,
    referenceXHeightRatio: draft.referenceXHeightRatio,
    displayLimited: draft.displayLimited,
    durationSec: Math.max(0, durationSec),
  };
}

export function pointingSession(
  draft: PointingDraft,
  input: InputClass,
  durationSec: number,
): PointingSession {
  return {
    input,
    blocks: draft.blocks,
    holds: draft.holds,
    drags: draft.drags,
    returnBlock: draft.returnBlock,
    chosenPx: draft.chosenPx,
    express: draft.express,
    durationSec: Math.max(0, durationSec),
  };
}

export function focusSession(
  draft: FocusDraft,
  durationSec: number,
): FocusSession {
  return {
    motionShown: draft.motionShown,
    stopMotionPressed: draft.stopMotionPressed,
    search: draft.search,
    nextAction: draft.nextAction,
    findText: draft.findText,
    preferences: draft.preferences,
    chips: draft.chips,
    durationSec: Math.max(0, durationSec),
  };
}

/** What the browser said, in the shape `deriveFitProfile` wants. */
export function systemSignalsFrom(device: DeviceContext): SystemSignals {
  return {
    reducedMotion: device.reducedMotion,
    colorScheme: device.colorScheme,
    moreContrast: device.moreContrast,
    forcedColors: device.forcedColors,
    deviceClass: device.class,
    input: device.input,
  };
}

export function buildRecord(input: {
  device: DeviceContext;
  modules: CalibrationModules;
  startedAt: string;
  completedAt: string | null;
}): CalibrationRecord {
  return calibrationRecordSchema.parse({
    version: CALIBRATION_VERSION,
    device: input.device,
    modules: input.modules,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  });
}

/**
 * The fit for a finished (or partly finished) Tune. Deterministic: the same
 * summaries and device always give the same profile. When recalibrating, the
 * previous profile's overrides survive (deriveFitProfile keeps them).
 */
export function deriveProfile(input: {
  device: DeviceContext;
  modules: CalibrationModules;
  startedAt: string;
  completedAt: string;
  previous?: FitProfile | null;
}): { record: CalibrationRecord; profile: FitProfile } {
  const record = buildRecord(input);
  const profile = deriveFitProfile({
    record,
    system: systemSignalsFrom(input.device),
    ...(input.previous ? { previous: input.previous } : {}),
    now: new Date(input.completedAt),
  });
  return { record, profile };
}

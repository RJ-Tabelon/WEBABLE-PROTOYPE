import { z } from 'zod';

import { deviceClassSchema, inputClassSchema } from '../profile/schema';

/**
 * Calibration summaries. Raw trials (pointer samples, per-sentence reading
 * times, trajectories) live in memory during the session and are discarded.
 * Only these bounded summaries are persisted (calibration_sessions.modules).
 * No kinematic biomarkers (jerk, tremor band power, pause distributions) are
 * ever computed or stored.
 */

export const deviceContextSchema = z.object({
  class: deviceClassSchema,
  input: inputClassSchema,
  /** Rounded device pixel ratio bucket: 1, 1.5, 2, 3. */
  dprBucket: z.number().min(1).max(4),
  /** Coarse viewport bucket. */
  viewport: z.enum(['S', 'M', 'L', 'XL']),
  reducedMotion: z.boolean(),
  colorScheme: z.enum(['light', 'dark']),
  moreContrast: z.boolean(),
  forcedColors: z.boolean(),
  /** 1rem in CSS px as the browser reports it (default font size setting). */
  rootFontPx: z.number().min(8).max(64),
  /** Page zoom observed during calibration (visualViewport.scale * devicePixelRatio ratio). */
  zoom: z.number().min(0.25).max(5),
});
export type DeviceContext = z.infer<typeof deviceContextSchema>;

const n = (min = 0, max = 1e6) => z.number().min(min).max(max);

/** Pointing: one row per scored block of the adaptive ring (cal-motor.md 5.5). */
export const motorBlockSchema = z.object({
  targetPx: n(8, 160),
  trials: n(0, 20).int(),
  misses: n(0, 20).int(),
  /** Robust endpoint spread in CSS px (median radius / 1.1774). */
  sigmaPx: n(0, 200),
  medianMoveMs: n(0, 20000),
});

export const motorSummarySchema = z.object({
  status: z.enum(['measured', 'skipped']),
  input: inputClassSchema,
  blocks: z.array(motorBlockSchema).max(6),
  /** Recommended minimum target (ladder value) and bootstrap agreement. */
  recommendedPx: z.number().int().min(24).max(96).nullable(),
  recommendedConfidence: n(0, 1),
  /** Absolute precision floor sigma_a in CSS px and speed/accuracy slope c. */
  precisionFloorPx: n(0, 100).nullable(),
  slip: z.object({
    presses: n(0, 200).int(),
    slipOffs: n(0, 200).int(),
    p95Px: n(0, 400),
    pressP90Ms: n(0, 5000),
  }),
  repeats: z.object({ count: n(0, 200).int(), p95IntervalMs: n(0, 2000) }),
  flyBy: n(0, 200).int(),
  hold: z.object({ jitterP95Px: n(0, 400), exits: n(0, 50).int() }).nullable(),
  drag: z
    .object({
      attempts: n(0, 10).int(),
      successes: n(0, 10).int(),
      earlyReleases: n(0, 10).int(),
      timeRatio: n(0, 50).nullable(),
      skipped: z.boolean(),
    })
    .nullable(),
  fatigue: z.boolean(),
  /** Size the person picked in the comfort preview (never denies more room). */
  chosenPx: z.number().int().min(24).max(96).nullable(),
  express: z.boolean(),
  durationSec: n(0, 3600),
});
export type MotorSummary = z.infer<typeof motorSummarySchema>;

export const visionSummarySchema = z.object({
  status: z.enum(['measured', 'skipped']),
  /** V1: the size chosen as comfortable (CSS px of the reference font). */
  comfortPx: n(8, 200).nullable(),
  /** V2 ladder result: critical print size (font px) and whether the knee was bracketed. */
  criticalPx: n(4, 200).nullable(),
  bracket: z.enum(['0.1', '0.2', 'none']),
  plateauPoints: n(0, 20).int(),
  accuracy: n(0, 1),
  largePrint: z.boolean(),
  displayLimited: z.boolean(),
  /** Zoom or visibility changed during reading trials (lowers size confidence). */
  disturbed: z.boolean().optional(),
  /** V3 contrast threshold: log10 Weber, posterior sd, and whether the ceiling was hit. */
  contrast: z
    .object({
      alphaLog: z.number().min(-3).max(0),
      sd: n(0, 2),
      ceiling: z.boolean(),
      trials: n(0, 20).int(),
      /** "I can't see a word" answers at Weber >= 0.3 (two or more => maximum contrast band). */
      cantSeeHigh: n(0, 20).int().optional(),
    })
    .nullable(),
  /** V4 polarity: mean log reading-rate difference (dark - light), SE, and stated preference. */
  polarity: z
    .object({
      deltaLog: z.number().min(-2).max(2),
      se: n(0, 2),
      stated: z.enum(['light', 'dark', 'same']).nullable(),
    })
    .nullable(),
  /** V5 preview nudges become explicit overrides. */
  overrides: z
    .object({
      textPx: n(8, 200).optional(),
      polarity: z.enum(['light', 'dark', 'none']).optional(),
      moreSpacing: z.boolean().optional(),
    })
    .default({}),
  /** Reference font x-height ratio measured at runtime. */
  referenceXHeightRatio: n(0.3, 0.7),
  durationSec: n(0, 3600),
});
export type VisionSummary = z.infer<typeof visionSummarySchema>;

/** A within-person log difference with its standard error (cal-attention.md 5). */
const effect = z.object({ value: z.number().min(-5).max(5), se: n(0, 5), n: n(0, 100).int() });

export const attentionSummarySchema = z.object({
  status: z.enum(['measured', 'skipped']),
  motionShown: z.boolean(),
  stopMotionPressed: z.boolean(),
  effects: z.object({
    clutter: effect.nullable(),
    motion: effect.nullable(),
    guidance: effect.nullable(),
    chunking: effect.nullable(),
  }),
  decoyCapture: n(0, 1).nullable(),
  /** Post-use comparisons, -2..2, positive favours the adapted version. */
  preferences: z.object({
    still: z.number().int().min(-2).max(2).nullable(),
    clean: z.number().int().min(-2).max(2).nullable(),
    chunked: z.number().int().min(-2).max(2).nullable(),
    hierarchy: z.number().int().min(-2).max(2).nullable(),
  }),
  /** "Did anything get in your way?" functional chips. */
  chips: z.array(z.enum(['moving', 'busy', 'long_text', 'unclear_action', 'nothing'])).max(5),
  durationSec: n(0, 3600),
});
export type AttentionSummary = z.infer<typeof attentionSummarySchema>;

export const calibrationModulesSchema = z.object({
  reading: visionSummarySchema.optional(),
  pointing: motorSummarySchema.optional(),
  focus: attentionSummarySchema.optional(),
});
export type CalibrationModules = z.infer<typeof calibrationModulesSchema>;

export const calibrationRecordSchema = z.object({
  version: z.string(),
  device: deviceContextSchema,
  modules: calibrationModulesSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type CalibrationRecord = z.infer<typeof calibrationRecordSchema>;

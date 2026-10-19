/**
 * Corpus personas (docs/10 §10): valid FitProfiles built from core's
 * defaultFitProfile with measured overrides, checked against fitProfileSchema
 * before use. `core` is the bundled node-core module (lib/bundle.mjs).
 *
 *   large-text       F = 24 px, contrast floor 7, line height 1.6, T = 44
 *   large-targets    F = 18 px, T = 56, steady clicks on
 *   calm             F = 18 px, T = 32, distraction, density and motion
 *                    latents at mean 0.9 (sd 0.15, confidence 0.8)
 *   very-large-text  F = 36 px (the triage gate's compose case), T = 44
 *   focus            F = 16 px, T = 32: clutter and comprehension (docs/11):
 *                    distraction, density, chunking and guidance latents at
 *                    mean 0.9 (structure level 2: restructured automatically)
 *   low-light        F = 20 px, T = 44, dark polarity, contrast floor 21: the
 *                    maximum-contrast dark palette (docs/12 §4.1)
 */

const CREATED = '2026-10-15T12:00:00.000Z';

const measured = (value, confidence = 0.85) => ({
  value,
  source: 'measured',
  confidence,
  measured: value,
});

const latent = (mean) => ({
  mean,
  sd: 0.15,
  confidence: 0.8,
  sources: ['behavior'],
});

function base(core) {
  const p = core.defaultFitProfile(undefined, new Date(CREATED));
  p.calibrationVersion = 'cal-1.0.0';
  p.confidence = 0.8;
  return p;
}

function largeText(core, px = 24) {
  const p = base(core);
  p.modules = { reading: 'measured', pointing: 'measured', focus: 'not_run' };
  p.vision.textMinPx = measured(px);
  p.vision.contrastFloor = measured(7, 0.7);
  p.vision.lineHeight = measured(1.6, 0.7);
  p.motor.minTargetPx = measured(44, 0.8);
  return p;
}

function lowLight(core) {
  const p = base(core);
  p.modules = { reading: 'measured', pointing: 'measured', focus: 'not_run' };
  p.vision.textMinPx = measured(20);
  p.vision.polarity = measured('dark', 0.8);
  p.vision.contrastFloor = measured(21, 0.8);
  p.motor.minTargetPx = measured(44, 0.8);
  return p;
}
function largeTargets(core) {
  const p = base(core);
  p.modules = { reading: 'measured', pointing: 'measured', focus: 'not_run' };
  p.vision.textMinPx = measured(18);
  p.motor.minTargetPx = measured(56, 0.8);
  p.motor.targetSpacingPx = measured(64, 0.7);
  p.motor.steadyClicks = measured(
    { on: true, windowMs: 300, radiusPx: 12 },
    0.7,
  );
  return p;
}

function calm(core) {
  const p = base(core);
  p.modules = { reading: 'measured', pointing: 'measured', focus: 'measured' };
  p.vision.textMinPx = measured(18);
  p.motor.minTargetPx = measured(32, 0.8);
  p.attention.distraction = latent(0.9);
  p.attention.density = latent(0.9);
  p.attention.motion = latent(0.9);
  return p;
}

function focus(core) {
  const p = base(core);
  p.modules = { reading: 'measured', pointing: 'measured', focus: 'measured' };
  p.vision.textMinPx = measured(16);
  p.motor.minTargetPx = measured(32, 0.8);
  p.attention.distraction = latent(0.9);
  p.attention.density = latent(0.9);
  p.attention.chunking = latent(0.9);
  p.attention.guidance = latent(0.9);
  return p;
}

export const PERSONAS = [
  {
    id: 'large-text',
    label: 'Large text (F 24, T 44, contrast 7)',
    build: (core) => largeText(core, 24),
  },
  {
    id: 'large-targets',
    label: 'Large targets (F 18, T 56, steady clicks)',
    build: largeTargets,
  },
  {
    id: 'calm',
    label: 'Calm (F 18, T 32, P(distraction benefit) ≈ 1)',
    build: calm,
  },
  {
    id: 'very-large-text',
    label: 'Very large text (F 36, T 44)',
    build: (core) => largeText(core, 36),
  },
  {
    id: 'low-light',
    label: 'Low light (F 20, T 44, dark, contrast 21)',
    build: lowLight,
  },
  {
    id: 'focus',
    label: 'Clutter and comprehension (F 16, T 32, structure level 2)',
    build: focus,
  },
];

/**
 * The triage sweep's profile: a measured reading floor and nothing else
 * (default targets, contrast and attention), so the sweep shows what the
 * text need alone decides (docs/10 §10: gov.uk at F 18 fits, at F 36
 * compose). The floor itself is set per sweep step in the page.
 */
export function textOnly(core) {
  const p = base(core);
  p.modules = { reading: 'measured', pointing: 'not_run', focus: 'not_run' };
  p.vision.textMinPx = measured(18);
  const parsed = core.fitProfileSchema.safeParse(p);
  if (!parsed.success) throw new Error('text-only profile is not valid');
  return parsed.data;
}

/** Reading floors swept through triage on every page (verdict, k, zoom). */
export const TRIAGE_SWEEP = [16, 18, 21, 24, 28, 32, 36, 40];

/** Build and validate the personas (all, or the ids given). */
export function personas(core, ids = null) {
  const out = [];
  for (const def of PERSONAS) {
    if (ids && !ids.includes(def.id)) continue;
    const profile = def.build(core);
    const parsed = core.fitProfileSchema.safeParse(profile);
    if (!parsed.success)
      throw new Error(
        `persona ${def.id} is not a valid FitProfile: ${parsed.error.issues
          .map((i) => `${i.path.join('.')} ${i.code}`)
          .join(', ')}`,
      );
    out.push({ id: def.id, label: def.label, profile: parsed.data });
  }
  return out;
}

/**
 * Every artifact WebAble persists or exchanges carries the version of the
 * logic that produced it, so later learning can separate "the person changed"
 * from "WebAble changed".
 */

/** Calibration task battery (web app, /tune). */
export const CALIBRATION_VERSION = 'cal-1.0.0' as const;

/** Measurement summaries -> fit profile derivation. */
export const DERIVATION_VERSION = 'fit-1.0.0' as const;

/** Adaptation op library (ids, levels, risk classes). */
export const OP_LIBRARY_VERSION = 'ops-2.0.0' as const;

/** In-page engine: extraction, apply, verify. */
export const ENGINE_VERSION = 'engine-2.0.0' as const;

/** Learning state and policy parameters. */
export const LEARNING_VERSION = 'learn-1.0.0' as const;

/** Page-analysis question catalog sent to Jev (server-side only). */
export const CATALOG_VERSION = 'wa-cat-1.0.0' as const;

/** Thresholds are calibrated per model version, so the model is pinned. */
export const JEV_PINNED_MODEL = 'jev-1.13.0' as const;

/** Page skeleton extraction (Fit view input; docs/10 §4). */
export const SKELETON_VERSION = 'skel-1.0.0' as const;

/** PageSpec schema and the planner prompt. Specs are cached per schema version. */
export const COMPOSE_SCHEMA_VERSION = 'wa-compose-2.0.0' as const;

/** Layout planner model (OpenAI). Quality and latency were measured per model, so it is pinned. */
export const COMPOSE_PINNED_MODEL = 'gpt-6-sol' as const;

/** Used only when the pinned model is unavailable to the API key. */
export const COMPOSE_FALLBACK_MODEL = 'gpt-5.6-terra' as const;

/** Person-relative triage (fits / tailor / compose). */
export const TRIAGE_VERSION = 'triage-1.0.0' as const;

/** Fit view layout rules (fit profile -> FitLayout). */
export const FIT_SOLVER_VERSION = 'fitlayout-1.1.0' as const;

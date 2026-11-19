/**
 * Learning and policy parameters, v1 defaults (personalization.md 16).
 * Values were chosen by simulation against synthetic users; the threshold
 * policy produced 20-75% fewer unwanted auto-applies than Thompson sampling.
 */
export const K = {
  /** Half-life of all counts, days. Priors never decay. */
  H_DAYS: 90,
  /** Domain concentration toward the personal estimate. */
  KAPPA: 4,
  /** Calibration prior strength m0 = M0_BASE + M0_CONF * confidence. */
  M0_BASE: 4,
  M0_CONF: 6,
  /** Prior strength with no calibration. */
  TIER0_M0: 2,
  /** Auto-apply requires expected utility > 0, i.e. P(helpful) above ~0.70. */
  TAU_AUTO: 0.7,
  TAU_OFFER: 0.4,
  TAU_PROMOTE: 0.7,
  TAU_SITE_PROMOTE: 0.8,
  MIN_ACCEPTS: 3,
  ASK_COOLDOWN_D: 60,
  /** Minimum engine reliability on a site before an op may run there. */
  P_OK_MIN: 0.5,
  /** Cost of an unwanted change relative to the benefit of a wanted one (Gajos 2008). */
  C: 2.33,
  C_FAIL: 0.1,
  OFFERS_PER_PAGE: 1,
  OFFERS_PER_DAY: 4,
  DISMISS_COOLDOWN_D: 7,
  DISMISS_STREAK: 3,
  GLOBAL_COOLDOWN_D: 30,
  UNDO_FAST_MS: 10_000,
  UNDO_MED_MS: 300_000,
  SETTLE_QUIET_MS: 20_000,
  SETTLE_KEEP_MS: 120_000,
  /** Kalman observation noise, process noise per day, floor (all log space). */
  R: 0.1 ** 2,
  Q_PER_DAY: 0.01 ** 2,
  SIGMA_MIN: 0.03,
  DOMAIN_TAU: 0.1,
  HYST: 0.03,
  /** Engine gate: two verifier rejects within 7 days pauses an op on that site for 7 days. */
  ENGINE_REJECTS: 2,
  ENGINE_WINDOW_D: 7,
  ENGINE_SKIP_D: 7,
} as const;

/** Evidence weight of each signal (personalization.md 4). */
export const W = {
  explicitPos: 1,
  explicitNeg: 1,
  undoFast: 1,
  undoMed: 0.5,
  undoLate: 0.3,
  acceptKept: 0.75,
  dismiss: 0.25,
  silence: 0.15,
  manualOn: 1,
  adjustKeep: 0.25,
  siteBlockDomainF: 2,
  siteBlockPersonalF: 0.25,
} as const;

/** Friction likelihood ratios. They can only raise an offer's chance, never trigger a change. */
export const FRICTION_LR = {
  misclick_burst: 3,
  rage_click: 3,
  zoom_in: 4,
  scroll_reversal: 2,
} as const;

/** Initial label -> applicability map before any outcome data. */
export const LABEL_PRIOR = { clear: 0.8, likely: 0.55, unsure: 0.25 } as const;
export const LABEL_PRIOR_STRENGTH = 10;

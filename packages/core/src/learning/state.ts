import { DIM_IDS, OP_IDS, type DimId, type OpId } from '../ops/catalog';
import { OP_IMPL_VERSION } from './priors';
import type {
  Day,
  DimState,
  DomainOp,
  DomainState,
  OpState,
  UserLearningState,
} from './types';

/** Local-only engine bookkeeping kept on a site's op entry (never synced). */
export interface DomainOpLocal extends DomainOp {
  /** Days of recent verifier rejects, pruned to K.ENGINE_WINDOW_D (drives the 2-rejects gate). */
  rejects?: Day[];
  /** Last day a verifier pass was counted (pass credit is capped at one per op, site and day). */
  passDay?: Day;
  /** The engine gate (not a dismissal) paused this op here until this day. */
  engineUntil?: Day;
  /**
   * A fast or "don't want" undo on this site: never auto-apply here again (offers
   * only) until the person accepts or turns the op on here. Deterministic, for
   * predictability (personalization.md 5.2 "Demote on a domain").
   */
  demoted?: true;
}

const OP_SET: ReadonlySet<string> = new Set(OP_IDS);
const DIM_SET: ReadonlySet<string> = new Set(DIM_IDS);
export const isOpId = (x: unknown): x is OpId =>
  typeof x === 'string' && OP_SET.has(x);
export const isDimId = (x: unknown): x is DimId =>
  typeof x === 'string' && DIM_SET.has(x);

export function defaultOpState(op: OpId, day: Day): OpState {
  return {
    c: { s: 0, f: 0, t: day },
    src: 'none',
    accepts: 0,
    askAfter: 0,
    dismissStreak: 0,
    offerCooldownUntil: 0,
    opVer: OP_IMPL_VERSION[op],
  };
}

/** A flat, uninformative dimension (used only when a state predates a dimension). */
export function neutralDim(value: number, day: Day, sigma = 0.35): DimState {
  const m = Math.log(value);
  return { m, v: sigma * sigma + 0.01, t: day, mCal: m, vCal: sigma * sigma };
}

/** Deep copy of JSON-shaped learning state (no functions, dates or cycles). */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function emptyDomainState(day: Day): DomainState {
  return { t: day, ops: {}, dims: {} };
}

export function ensureOp(u: UserLearningState, op: OpId, day: Day): OpState {
  const existing = u.ops[op];
  if (existing) return existing;
  const fresh = defaultOpState(op, day);
  u.ops[op] = fresh;
  return fresh;
}

export function ensureDomainOp(
  d: DomainState,
  op: OpId,
  day: Day,
): DomainOpLocal {
  const existing = d.ops[op] as DomainOpLocal | undefined;
  if (existing) return existing;
  const fresh: DomainOpLocal = { s: 0, f: 0, t: day };
  d.ops[op] = fresh;
  return fresh;
}

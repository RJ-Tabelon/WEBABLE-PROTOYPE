import type { AdaptEvent } from '@webable/core/learning/types';
import type { OpId } from '@webable/core/ops/catalog';

import type { KvArea } from '../storage/area';
import { randomId } from '../storage/crypto';
import { isRecord, KeyedMutex } from '../storage/store';
import type { EventInput } from './profile';

/**
 * Undo reason chips (personalization.md 4 and 11; core applyEvent notes).
 *
 * An undo is held for the chip's 8 s window, then applied as ONE 'undo' event
 * that already carries the reason when the person gave one. That keeps the
 * domain-free deltas exact: a delta that was already queued cannot be taken
 * back. A reason that arrives after the window is applied as a separate
 * 'undo_reason' event (its reversal is exact locally only).
 *
 * The hold lives in storage.session, so a worker restart inside the window
 * loses nothing; the worker flushes due entries whenever it wakes.
 * The page stops showing the change at once: holding only delays learning.
 */

export const REASON_WINDOW_MS = 8_000;
/** How long a flushed undo can still take a late reason. */
export const LATE_REASON_MS = 10 * 60_000;
export const UNDO_HOLD_KEY = 'wa.undoHold';

export type UndoReason = NonNullable<AdaptEvent['reason']>;

export const UNDO_REASONS: readonly UndoReason[] = [
  'dont_want',
  'too_much',
  'too_little',
  'broke_page',
  'needed_that',
];

export interface HeldUndo {
  id: string;
  tabId: number;
  domain: string;
  tabSession: string;
  input: EventInput;
  /**
   * Component keys of the regions a region-scoped op targeted on this page.
   * An "I needed that" makes each one an exception on this site.
   */
  regions?: string[];
  /** When the hold ends and the event is applied. */
  due: number;
  /** Applied already (kept for late reasons until `LATE_REASON_MS`). */
  flushedAt: number | null;
}

function isHeld(v: unknown): v is HeldUndo {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.tabId === 'number' &&
    typeof v.domain === 'string' &&
    typeof v.tabSession === 'string' &&
    isRecord(v.input) &&
    v.input.kind === 'undo' &&
    typeof v.due === 'number' &&
    (v.flushedAt === null || typeof v.flushedAt === 'number') &&
    (v.regions === undefined ||
      (Array.isArray(v.regions) &&
        v.regions.every((k) => typeof k === 'string')))
  );
}

export type ReasonOutcome =
  /** The undo was still held: flush it now with the reason. */
  | { kind: 'attach'; entry: HeldUndo }
  /** The undo was applied already: apply an 'undo_reason' event. */
  | { kind: 'late'; entry: HeldUndo; event: EventInput }
  | { kind: 'none' };

/**
 * Pure: the component keys an "I needed that" on this held undo marks as
 * exceptions (none for any other reason, or a page-wide op).
 */
export function neededKeys(entry: HeldUndo): string[] {
  return entry.input.reason === 'needed_that' ? (entry.regions ?? []) : [];
}

/** The first key rides on the event itself; core adds it to the site's exceptions. */
function withComponentKey(
  input: EventInput,
  reason: UndoReason,
  regions: readonly string[] | undefined,
): EventInput {
  const key = reason === 'needed_that' ? regions?.[0] : undefined;
  return key !== undefined ? { ...input, componentKey: key } : input;
}

/** Pure: what a reason does to the hold list. */
export function applyReason(
  list: readonly HeldUndo[],
  match: { tabId: number; op: OpId },
  reason: UndoReason,
  now: number,
): { list: HeldUndo[]; outcome: ReasonOutcome } {
  const candidates = list
    .filter(
      (h) =>
        h.tabId === match.tabId &&
        h.input.op === match.op &&
        h.input.reason === undefined,
    )
    .sort((a, b) => b.due - a.due);
  const entry = candidates[0];
  if (!entry) return { list: [...list], outcome: { kind: 'none' } };
  if (entry.flushedAt === null) {
    const updated: HeldUndo = {
      ...entry,
      input: withComponentKey(
        { ...entry.input, reason },
        reason,
        entry.regions,
      ),
      due: now,
    };
    return {
      list: list.map((h) => (h.id === entry.id ? updated : h)),
      outcome: { kind: 'attach', entry: updated },
    };
  }
  if (now - entry.flushedAt > LATE_REASON_MS)
    return { list: [...list], outcome: { kind: 'none' } };
  const event: EventInput = withComponentKey(
    {
      cat: entry.input.cat,
      op: entry.input.op,
      level: entry.input.level,
      src: entry.input.src,
      kind: 'undo_reason',
      reason,
      ...(entry.input.dtApplyMs !== undefined
        ? { dtApplyMs: entry.input.dtApplyMs }
        : {}),
      ...(entry.input.aiLabel !== undefined
        ? { aiLabel: entry.input.aiLabel }
        : {}),
      ...(entry.input.componentKey !== undefined
        ? { componentKey: entry.input.componentKey }
        : {}),
    },
    reason,
    entry.regions,
  );
  const updated: HeldUndo = { ...entry, input: { ...entry.input, reason } };
  return {
    list: list.map((h) => (h.id === entry.id ? updated : h)),
    outcome: { kind: 'late', entry: updated, event },
  };
}

/** Pure: drop entries that can no longer take a reason. */
export function pruneHeld(list: readonly HeldUndo[], now: number): HeldUndo[] {
  return list.filter(
    (h) => h.flushedAt === null || now - h.flushedAt <= LATE_REASON_MS,
  );
}

export class UndoHold {
  private readonly mutex = new KeyedMutex();

  constructor(private readonly session: KvArea) {}

  private async read(): Promise<HeldUndo[]> {
    try {
      const got = await this.session.getMany([UNDO_HOLD_KEY]);
      const raw = got[UNDO_HOLD_KEY];
      return Array.isArray(raw) ? raw.filter(isHeld) : [];
    } catch {
      return [];
    }
  }

  private async write(list: HeldUndo[]): Promise<void> {
    await this.session.set({ [UNDO_HOLD_KEY]: list }).catch(() => undefined);
  }

  private run<T>(
    fn: (list: HeldUndo[]) => Promise<[HeldUndo[], T]> | [HeldUndo[], T],
  ): Promise<T> {
    return this.mutex.run(UNDO_HOLD_KEY, async () => {
      const [next, out] = await fn(await this.read());
      await this.write(next);
      return out;
    });
  }

  /** Hold undo events for the reason window. */
  hold(
    entries: ReadonlyArray<Omit<HeldUndo, 'id' | 'due' | 'flushedAt'>>,
    now: number,
  ): Promise<HeldUndo[]> {
    return this.run((list) => {
      const added = entries.map((e) => ({
        ...e,
        id: randomId(9),
        due: now + REASON_WINDOW_MS,
        flushedAt: null,
      }));
      return [[...pruneHeld(list, now), ...added], added];
    });
  }

  /**
   * Take entries that are due (or all unflushed ones for a tab session that is
   * ending), marking them flushed. The caller applies them.
   */
  takeDue(now: number, endingSession?: string): Promise<HeldUndo[]> {
    return this.run((list) => {
      const due = list.filter(
        (h) =>
          h.flushedAt === null &&
          (h.due <= now || h.tabSession === endingSession),
      );
      const ids = new Set(due.map((h) => h.id));
      const next = pruneHeld(
        list.map((h) => (ids.has(h.id) ? { ...h, flushedAt: now } : h)),
        now,
      );
      return [next, due];
    });
  }

  /** A reason chip was answered. */
  reason(
    match: { tabId: number; op: OpId },
    reason: UndoReason,
    now: number,
  ): Promise<ReasonOutcome> {
    return this.run((list) => {
      const { list: next, outcome } = applyReason(list, match, reason, now);
      return [pruneHeld(next, now), outcome];
    });
  }

  /** The earliest time something is due, for scheduling. */
  async nextDue(): Promise<number | null> {
    const pending = (await this.read()).filter((h) => h.flushedAt === null);
    return pending.length ? Math.min(...pending.map((h) => h.due)) : null;
  }

  /** Undo holds for a tab: which ops can still take a reason (the popup's chips). */
  async openFor(
    tabId: number,
    now: number,
  ): Promise<Array<{ op: OpId; until: number }>> {
    return (await this.read())
      .filter(
        (h) =>
          h.tabId === tabId &&
          h.flushedAt === null &&
          h.input.reason === undefined &&
          h.due > now,
      )
      .map((h) => ({ op: h.input.op, until: h.due }));
  }

  async clear(): Promise<void> {
    await this.mutex.run(UNDO_HOLD_KEY, () =>
      this.session.remove([UNDO_HOLD_KEY]).catch(() => undefined),
    );
  }

  /** An explicit turn-on supersedes pending and late reasons for this site. */
  cancel(domain: string, ops: readonly OpId[]): Promise<Set<OpId>> {
    return this.run((list) => {
      const matching = list.filter(
        (h) => h.domain === domain && ops.includes(h.input.op),
      );
      const dropped = new Set(
        matching.filter((h) => h.flushedAt === null).map((h) => h.input.op),
      );
      return [
        list.filter((h) => h.domain !== domain || !ops.includes(h.input.op)),
        dropped,
      ];
    });
  }
}

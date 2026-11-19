'use client';

import type { Point, PointerTrial } from '@webable/core';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { useLatest } from '../shared/hooks';
import { Stage } from '../shared/primitives';
import {
  buildPointerTrial,
  isRepeatPress,
  pointerTypeOf,
  SampleBuffer,
  type Sample,
} from './trial';

export interface FieldTarget {
  /** Centre in stage coordinates (CSS px from the stage's top-left). */
  center: Point;
  sizePx: number;
  /** The first press of a block positions the pointer and is not scored. */
  scored: boolean;
}

export interface TargetFieldProps {
  label: string;
  heightPx: number;
  targets: readonly FieldTarget[];
  /** Changing this restarts the sequence (a new block, or a resume from Pause). */
  runKey: string | number;
  active: boolean;
  onComplete: (trials: PointerTrial[]) => void;
  /** A target was activated with the keyboard instead of pointed at. */
  onKeyboard: () => void;
}

interface Down {
  point: Point;
  t: number;
  pointerId: number;
  pointerType: PointerTrial['pointerType'];
}

function localPoint(el: HTMLElement, clientX: number, clientY: number): Point {
  const rect = el.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/**
 * A stage that shows one filled #111111 circle at a time and records every
 * press and release (cal-motor §5.3): press position decides hit or miss,
 * misses are silent and never redone, a quick second press is logged as a
 * repeat of the last trial. The block restarts if the pointer type changes,
 * the page is hidden or the zoom changes.
 */
export function TargetField({
  label,
  heightPx,
  targets,
  runKey,
  active,
  onComplete,
  onKeyboard,
}: TargetFieldProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const samples = useRef(new SampleBuffer());
  const trials = useRef<PointerTrial[]>([]);
  const down = useRef<Down | null>(null);
  const last = useRef<{ point: Point; t: number } | null>(null);
  const blockType = useRef<PointerTrial['pointerType'] | null>(null);
  const shownAt = useRef<number>(0);
  const [index, setIndex] = useState(0);
  const [restarts, setRestarts] = useState(0);
  const complete = useLatest(onComplete);

  const restart = () => {
    trials.current = [];
    down.current = null;
    blockType.current = null;
    samples.current.clear();
    setIndex(0);
    setRestarts((n) => n + 1);
  };

  // New block (or resume): start over.
  useEffect(() => {
    trials.current = [];
    down.current = null;
    blockType.current = null;
    setIndex(0);
  }, [runKey]);

  // Void the block if the page is hidden or the zoom changes (cal-motor §5.3).
  useEffect(() => {
    const dpr = window.devicePixelRatio;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') restart();
    };
    const onResize = () => {
      if (window.devicePixelRatio !== dpr) restart();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
    };
  }, [runKey]);

  const target = targets[index];
  useEffect(() => {
    shownAt.current = performance.now();
  }, [index, runKey, restarts]);

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = stageRef.current;
    if (!el) return;
    const native = event.nativeEvent;
    const batch: PointerEvent[] =
      typeof native.getCoalescedEvents === 'function'
        ? native.getCoalescedEvents()
        : [];
    const events = batch.length > 0 ? batch : [native];
    for (const e of events) {
      const p = localPoint(el, e.clientX, e.clientY);
      const sample: Sample = { x: p.x, y: p.y, t: e.timeStamp };
      samples.current.push(sample);
    }
    last.current = {
      point: localPoint(el, event.clientX, event.clientY),
      t: event.timeStamp,
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = stageRef.current;
    if (!el || !active || !target || event.button > 0) return;
    const point = localPoint(el, event.clientX, event.clientY);
    const t = event.timeStamp;
    const pointerType = pointerTypeOf(event.pointerType);
    samples.current.push({ x: point.x, y: point.y, t });

    // Switching between mouse and touch mid-block restarts the block.
    if (blockType.current && blockType.current !== pointerType) {
      restart();
      return;
    }
    blockType.current = pointerType;

    // A quick second press is a repeat of the last trial, not a new attempt.
    const previous = trials.current[trials.current.length - 1];
    if (previous) {
      const repeat = isRepeatPress(previous, point, t);
      if (repeat.repeat) {
        previous.extraPresses.push({
          dtMs: repeat.dtMs,
          distPx: repeat.distPx,
          sameTarget: repeat.sameTarget,
        });
        return;
      }
    }
    down.current = { point, t, pointerId: event.pointerId, pointerType };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best effort; release still reaches the stage in most cases.
    }
    event.preventDefault();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = stageRef.current;
    const pressed = down.current;
    if (!el || !pressed || !target || pressed.pointerId !== event.pointerId)
      return;
    down.current = null;
    const up = localPoint(el, event.clientX, event.clientY);
    const tUp = event.timeStamp;
    const previous = trials.current[trials.current.length - 1];
    const start = previous
      ? { point: previous.up, t: previous.tUp }
      : { point: last.current?.point ?? pressed.point, t: shownAt.current };
    const trial = buildPointerTrial(
      {
        targetPx: target.sizePx,
        targetCenter: target.center,
        start: start.point,
        tStart: Math.min(start.t, pressed.t),
        down: pressed.point,
        tDown: pressed.t,
        up,
        tUp,
        pointerType: pressed.pointerType,
        scored: target.scored,
      },
      samples.current.between(pressed.t - 200, tUp),
    );
    trials.current = [...trials.current, trial];
    const next = index + 1;
    if (next >= targets.length) {
      const done = trials.current;
      trials.current = [];
      samples.current.clear();
      complete.current(done);
      return;
    }
    setIndex(next);
  };

  const onPointerCancel = () => {
    down.current = null;
  };

  return (
    <Stage
      ref={stageRef}
      label={label}
      bleed
      heightPx={heightPx}
      className="tn-field"
    >
      <div
        className="tn-field__surface"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {target ? (
          <button
            key={`${runKey}-${restarts}-${index}`}
            type="button"
            className="tn-target"
            aria-label={`Circle ${index + 1} of ${targets.length}`}
            style={{
              insetInlineStart: `${target.center.x - target.sizePx / 2}px`,
              insetBlockStart: `${target.center.y - target.sizePx / 2}px`,
              inlineSize: `${target.sizePx}px`,
              blockSize: `${target.sizePx}px`,
            }}
            onClick={(event) => {
              // detail 0: activated by a key, not a pointer. Never scored.
              if (event.detail === 0) onKeyboard();
            }}
          />
        ) : null}
      </div>
    </Stage>
  );
}

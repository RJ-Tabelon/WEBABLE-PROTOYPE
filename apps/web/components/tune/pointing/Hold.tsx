'use client';

import type { HoldTrial, Point, PointerTrial } from '@webable/core';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { useContentWidth, useLatest } from '../shared/hooks';
import { Deck, Stage, TaskHeading } from '../shared/primitives';
import { KeyboardNote } from './RingScreens';
import {
  buildPointerTrial,
  isHit,
  pointerTypeOf,
  SampleBuffer,
  spreadP95,
} from './trial';

/** Cumulative time inside before the ring is full (cal-motor §5.2, S3). */
const HOLD_MS = 1500;
/** Jitter is measured after this settle time inside the circle. */
const SETTLE_MS = 300;
const HOLDS = 2;
const TAPS = 4;
const HEIGHT = 240;

export interface HoldProps {
  touch: boolean;
  active: boolean;
  epoch: number;
  reducedMotion: boolean;
  onSkip: () => void;
  onDone: (holds: HoldTrial[]) => void;
}

type Phase = 'rest' | 'click';

function localPoint(el: HTMLElement, x: number, y: number): Point {
  const rect = el.getBoundingClientRect();
  return { x: x - rect.left, y: y - rect.top };
}

/**
 * S3 "Hold steady and click" (cal-motor §5.2): rest the pointer inside a 44 px
 * circle until its ring fills (leaving pauses the fill, never fails), then click
 * without moving. Twice. On touch: four taps in the same spot.
 */
export function Hold({
  touch,
  active,
  epoch,
  reducedMotion,
  onSkip,
  onDone,
}: HoldProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useContentWidth(wrap, 640);
  const stageRef = useRef<HTMLDivElement>(null);
  const size = touch ? 56 : 44;
  const center: Point = { x: width / 2, y: HEIGHT / 2 };

  const [phase, setPhase] = useState<Phase>('rest');
  const [progress, setProgress] = useState(0);
  const [count, setCount] = useState(0);
  const [keyboard, setKeyboard] = useState(false);

  const holds = useRef<HoldTrial[]>([]);
  const taps = useRef<PointerTrial[]>([]);
  const inside = useRef(false);
  /** Time inside before the current stay, ms. */
  const insideMs = useRef(0);
  /** When the current stay inside began (event clock), or null when outside. */
  const insideSince = useRef<number | null>(null);
  const exits = useRef(0);
  const entered = useRef(false);
  const jitter = useRef<Point[]>([]);
  const lastPoint = useRef<Point | null>(null);
  const phaseAt = useRef(0);
  const samples = useRef(new SampleBuffer());
  const down = useRef<{ point: Point; t: number; id: number } | null>(null);
  const finish = useLatest(onDone);
  const doneSent = useRef(false);

  const resetHold = () => {
    inside.current = false;
    insideMs.current = 0;
    insideSince.current = null;
    exits.current = 0;
    entered.current = false;
    jitter.current = [];
    setProgress(0);
    setPhase('rest');
  };

  // Pause or a new epoch restarts the current hold.
  useEffect(() => {
    resetHold();
  }, [epoch]);

  /** Cumulative time inside at `now`, counted from event timestamps (not frames). */
  const heldMs = (now: number): number =>
    insideMs.current +
    (insideSince.current === null ? 0 : Math.max(0, now - insideSince.current));

  const enter = (now: number) => {
    if (insideSince.current === null) insideSince.current = now;
  };
  const leave = (now: number) => {
    if (insideSince.current === null) return;
    insideMs.current += Math.max(0, now - insideSince.current);
    insideSince.current = null;
  };

  // Draw the fill each frame, so a perfectly still pointer fills too. Time is
  // real time inside, so a slow or throttled display never slows the task.
  useEffect(() => {
    if (touch || phase !== 'rest' || !active) return;
    let frame = 0;
    const tick = () => {
      const now = performance.now();
      const held = heldMs(now);
      const p = Math.min(1, held / HOLD_MS);
      setProgress(reducedMotion ? Math.floor(p * 4) / 4 : p);
      if (held >= HOLD_MS) {
        phaseAt.current = now;
        setPhase('click');
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Hidden time never counts as holding still.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        leave(performance.now());
        inside.current = false;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // heldMs, enter and leave only read refs.
  }, [touch, phase, active, reducedMotion]);

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = stageRef.current;
    if (!el) return;
    const native = event.nativeEvent;
    const batch =
      typeof native.getCoalescedEvents === 'function'
        ? native.getCoalescedEvents()
        : [];
    for (const e of batch.length > 0 ? batch : [native]) {
      const p = localPoint(el, e.clientX, e.clientY);
      samples.current.push({ ...p, t: e.timeStamp });
      if (phase === 'rest' && active) {
        const now = isHit(p, center, size);
        if (entered.current && inside.current && !now) exits.current += 1;
        if (now) {
          entered.current = true;
          enter(e.timeStamp);
        } else {
          leave(e.timeStamp);
        }
        inside.current = now;
        if (now && heldMs(e.timeStamp) >= SETTLE_MS) jitter.current.push(p);
      }
      lastPoint.current = p;
    }
  };

  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (phase === 'rest' && inside.current) {
      exits.current += 1;
      inside.current = false;
      leave(event.timeStamp);
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = stageRef.current;
    if (!el || !active || event.button > 0) return;
    if (!touch && phase !== 'click') return;
    const point = localPoint(el, event.clientX, event.clientY);
    samples.current.push({ ...point, t: event.timeStamp });
    down.current = { point, t: event.timeStamp, id: event.pointerId };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Best effort.
    }
    event.preventDefault();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = stageRef.current;
    const pressed = down.current;
    if (!el || !pressed || pressed.id !== event.pointerId) return;
    down.current = null;
    const up = localPoint(el, event.clientX, event.clientY);
    const start = lastPoint.current ?? pressed.point;
    const click = buildPointerTrial(
      {
        targetPx: size,
        targetCenter: center,
        start,
        tStart: touch
          ? (taps.current[taps.current.length - 1]?.tUp ?? pressed.t)
          : phaseAt.current,
        down: pressed.point,
        tDown: pressed.t,
        up,
        tUp: event.timeStamp,
        pointerType: pointerTypeOf(event.pointerType),
        scored: true,
      },
      samples.current.between(pressed.t - 200, event.timeStamp),
    );
    if (touch) {
      taps.current = [...taps.current, click];
      setCount(taps.current.length);
      if (taps.current.length >= TAPS && !doneSent.current) {
        doneSent.current = true;
        const spread = spreadP95(taps.current.map((t) => t.down));
        finish.current(
          taps.current.map((t) => ({
            jitterP95Px: spread,
            exits: 0,
            click: t,
          })),
        );
      }
      return;
    }
    holds.current = [
      ...holds.current,
      {
        jitterP95Px: spreadP95(jitter.current),
        exits: exits.current,
        click,
      },
    ];
    setCount(holds.current.length);
    if (holds.current.length >= HOLDS && !doneSent.current) {
      doneSent.current = true;
      finish.current(holds.current);
      return;
    }
    resetHold();
  };

  const ringR = size / 2 + 10;
  const circumference = 2 * Math.PI * ringR;
  const title = touch
    ? 'Tap the circle four times.'
    : 'Rest the pointer on the circle.';
  const deck = touch
    ? 'Tap in the same spot each time.'
    : phase === 'rest'
      ? 'Keep it inside until the ring fills. Moving out only pauses it.'
      : 'Now click it, without moving.';

  return (
    <>
      <TaskHeading>{title}</TaskHeading>
      <Deck live>{deck}</Deck>
      {keyboard ? <KeyboardNote onSkip={onSkip} /> : null}
      <div ref={wrap} className="tn-field-wrap">
        <Stage
          ref={stageRef}
          label="Circle"
          bleed
          heightPx={HEIGHT}
          className="tn-field"
        >
          <div
            className="tn-field__surface"
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              down.current = null;
            }}
          >
            {!touch ? (
              <svg
                className="tn-hold-ring"
                aria-hidden="true"
                width={ringR * 2 + 4}
                height={ringR * 2 + 4}
                style={{
                  insetInlineStart: `${center.x - ringR - 2}px`,
                  insetBlockStart: `${center.y - ringR - 2}px`,
                }}
              >
                <circle
                  cx={ringR + 2}
                  cy={ringR + 2}
                  r={ringR}
                  className="tn-hold-ring__track"
                />
                <circle
                  cx={ringR + 2}
                  cy={ringR + 2}
                  r={ringR}
                  className="tn-hold-ring__fill"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - progress)}
                  transform={`rotate(-90 ${ringR + 2} ${ringR + 2})`}
                />
              </svg>
            ) : null}
            <button
              type="button"
              className="tn-target"
              aria-label={
                touch
                  ? `Circle, tap ${Math.min(count + 1, TAPS)} of ${TAPS}`
                  : `Circle, hold ${Math.min(count + 1, HOLDS)} of ${HOLDS}`
              }
              style={{
                insetInlineStart: `${center.x - size / 2}px`,
                insetBlockStart: `${center.y - size / 2}px`,
                inlineSize: `${size}px`,
                blockSize: `${size}px`,
              }}
              onClick={(event) => {
                if (event.detail === 0) setKeyboard(true);
              }}
            />
          </div>
        </Stage>
      </div>
    </>
  );
}

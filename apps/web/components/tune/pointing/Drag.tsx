'use client';

import { DRAG_TASK, type DragTrial, type Point } from '@webable/core';
import { Button } from '@webable/ui';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { useContentWidth, useLatest } from '../shared/hooks';
import { Deck, Stage, TaskHeading } from '../shared/primitives';
import { distance } from './trial';

const AXES = ['horizontal', 'vertical', 'horizontal'] as const;
/** After this many drops outside the ring, the attempt ends as unfinished. */
const MAX_DROPS = 3;

export interface DragProps {
  touch: boolean;
  active: boolean;
  epoch: number;
  onDone: (drags: DragTrial[] | 'skipped') => void;
}

interface Grab {
  id: number;
  offset: Point;
  entered: boolean;
}

/**
 * S4 optional drag (cal-motor §5.2): a 44 px circle into a 72 px ring 200 px
 * away (160 on touch), three times. "I'd rather not drag" is always there, so
 * nothing requires dragging (WCAG 2.5.7).
 */
export function Drag({ touch, active, epoch, onDone }: DragProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useContentWidth(wrap, 640);
  const stageRef = useRef<HTMLDivElement>(null);
  const gap = touch ? DRAG_TASK.distancePx.touch : DRAG_TASK.distancePx.pointer;
  const height = gap + 128;
  const [attempt, setAttempt] = useState(0);
  const axis = AXES[attempt] ?? 'horizontal';
  const center = { x: width / 2, y: height / 2 };
  const from: Point =
    axis === 'horizontal'
      ? { x: center.x - gap / 2, y: center.y }
      : { x: center.x, y: center.y - gap / 2 };
  const well: Point =
    axis === 'horizontal'
      ? { x: center.x + gap / 2, y: center.y }
      : { x: center.x, y: center.y + gap / 2 };

  const [token, setToken] = useState<Point | null>(null);
  const position = token ?? from;
  const grab = useRef<Grab | null>(null);
  const trial = useRef({ firstDown: 0, grabs: 0, drops: 0, early: false });
  const results = useRef<DragTrial[]>([]);
  const finish = useLatest(onDone);
  const sent = useRef(false);

  const resetAttempt = () => {
    setToken(null);
    grab.current = null;
    trial.current = { firstDown: 0, grabs: 0, drops: 0, early: false };
  };

  useEffect(() => {
    resetAttempt();
  }, [epoch, attempt, width]);

  const record = (success: boolean, tUp: number) => {
    const t = trial.current;
    results.current = [
      ...results.current,
      {
        success,
        earlyRelease: t.early,
        regrabs: Math.max(0, t.grabs - 1),
        moveMs: Math.max(0, Math.round(tUp - t.firstDown)),
      },
    ];
    if (results.current.length >= AXES.length) {
      if (!sent.current) {
        sent.current = true;
        finish.current(results.current);
      }
      return;
    }
    setAttempt((a) => a + 1);
  };

  const local = (event: ReactPointerEvent<HTMLElement>): Point => {
    const rect = stageRef.current?.getBoundingClientRect();
    return rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : { x: 0, y: 0 };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!active || event.button > 0) return;
    const p = local(event);
    if (distance(p, position) > DRAG_TASK.tokenPx / 2) return;
    if (trial.current.grabs === 0) trial.current.firstDown = event.timeStamp;
    trial.current.grabs += 1;
    grab.current = {
      id: event.pointerId,
      offset: { x: p.x - position.x, y: p.y - position.y },
      entered: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Best effort.
    }
    event.preventDefault();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    if (!g || g.id !== event.pointerId) return;
    const p = local(event);
    const next = { x: p.x - g.offset.x, y: p.y - g.offset.y };
    if (distance(next, well) <= DRAG_TASK.wellPx / 2) g.entered = true;
    setToken(next);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    if (!g || g.id !== event.pointerId) return;
    grab.current = null;
    const p = local(event);
    const dropped = { x: p.x - g.offset.x, y: p.y - g.offset.y };
    if (distance(dropped, well) <= DRAG_TASK.wellPx / 2) {
      record(true, event.timeStamp);
      return;
    }
    if (!g.entered) trial.current.early = true;
    trial.current.drops += 1;
    setToken(dropped);
    if (trial.current.drops >= MAX_DROPS) record(false, event.timeStamp);
  };

  return (
    <>
      <TaskHeading>Drag the circle into the ring.</TaskHeading>
      <Deck>
        Optional. You can choose &ldquo;I&rsquo;d rather not drag.&rdquo;
      </Deck>
      <div ref={wrap} className="tn-field-wrap">
        <Stage
          ref={stageRef}
          label="Drag the circle into the ring"
          bleed
          heightPx={height}
          className="tn-field"
        >
          <div
            className="tn-field__surface"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              grab.current = null;
            }}
          >
            <span
              className="tn-well"
              aria-hidden="true"
              style={{
                insetInlineStart: `${well.x - DRAG_TASK.wellPx / 2}px`,
                insetBlockStart: `${well.y - DRAG_TASK.wellPx / 2}px`,
                inlineSize: `${DRAG_TASK.wellPx}px`,
                blockSize: `${DRAG_TASK.wellPx}px`,
              }}
            />
            <span
              className="tn-token"
              aria-hidden="true"
              style={{
                insetInlineStart: `${position.x - DRAG_TASK.tokenPx / 2}px`,
                insetBlockStart: `${position.y - DRAG_TASK.tokenPx / 2}px`,
                inlineSize: `${DRAG_TASK.tokenPx}px`,
                blockSize: `${DRAG_TASK.tokenPx}px`,
              }}
            />
          </div>
        </Stage>
      </div>
      <div className="tn-controls">
        <Button
          variant="secondary"
          size="task"
          onClick={() => {
            if (sent.current) return;
            sent.current = true;
            finish.current('skipped');
          }}
        >
          I&rsquo;d rather not drag
        </Button>
      </div>
    </>
  );
}

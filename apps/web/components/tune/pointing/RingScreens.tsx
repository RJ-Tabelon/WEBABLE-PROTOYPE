'use client';

import {
  nextRingStep,
  type PointerBlock,
  type PointerTrial,
  type RingInput,
} from '@webable/core';
import { Button } from '@webable/ui';
import { useCallback, useRef, useState, type ReactNode } from 'react';

import { useContentWidth } from '../shared/hooks';
import { Deck, TaskHeading } from '../shared/primitives';
import {
  fieldLayout,
  returnBlockTargets,
  ringBlockTargets,
  warmupTargets,
} from './layout';
import { TargetField } from './TargetField';
import { medianMoveMs } from './trial';

/** Express mode starts when the first block's median movement takes longer than this. */
const EXPRESS_MOVE_MS = 2500;

/** Ring start size for the return block and the warm-up size, per input. */
export function startSizeOf(input: RingInput): number {
  return input === 'touch' ? 56 : 44;
}

function useViewport(): { width: number; height: number } {
  const [viewport] = useState(() =>
    typeof window === 'undefined'
      ? { width: 1280, height: 800 }
      : { width: window.innerWidth, height: window.innerHeight },
  );
  return viewport;
}

export function KeyboardNote({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="tn-note" role="status">
      <p className="tn-note__text">
        Using keys? These tasks are for a mouse, trackpad or touch, so you can
        skip them. WebAble never changes how keys work on a page.
      </p>
      <Button variant="secondary" size="task" onClick={onSkip}>
        Skip pointing
      </Button>
    </div>
  );
}

interface FieldScreenProps {
  input: RingInput;
  active: boolean;
  epoch: number;
  onSkip: () => void;
}

function FieldFrame({
  children,
  title,
  deck,
  keyboard,
  onSkip,
}: {
  children: ReactNode;
  title: ReactNode;
  deck: ReactNode;
  keyboard: boolean;
  onSkip: () => void;
}) {
  return (
    <>
      <TaskHeading>{title}</TaskHeading>
      <Deck>{deck}</Deck>
      {keyboard ? <KeyboardNote onSkip={onSkip} /> : null}
      {children}
    </>
  );
}

/** S1 warm-up: three circles in a row at 56 px (72 on touch), not scored. */
export function Warmup({
  input,
  active,
  epoch,
  onSkip,
  onDone,
}: FieldScreenProps & { onDone: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useContentWidth(wrap, 640);
  const [keyboard, setKeyboard] = useState(false);
  const size = input === 'touch' ? 72 : 56;
  const height = 200;
  return (
    <FieldFrame
      title="Click each circle as it appears."
      deck="Take your time. There’s no right speed."
      keyboard={keyboard}
      onSkip={onSkip}
    >
      <div ref={wrap} className="tn-field-wrap">
        <TargetField
          label="Circles"
          heightPx={height}
          targets={warmupTargets(width, height, size)}
          runKey={`warmup-${epoch}`}
          active={active}
          onComplete={() => onDone()}
          onKeyboard={() => setKeyboard(true)}
        />
      </div>
    </FieldFrame>
  );
}

/**
 * S2 adaptive ring (cal-motor §5.2): 1 + 9 presses per block, the next size from
 * `nextRingStep` (core), at most 4 blocks (2 in express mode).
 */
export function Ring({
  input,
  active,
  epoch,
  onSkip,
  onDone,
}: FieldScreenProps & {
  onDone: (blocks: PointerBlock[], express: boolean) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useContentWidth(wrap, 640);
  const viewport = useViewport();
  const layout = fieldLayout(width, viewport, input);
  const [blocks, setBlocks] = useState<PointerBlock[]>([]);
  const [size, setSize] = useState<number>(
    () => nextRingStep(input, []).nextPx ?? startSizeOf(input),
  );
  const [express, setExpress] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const finished = useRef(false);

  const onComplete = useCallback(
    (trials: PointerTrial[]) => {
      if (finished.current) return;
      const next = [...blocks, { targetPx: size, trials }];
      const isExpress =
        express ||
        (next.length === 1 && medianMoveMs(trials) > EXPRESS_MOVE_MS);
      const step = nextRingStep(input, next, { maxBlocks: isExpress ? 2 : 4 });
      if (step.nextPx === null) {
        finished.current = true;
        onDone(next, isExpress);
        return;
      }
      setBlocks(next);
      setExpress(isExpress);
      setSize(step.nextPx);
    },
    [blocks, express, input, onDone, size],
  );

  return (
    <FieldFrame
      title="Keep clicking the circles."
      deck="They change size now and then. Go at a pace that feels comfortable."
      keyboard={keyboard}
      onSkip={onSkip}
    >
      <div ref={wrap} className="tn-field-wrap">
        <TargetField
          label="Circles"
          heightPx={layout.heightPx}
          targets={ringBlockTargets(layout, size)}
          runKey={`ring-${blocks.length}-${epoch}`}
          active={active}
          onComplete={onComplete}
          onKeyboard={() => setKeyboard(true)}
        />
      </div>
    </FieldFrame>
  );
}

/** S5 return block at the starting size (drift check); ends on an easy success. */
export function ReturnBlock({
  input,
  active,
  epoch,
  onSkip,
  onDone,
}: FieldScreenProps & { onDone: (block: PointerBlock) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useContentWidth(wrap, 640);
  const viewport = useViewport();
  const layout = fieldLayout(width, viewport, input);
  const size = startSizeOf(input);
  const [keyboard, setKeyboard] = useState(false);
  return (
    <FieldFrame
      title="A few more circles."
      deck="The same as before, at your own pace."
      keyboard={keyboard}
      onSkip={onSkip}
    >
      <div ref={wrap} className="tn-field-wrap">
        <TargetField
          label="Circles"
          heightPx={layout.heightPx}
          targets={returnBlockTargets(layout, size)}
          runKey={`return-${epoch}`}
          active={active}
          onComplete={(trials) => onDone({ targetPx: size, trials })}
          onKeyboard={() => setKeyboard(true)}
        />
      </div>
    </FieldFrame>
  );
}

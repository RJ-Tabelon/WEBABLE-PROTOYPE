'use client';

import { Button } from '@webable/ui';
import { useRef, useState } from 'react';

import { useContentWidth, useTaskKeys } from '../shared/hooks';
import {
  Deck,
  Stage,
  TaskHeading,
  useStimulusFontReady,
} from '../shared/primitives';
import {
  comfortStartPx,
  maxFitPx,
  MIN_CHARS_LARGE_PRINT,
  STIMULUS_FAMILY,
  stepComfort,
  type StimulusMetrics,
} from './geometry';

const PARAGRAPH =
  'The market opens at eight. Bread comes out of the oven first, then the fruit stalls fill up. By nine the square is busy and warm.';

/** Smallest size offered on this screen, CSS px. */
const MIN_COMFORT_PX = 12;

export interface ComfortProps {
  rootFontPx: number;
  metrics: StimulusMetrics;
  active: boolean;
  onDone: (comfortPx: number) => void;
}

/**
 * V1 "Make this comfortable to read" (cal-vision §3): a paragraph at
 * max(1.5 x default, 24 px) at 21:1, stepped in 0.1 log with - and +.
 */
export function Comfort({ rootFontPx, metrics, active, onDone }: ComfortProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const width = useContentWidth(stageRef, 560);
  const [px, setPx] = useState(() => comfortStartPx(rootFontPx));
  const bounds = {
    minPx: MIN_COMFORT_PX,
    maxPx: Math.max(
      comfortStartPx(rootFontPx),
      maxFitPx(width, metrics.advanceEm, MIN_CHARS_LARGE_PRINT),
    ),
  };
  const smaller = () => setPx((p) => stepComfort(p, -1, bounds));
  const larger = () => setPx((p) => stepComfort(p, 1, bounds));
  const atMin = px <= bounds.minPx + 0.05;
  const atMax = px >= bounds.maxPx - 0.05;

  const fontReady = useStimulusFontReady();

  useTaskKeys({ '-': smaller, _: smaller, '+': larger, '=': larger }, active);

  return (
    <>
      <TaskHeading>Make this comfortable to read.</TaskHeading>
      <Deck>Make it easy to read. The + and &minus; keys work too.</Deck>
      {/* Above the stage, so the buttons never move under the pointer. */}
      <div className="tn-controls">
        <div className="tn-controls__pair" role="group" aria-label="Text size">
          <Button
            variant="secondary"
            size="task"
            iconStart="minus"
            onClick={smaller}
            disabled={atMin}
            aria-keyshortcuts="-"
          >
            Smaller
          </Button>
          <Button
            variant="secondary"
            size="task"
            iconStart="plus"
            onClick={larger}
            disabled={atMax}
            aria-keyshortcuts="+"
          >
            Larger
          </Button>
        </div>
      </div>
      <Stage ref={stageRef} label="Sample text" className="tn-stage--comfort">
        {fontReady ? (
          <p
            className="tn-stimulus tn-stimulus-text"
            style={{
              fontFamily: STIMULUS_FAMILY,
              fontSize: `${px}px`,
              lineHeight: 1.35,
            }}
          >
            {PARAGRAPH}
          </p>
        ) : null}
      </Stage>
      <div className="tn-controls">
        <Button
          variant="primary"
          size="task"
          onClick={() => onDone(px)}
          arrow="forward"
        >
          This is comfortable
        </Button>
      </div>
    </>
  );
}

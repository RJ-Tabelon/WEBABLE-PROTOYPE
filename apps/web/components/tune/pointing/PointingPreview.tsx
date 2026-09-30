'use client';

import { TARGET_LADDER } from '@webable/core';
import { Button } from '@webable/ui';
import { useState, type CSSProperties } from 'react';

import { changeValue, FitLine, PlainLine } from '../shared/fit';
import { Deck, OptionGroup, TaskHeading } from '../shared/primitives';

export interface PointingPreviewProps {
  /** S* from the ring, or null when nothing was measured. */
  recommendedPx: number | null;
  touch: boolean;
  onDone: (chosenPx: number) => void;
}

const NBSP = '\u00a0';
/** What sites give a click area when nothing changes it (the fit rows' "before"). */
export const SITE_TARGET_PX = 24;

/** S* and one ladder level either side (cal-motor S6). */
export function previewSizes(recommended: number, touch: boolean): number[] {
  const ladder = (
    touch ? TARGET_LADDER.slice(1) : TARGET_LADDER.slice(0, 5)
  ) as readonly number[];
  let i = ladder.indexOf(recommended);
  if (i < 0) {
    i = ladder.reduce(
      (best, v, idx) =>
        Math.abs(v - recommended) < Math.abs((ladder[best] ?? v) - recommended)
          ? idx
          : best,
      0,
    );
  }
  const start = Math.min(Math.max(0, i - 1), Math.max(0, ladder.length - 3));
  return ladder.slice(start, start + 3);
}

/** Sample controls at one target size: a row of actions, a list of links and a small form. */
export function SampleControls({ sizePx }: { sizePx: number }) {
  const style = { '--tn-t': `${sizePx}px` } as CSSProperties;
  return (
    <div className="tn-sample-ui" style={style} aria-hidden="true">
      <div className="tn-sample-ui__toolbar">
        {['Reply', 'Share', 'Save'].map((label) => (
          <span key={label} className="tn-sample-ui__tool">
            {label}
          </span>
        ))}
      </div>
      <ul className="tn-sample-ui__links">
        {['Order history', 'Saved items', 'Returns', 'Help'].map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
      <div className="tn-sample-ui__form">
        <span className="tn-sample-ui__input">Search</span>
        <span className="tn-sample-ui__button">Go</span>
      </div>
    </div>
  );
}

/**
 * S6 "Choose a comfortable size": the same sample page at S* and one level
 * either side. The choice never denies more room (deriveFitProfile).
 */
export function PointingPreview({
  recommendedPx,
  touch,
  onDone,
}: PointingPreviewProps) {
  const recommended = recommendedPx ?? (touch ? 56 : 44);
  const sizes = previewSizes(recommended, touch);
  const [size, setSize] = useState(
    String(sizes.includes(recommended) ? recommended : (sizes[1] ?? sizes[0])),
  );
  const px = Number(size);
  return (
    <>
      <TaskHeading>Choose a comfortable size.</TaskHeading>
      <Deck>Pick the size that looks easiest to click on this device.</Deck>
      <OptionGroup
        legend="Click area size"
        hideLegend
        options={sizes.map((n) => ({
          value: String(n),
          label: `${n}${NBSP}px`,
        }))}
        value={size}
        onChange={setSize}
      />
      <div className="tn-preview">
        <p className="tn-preview__value" aria-live="polite">
          {px === SITE_TARGET_PX ? (
            <PlainLine
              label="Click targets"
              value={px}
              unit="px"
              spoken={`${px} pixels`}
            />
          ) : (
            <FitLine
              label="Click targets"
              value={changeValue(SITE_TARGET_PX, px, 'px')}
            />
          )}
        </p>
        <div className="tn-preview__frame tn-preview__frame--page">
          <SampleControls sizePx={px} />
        </div>
      </div>
      <div className="tn-controls">
        <Button
          variant="primary"
          size="task"
          arrow="forward"
          onClick={() => onDone(px)}
        >
          Use this size
        </Button>
      </div>
    </>
  );
}

'use client';

import type { Polarity, ReadingSession, VisionFit } from '@webable/core';
import { Button, SegmentedControl, SwitchRow } from '@webable/ui';
import { useState, type CSSProperties } from 'react';

import { changeValue, FitLine, PlainLine } from '../shared/fit';
import {
  Deck,
  OptionGroup,
  TaskHeading,
  type ChoiceOption,
} from '../shared/primitives';
import { stepComfort } from './geometry';

export interface ReadingPreviewProps {
  /** The vision fit derived from this Tune so far (before any nudge). */
  vision: VisionFit;
  rootFontPx: number;
  onDone: (overrides: ReadingSession['overrides']) => void;
}

const COLORS: ReadonlyArray<ChoiceOption<Polarity>> = [
  { value: 'none', label: 'Site' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Page colours for the preview frame: a page, not WebAble's own surface. */
export function polarityColors(polarity: Polarity): CSSProperties {
  if (polarity === 'dark') return { background: '#121212', color: '#EDEDED' };
  if (polarity === 'light') return { background: '#FFFFFF', color: '#111111' };
  return { background: '#FFFFFF', color: '#3D3D3D' };
}

export function SampleArticle({ style }: { style: CSSProperties }) {
  return (
    <article className="tn-sample-article" style={style}>
      <p className="tn-sample-article__kicker">Neighborhood</p>
      <h2 className="tn-sample-article__title">
        The community garden opens for spring
      </h2>
      <p>
        Plots at the corner of Elm and Fifth open on Saturday. Each plot comes
        with a water tap, a compost bin and a small shed for tools.
      </p>
      <p>
        New gardeners can join a free class on the first Sunday of each month.
        Bring gloves and a hat; seeds and soil are provided.
      </p>
    </article>
  );
}

/**
 * V5 preview and nudge (cal-vision §3): the person's text as pages will show
 * it, beside the original, with bigger/smaller, colours and more spacing. Any
 * nudge becomes an explicit override.
 */
export function ReadingPreview({
  vision,
  rootFontPx,
  onDone,
}: ReadingPreviewProps) {
  const derivedPx = Math.max(vision.textMinPx.value, rootFontPx);
  const derivedSpacing = vision.lineHeight.value >= 1.8;
  const [view, setView] = useState<'original' | 'fitted'>('fitted');
  const [textPx, setTextPx] = useState(derivedPx);
  const [polarity, setPolarity] = useState<Polarity>(vision.polarity.value);
  const [moreSpacing, setMoreSpacing] = useState(derivedSpacing);

  const bounds = { minPx: rootFontPx, maxPx: 96 };
  const fitted = view === 'fitted';
  const lineHeight = moreSpacing
    ? Math.max(1.8, vision.lineHeight.value)
    : Math.min(vision.lineHeight.value, 1.6);
  const style: CSSProperties = fitted
    ? {
        ...polarityColors(polarity),
        fontSize: `${Math.round(textPx)}px`,
        lineHeight,
        wordSpacing: moreSpacing ? '0.16em' : undefined,
      }
    : {
        ...polarityColors('none'),
        fontSize: `${rootFontPx}px`,
        lineHeight: 1.5,
      };

  const finish = () => {
    const overrides: ReadingSession['overrides'] = {};
    if (Math.abs(textPx - derivedPx) >= 0.5)
      overrides.textPx = Math.round(textPx);
    if (polarity !== vision.polarity.value) overrides.polarity = polarity;
    if (moreSpacing !== derivedSpacing) overrides.moreSpacing = moreSpacing;
    onDone(overrides);
  };

  const shownPx = Math.round(textPx);
  return (
    <>
      <TaskHeading>Here&rsquo;s your text.</TaskHeading>
      <Deck>This is how running text will read on pages.</Deck>
      <div className="tn-preview">
        <div className="tn-preview__bar">
          <p className="tn-preview__value" aria-live="polite">
            {fitted && shownPx !== rootFontPx ? (
              <FitLine
                label="Text size"
                value={changeValue(rootFontPx, shownPx, 'px')}
              />
            ) : (
              <PlainLine
                label="Text size"
                value={fitted ? shownPx : rootFontPx}
                unit="px"
                spoken={`${fitted ? shownPx : rootFontPx} pixels`}
              />
            )}
          </p>
          <SegmentedControl<'original' | 'fitted'>
            label="Show"
            value={view}
            onValueChange={setView}
            options={[
              { value: 'original', label: 'Original' },
              { value: 'fitted', label: 'Fitted' },
            ]}
          />
        </div>
        <div className="tn-preview__frame">
          <SampleArticle style={style} />
        </div>
      </div>
      <div className="tn-adjust-grid">
        <div className="tn-controls__pair" role="group" aria-label="Text size">
          <Button
            variant="secondary"
            size="task"
            iconStart="minus"
            disabled={textPx <= bounds.minPx + 0.05}
            onClick={() => {
              setView('fitted');
              setTextPx((p) => stepComfort(p, -1, bounds));
            }}
          >
            Smaller
          </Button>
          <Button
            variant="secondary"
            size="task"
            iconStart="plus"
            disabled={textPx >= bounds.maxPx - 0.05}
            onClick={() => {
              setView('fitted');
              setTextPx((p) => stepComfort(p, 1, bounds));
            }}
          >
            Larger
          </Button>
        </div>
        <OptionGroup<Polarity>
          legend="Colors"
          options={COLORS}
          value={polarity}
          onChange={(v) => {
            setView('fitted');
            setPolarity(v);
          }}
        />
        <div className="tn-adjust-grid__row">
          <SwitchRow
            label="More spacing"
            description="More room between lines and words."
            checked={moreSpacing}
            onCheckedChange={(v) => {
              setView('fitted');
              setMoreSpacing(v);
            }}
            changesPage
          />
        </div>
      </div>
      <div className="tn-controls">
        <Button variant="primary" size="task" arrow="forward" onClick={finish}>
          Looks good
        </Button>
      </div>
    </>
  );
}

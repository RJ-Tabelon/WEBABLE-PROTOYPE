'use client';

import { FitMark, SegmentedControl, StatusShape } from '@webable/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { FrameChrome } from './Frame';
import { claimHeroDraw, sessionStore } from './hero-draw';
import {
  HERO_FIT,
  ORIGINAL_FIT,
  adaptedStatus,
  marksFor,
  type MarkId,
} from './sample/model';
import { SamplePage } from './sample/SamplePage';

type View = 'original' | 'fitted';

const VIEW_OPTIONS = [
  { value: 'original', label: 'Original' },
  { value: 'fitted', label: 'Fitted' },
] as const;

/** Every change the hero fit makes gets a mark: exactly three (design-final §14). */
const HERO_MARKS: readonly MarkId[] = marksFor(HERO_FIT).map((m) => m.id);

/** The same three values in the order §14 lists them, for the list beside the picture. */
const LEGEND_ORDER: readonly MarkId[] = ['text', 'targets', 'motion'];
const HERO_LEGEND = [...marksFor(HERO_FIT)].sort(
  (a, b) => LEGEND_ORDER.indexOf(a.id) - LEGEND_ORDER.indexOf(b.id),
);

const FITTED_ANNOUNCEMENT = `Fitted. ${marksFor(HERO_FIT)
  .map((m) => m.spoken)
  .join('. ')}.`;

/** "Adapted · 3 changes": the word, then the count, which shows at ≥48em. */
const [ADAPTED_WORD, ADAPTED_COUNT] = adaptedStatus(HERO_FIT).split(' · ');

/**
 * The hero's live product picture: a real sample page in a radius-20 frame with an
 * Original / Fitted control. Fitted applies the hero fit (13 to 18 px text, 24 to 44
 * px targets, 3 to 0 moving things), and its three fit marks draw once per session.
 * Static under reduced motion.
 */
export function HeroDemo() {
  const [view, setView] = useState<View>('fitted');
  // Server render and first paint draw; a later mount in the same session is static.
  const [markMode, setMarkMode] = useState<'draw' | 'static'>('draw');
  // Whether the plates fit on the page; null until measured (CSS guesses from width).
  const [compact, setCompact] = useState<boolean | null>(null);
  const captionId = useId();

  // Decide once per mount; the ref keeps Strict Mode's second effect run from
  // mistaking this mount's own flag for an earlier draw.
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current) return;
    decided.current = true;
    if (!claimHeroDraw(sessionStore())) setMarkMode('static');
  }, []);

  const fitted = view === 'fitted';

  return (
    <figure
      className="ws-demo ws-demo--hero"
      aria-labelledby={captionId}
      data-compact={compact === null ? undefined : String(compact)}
    >
      <div className="ws-demo__control">
        <SegmentedControl<View>
          label="Show the sample page"
          options={VIEW_OPTIONS}
          value={view}
          onValueChange={(next) => {
            setView(next);
            // The draw belongs to the first Fitted view only.
            if (next === 'original') setMarkMode('static');
          }}
        />
      </div>
      <div className="ws-frame">
        <FrameChrome
          status={
            fitted ? (
              <>
                <StatusShape
                  state="adapted"
                  size={16}
                  className="ws-frame__glyph"
                />
                <span>
                  {ADAPTED_WORD}
                  <span className="ws-frame__status-more">
                    {` · ${ADAPTED_COUNT}`}
                  </span>
                </span>
              </>
            ) : (
              // No glyph: the page is as the site made it, not paused (§7.13).
              <span>As the site made it</span>
            )
          }
        />
        <div className="ws-frame__view ws-frame__view--hero" data-theme="light">
          <SamplePage
            fit={fitted ? HERO_FIT : ORIGINAL_FIT}
            marks={fitted ? HERO_MARKS : []}
            markMode={markMode}
            showHitAreas
            onMarksCompact={setCompact}
          />
        </div>
      </div>

      {/*
        Where the page is too narrow for plates, the values sit under the frame
        as inline fit marks (§7.20: plates are for marks over a picture).
      */}
      {fitted ? (
        <ul
          role="list"
          className="ws-fit__marks ws-demo__legend"
          aria-hidden="true"
        >
          {HERO_LEGEND.map((m) => (
            <li key={m.id}>
              <FitMark label={m.label} from={m.from} to={m.to} unit={m.unit} />
            </li>
          ))}
        </ul>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {fitted
          ? FITTED_ANNOUNCEMENT
          : 'Original. The page as the site made it.'}
      </p>
      <figcaption id={captionId} className="ws-demo__caption">
        A sample page, fitted to one person’s Tune.
      </figcaption>
    </figure>
  );
}

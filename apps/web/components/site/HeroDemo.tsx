'use client';

import { SegmentedControl, StatusShape } from '@webable/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { FrameChrome } from './Frame';
import { claimHeroDraw, sessionStore } from './hero-draw';
import {
  HERO_FIT,
  ORIGINAL_FIT,
  changeCount,
  marksFor,
  type MarkId,
} from './sample/model';
import { SamplePage } from './sample/SamplePage';

type View = 'original' | 'fitted';

const VIEW_OPTIONS = [
  { value: 'original', label: 'Original' },
  { value: 'fitted', label: 'Fitted' },
] as const;

const HERO_MARKS: readonly MarkId[] = ['motion', 'targets', 'text'];

const FITTED_ANNOUNCEMENT = `Fitted. ${marksFor(HERO_FIT)
  .map((m) => m.spoken)
  .join('. ')}.`;

/**
 * The hero's live product picture: a real sample page in a radius-20 frame with an
 * Original / Fitted control. Fitted applies the hero fit (13 to 18 px text, 24 to 44
 * px targets, 3 to 0 moving parts, a softer side column), and its three fit marks draw
 * once per session. Static under reduced motion.
 */
export function HeroDemo() {
  const [view, setView] = useState<View>('fitted');
  // Server render and first paint draw; a later mount in the same session is static.
  const [markMode, setMarkMode] = useState<'draw' | 'static'>('draw');
  const captionId = useId();
  const statusId = useId();

  // Decide once per mount; the ref keeps Strict Mode's second effect run from
  // mistaking this mount's own flag for an earlier draw.
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current) return;
    decided.current = true;
    if (!claimHeroDraw(sessionStore())) setMarkMode('static');
  }, []);

  const fit = view === 'fitted' ? HERO_FIT : ORIGINAL_FIT;
  const count = changeCount(HERO_FIT);

  return (
    <figure className="ws-demo ws-demo--hero" aria-labelledby={captionId}>
      <div className="ws-frame">
        <FrameChrome
          status={
            view === 'fitted' ? (
              <>
                <StatusShape
                  state="adapted"
                  size={16}
                  className="ws-frame__glyph"
                />
                <span>Adapted · {count} changes</span>
              </>
            ) : (
              <>
                <StatusShape
                  state="paused"
                  size={16}
                  className="ws-frame__glyph"
                />
                <span>As the site made it</span>
              </>
            )
          }
          control={
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
          }
        />
        <div className="ws-frame__view ws-frame__view--hero" data-theme="light">
          <SamplePage
            fit={fit}
            marks={view === 'fitted' ? HERO_MARKS : []}
            markMode={markMode}
            showHitAreas
          />
        </div>
      </div>

      <p id={statusId} className="sr-only" aria-live="polite">
        {view === 'fitted'
          ? FITTED_ANNOUNCEMENT
          : 'Original. The page as the site made it.'}
      </p>
      <figcaption id={captionId} className="ws-demo__caption">
        A sample page, drawn live. Switch between the page as its site made it
        and as WebAble fits it.
      </figcaption>
    </figure>
  );
}

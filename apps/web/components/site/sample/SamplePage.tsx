import type { CSSProperties, ReactNode } from 'react';
import { SiteFitMark } from '../SiteFitMark';
import {
  SAMPLE_ORIGINAL,
  describeSample,
  marksFor,
  type MarkId,
  type SampleFit,
  type SampleMark,
} from './model';

export interface SamplePageProps {
  fit: SampleFit;
  /** Block fit marks drawn on the page (the hero shows text, targets and motion). */
  marks?: readonly MarkId[];
  /** `draw` runs the one-time draw; `static` shows the marks already drawn. */
  markMode?: 'draw' | 'static';
  /** Show the ghost-and-fit pair around small controls when their hit area grows. */
  showHitAreas?: boolean;
  /** Id for the element holding the spoken description. */
  descriptionId?: string;
  className?: string;
}

type SampleStyle = CSSProperties & Record<`--s-${string}`, string>;

/** CSS custom properties that carry the fit into the sample's own stylesheet. */
function sampleStyle(fit: SampleFit): SampleStyle {
  const o = SAMPLE_ORIGINAL;
  const style: SampleStyle = {};
  if (fit.textFloorPx !== null) style['--s-floor'] = `${fit.textFloorPx}px`;
  style['--s-lh'] = String(fit.lineHeight ?? o.lineHeight);
  style['--s-hit'] = `${Math.max(fit.targetPx ?? o.targetPx, o.targetPx)}px`;
  style['--s-gap'] = `${o.targetGapPx + (fit.targetSpacingPx ?? 0)}px`;
  if (fit.railOpacity !== null) style['--s-rail'] = String(fit.railOpacity);
  return style;
}

/**
 * A self-contained sample web page ("news.example.com") drawn in HTML and CSS, in
 * its own `ws-sample` class scope, and the changes a fit makes to it. It is a
 * picture made of real text: nothing inside is interactive, and screen readers
 * hear one description of the page and its changes instead of the fake content.
 */
export function SamplePage({
  fit,
  marks = [],
  markMode = 'static',
  showHitAreas = false,
  descriptionId,
  className,
}: SamplePageProps) {
  const changes = marksFor(fit);
  const byId = new Map<MarkId, SampleMark>(changes.map((m) => [m.id, m]));
  const shown = (id: MarkId): SampleMark | undefined =>
    marks.includes(id) ? byId.get(id) : undefined;
  const hitsGrow =
    fit.targetPx !== null && fit.targetPx > SAMPLE_ORIGINAL.targetPx;

  const textMark = shown('text');
  const targetMark = shown('targets');
  const motionMark = shown('motion');

  return (
    <div
      className={['ws-sample', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={describeSample(fit)}
      aria-describedby={descriptionId}
      data-floor={fit.textFloorPx !== null ? '' : undefined}
      data-calm={fit.calmMotion ? '' : undefined}
      data-rail={fit.railOpacity !== null ? '' : undefined}
      data-focus={fit.focusView ? '' : undefined}
      data-hits={showHitAreas && hitsGrow ? '' : undefined}
      data-annotated={textMark || targetMark || motionMark ? '' : undefined}
      style={sampleStyle(fit)}
    >
      <div className="ws-sample__page">
        <div className="ws-sample__top">
          <p className="ws-sample__brand">The Weekend Ledger</p>
          <p className="ws-sample__nav">
            <span>News</span>
            <span>Local</span>
            <span>Food</span>
            <span>Travel</span>
            <span>Sport</span>
          </p>
          <span className="ws-sample__subscribe">Subscribe</span>
        </div>

        <div className="ws-sample__promo">
          <div className="ws-sample__promo-inner">
            <span className="ws-sample__badge">
              <span className="ws-sample__badge-dot" />
              Sale
            </span>
            <span className="ws-sample__carousel">
              <span className="ws-sample__slides">
                <span>Print edition 40% off this week</span>
                <span>Free delivery on weekend papers</span>
                <span>Try the new crossword app</span>
                <span>Print edition 40% off this week</span>
              </span>
            </span>
            <span className="ws-sample__countdown">
              Ends in 02:14:0
              <span className="ws-sample__digit">
                <span className="ws-sample__digits">9876543210</span>
              </span>
            </span>
            {motionMark ? (
              <SiteFitMark
                {...markProps(motionMark)}
                side="below"
                mode={markMode}
                className="ws-sample__mark ws-sample__mark--motion"
              />
            ) : null}
          </div>
        </div>

        <div className="ws-sample__body">
          <div className="ws-sample__main">
            <p className="ws-sample__kicker">Local</p>
            <p className="ws-sample__headline">
              The library adds Sunday hours this winter
            </p>
            <p className="ws-sample__byline">By Ana Ruiz · 6 min read</p>
            <div className="ws-sample__tools">
              <SampleIcon kind="share" />
              <SampleIcon kind="save" />
              <SampleIcon kind="print" />
              {targetMark ? (
                <SiteFitMark
                  {...markProps(targetMark)}
                  orientation="v"
                  side="end"
                  mode={markMode}
                  className="ws-sample__mark ws-sample__mark--targets"
                />
              ) : null}
            </div>
            <div className="ws-sample__copy">
              {textMark ? (
                <SiteFitMark
                  {...markProps(textMark)}
                  mode={markMode}
                  className="ws-sample__mark ws-sample__mark--text"
                />
              ) : null}
              <p>
                From next month, the central library will open from noon to five
                on Sundays until the end of March. The change follows a year of
                requests from readers who work during the week.
              </p>
              <p>
                The extra hours cover the reading room, the children’s floor and
                the computer lab. Returns go to the front desk, and the café
                stays closed.
              </p>
              <p>
                Card holders can book study rooms online up to a week ahead. The
                library still needs volunteers for Sunday shifts, and training
                starts in two weeks.
              </p>
              <p>
                The library board will look at the Sunday hours again in April.
                Readers can leave comments at the front desk or on the library’s
                website.
              </p>
            </div>
          </div>

          <div className="ws-sample__rail">
            <p className="ws-sample__rail-head">Most read</p>
            <ol className="ws-sample__list">
              <li>Ferry timetable changes for the holidays</li>
              <li>Where to find the best winter soup in town</li>
              <li>New bike lanes open on Harbour Road</li>
              <li>Weekend weather: clear skies, cold nights</li>
            </ol>
            <div className="ws-sample__ad">
              <span>Advertisement</span>
            </div>
            <p className="ws-sample__rail-head">Get the morning briefing</p>
            <div className="ws-sample__signup">
              <span className="ws-sample__input">Email address</span>
              <span className="ws-sample__go">Sign up</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function markProps(m: SampleMark) {
  return { label: m.label, from: m.from, to: m.to, unit: m.unit };
}

function SampleIcon({ kind }: { kind: 'share' | 'save' | 'print' }): ReactNode {
  const paths: Record<typeof kind, string> = {
    share: 'M7 17 17 7M9 7h8v8',
    save: 'M7 4h10v16l-5-4-5 4Z',
    print: 'M7 9V4h10v5M7 17H5v-7h14v7h-2M8 14h8v6H8Z',
  };
  return (
    <span className="ws-sample__icon" data-kind={kind}>
      <svg viewBox="0 0 24 24" width="14" height="14" focusable="false">
        <path d={paths[kind]} />
      </svg>
    </span>
  );
}

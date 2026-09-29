'use client';

import type { FindTextPassage } from '@webable/core/calibration/stimuli';
import { passageLayout } from '@webable/core/calibration/stimuli';
import { cx } from '@webable/ui';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import type {
  Clutter,
  FlowSpec,
  MotionCondition,
  MotionSource,
  Template,
} from './plan';

/**
 * Mock pages drawn inside the stage for the Focus tasks (cal-attention §4).
 * Greyscale, fixed page colours, sizes in em of a px base so thumbnails scale.
 * Motion appears only on animated trials, never under reduced motion, never
 * above 3 Hz and never flashing; the Stop motion control ends it for good.
 */

/** Ticker speed, CSS px per second. */
const TICKER_PX_PER_S = 40;
const SLIDE_EVERY_MS = 3000;

function useCarousel(
  count: number,
  moving: boolean,
  firstAdvanceMs: number,
): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!moving || count < 2) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      setIndex((i) => (i + 1) % count);
      interval = setInterval(
        () => setIndex((i) => (i + 1) % count),
        SLIDE_EVERY_MS,
      );
    }, firstAdvanceMs);
    return () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    };
  }, [count, moving, firstAdvanceMs]);
  return index;
}

function Ticker({ text, moving }: { text: string; moving: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [duration, setDuration] = useState(20);
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0;
    if (w > 0) setDuration(Math.max(8, w / TICKER_PX_PER_S));
  }, [text]);
  return (
    <div className="tn-mock__ticker">
      <div
        className={cx(
          'tn-mock__ticker-track',
          moving && 'tn-mock__ticker-track--moving',
        )}
        style={{ animationDuration: `${duration}s` } as CSSProperties}
      >
        <span ref={ref}>{text}&emsp;·&emsp;</span>
        <span aria-hidden="true">{text}&emsp;·&emsp;</span>
      </div>
    </div>
  );
}

export interface MockPageProps {
  template: Template;
  clutter: Clutter;
  motion: MotionCondition;
  /** Active motion sources (animated trials, before Stop motion). */
  sources: readonly MotionSource[];
  mirror: boolean;
  links: readonly string[];
  target?: string;
  firstAdvanceMs?: number;
  /** Outline the target after the search ceiling (neutral reveal). */
  reveal?: boolean;
  onPick?: (label: string) => void;
  /** Thumbnails are inert pictures. */
  interactive?: boolean;
  basePx?: number;
}

const BADGE_SLOTS = [1, 4, 7, 10];

export function MockPage({
  template,
  clutter,
  motion,
  sources,
  mirror,
  links,
  target,
  firstAdvanceMs = 1000,
  reveal = false,
  onPick,
  interactive = true,
  basePx = 16,
}: MockPageProps) {
  const busy = clutter === 'busy';
  const carouselMoving = motion === 'animated' && sources.includes('carousel');
  const tickerMoving = motion === 'animated' && sources.includes('ticker');
  const badgeMoving = motion === 'animated' && sources.includes('badge');
  const slide = useCarousel(
    template.slides.length,
    carouselMoving,
    firstAdvanceMs,
  );

  return (
    <div
      className={cx('tn-mock', busy ? 'tn-mock--busy' : 'tn-mock--clean')}
      data-mirror={mirror || undefined}
      style={{ fontSize: `${basePx}px` }}
    >
      <header className="tn-mock__header">
        <span className="tn-mock__logo">{template.site}</span>
        <span className="tn-mock__nav" aria-hidden="true">
          {template.nav.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </span>
        {busy ? (
          <span className="tn-mock__pill" aria-hidden="true">
            Sign in
          </span>
        ) : null}
      </header>
      <Ticker text={template.ticker} moving={tickerMoving} />
      <div className="tn-mock__body">
        <div className="tn-mock__main">
          <div className="tn-mock__hero" aria-hidden="true">
            <div
              className={cx(
                'tn-mock__slides',
                carouselMoving && 'tn-mock__slides--moving',
              )}
              style={{ transform: `translateX(${-slide * 100}%)` }}
            >
              {template.slides.map((s) => (
                <div key={s} className="tn-mock__slide">
                  <span className="tn-mock__slide-img" />
                  <span>{s}</span>
                </div>
              ))}
            </div>
            <span
              className={cx(
                'tn-mock__live',
                badgeMoving && 'tn-mock__live--moving',
              )}
            >
              {template.badges[0] ?? 'New'}
            </span>
          </div>
          {motion === 'salient' ? (
            <div className="tn-mock__salient" aria-hidden="true">
              <strong>{template.promo}</strong>
              <span>Today only</span>
            </div>
          ) : null}
          {busy ? (
            <div className="tn-mock__promos" aria-hidden="true">
              {template.side.map((s, i) => (
                <span key={s} className={`tn-mock__promo tn-mock__promo--${i}`}>
                  <span className="tn-mock__promo-img" />
                  {s}
                </span>
              ))}
            </div>
          ) : null}
          <h2 className="tn-mock__heading">{template.heading}</h2>
          <ul className="tn-mock__links">
            {links.map((label, i) => (
              <li key={label} className="tn-mock__item">
                {busy ? (
                  <span className="tn-mock__thumb" aria-hidden="true" />
                ) : null}
                <button
                  type="button"
                  className="tn-mock__link"
                  data-reveal={reveal && label === target ? '' : undefined}
                  tabIndex={interactive ? undefined : -1}
                  onClick={() => onPick?.(label)}
                >
                  {label}
                </button>
                {busy && BADGE_SLOTS.includes(i) && label !== target ? (
                  <span className="tn-mock__badge" aria-hidden="true">
                    {template.badges[i % template.badges.length]}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        {busy ? (
          <aside className="tn-mock__side" aria-hidden="true">
            <span className="tn-mock__ad">
              <strong>{template.promo}</strong>
            </span>
            {template.side.map((s) => (
              <span key={s} className="tn-mock__side-item">
                <span className="tn-mock__side-img" />
                {s}
              </span>
            ))}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Task B: a small flow page with its action row ---------- */

export interface FlowPageProps {
  flow: FlowSpec;
  hierarchy: 'weak' | 'strong';
  decoyFirst: boolean;
  onPick?: (which: 'target' | 'decoy' | 'other') => void;
  interactive?: boolean;
  basePx?: number;
  site?: string;
}

export function FlowPage({
  flow,
  hierarchy,
  decoyFirst,
  onPick,
  interactive = true,
  basePx = 16,
  site = 'Northwind',
}: FlowPageProps) {
  const button = (
    label: string,
    which: 'target' | 'decoy' | 'other',
    tone: string,
  ) => (
    <button
      key={label}
      type="button"
      className={cx('tn-flow__btn', `tn-flow__btn--${tone}`)}
      tabIndex={interactive ? undefined : -1}
      onClick={() => onPick?.(which)}
    >
      {label}
    </button>
  );
  const others = flow.others.map((o) => button(o, 'other', 'plain'));
  let row: ReactNode;
  if (hierarchy === 'weak') {
    // Equal weight for every real action; a salient decoy right beside the target.
    const pair = decoyFirst
      ? [
          button(flow.decoy, 'decoy', 'salient'),
          button(flow.target, 'target', 'plain'),
        ]
      : [
          button(flow.target, 'target', 'plain'),
          button(flow.decoy, 'decoy', 'salient'),
        ];
    row = (
      <div className="tn-flow__actions">
        {others}
        {pair}
      </div>
    );
  } else {
    row = (
      <>
        <div className="tn-flow__actions">
          {button(flow.target, 'target', 'primary')}
          {others}
        </div>
        <div className="tn-flow__aside">
          {button(flow.decoy, 'decoy', 'quiet')}
        </div>
      </>
    );
  }
  return (
    <div className="tn-mock tn-flow" style={{ fontSize: `${basePx}px` }}>
      <header className="tn-mock__header">
        <span className="tn-mock__logo">{site}</span>
      </header>
      <div className="tn-flow__body">
        <h2 className="tn-flow__title">{flow.title}</h2>
        <ul className="tn-flow__lines">
          {flow.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {row}
      </div>
    </div>
  );
}

/* ---------- Task C: passage in dense or chunked format ---------- */

export interface TextPageProps {
  passage: FindTextPassage;
  format: 'dense' | 'chunked';
  /** Pointer mode: sentences are clickable. */
  onPickSentence?: (index: number) => void;
  basePx?: number;
}

export function TextPage({
  passage,
  format,
  onPickSentence,
  basePx = 16,
}: TextPageProps) {
  const layout = passageLayout(passage, format);
  return (
    <div
      className={cx('tn-mock', 'tn-text', `tn-text--${format}`)}
      style={{ fontSize: `${basePx}px` }}
    >
      {layout.heading ? (
        <h2 className="tn-text__heading">{layout.heading}</h2>
      ) : null}
      {layout.paragraphs.map((paragraph, p) => (
        <p key={p} className="tn-text__para">
          {paragraph.map((sentence) => (
            <span
              key={sentence.index}
              className={cx(
                'tn-sentence',
                onPickSentence && 'tn-sentence--pick',
              )}
              onClick={
                onPickSentence
                  ? () => onPickSentence(sentence.index)
                  : undefined
              }
            >
              {sentence.runs.map((run, r) =>
                run.strong ? (
                  <strong key={r}>{run.text}</strong>
                ) : (
                  <span key={r}>{run.text}</span>
                ),
              )}{' '}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

/** A scaled, inert picture of a page for the preference pairs. */
export function Thumbnail({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <figure className="tn-thumb">
      <div className="tn-thumb__frame" aria-hidden="true" inert>
        <div className="tn-thumb__scale">{children}</div>
      </div>
      <figcaption className="tn-thumb__label">{label}</figcaption>
    </figure>
  );
}

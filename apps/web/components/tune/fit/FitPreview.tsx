'use client';

import './fit-preview.css';

import type { FitProfile } from '@webable/core';
import { needLevels } from '@webable/core';
import type { FitRow } from '@webable/core/profile/describe';
import { FitValue, SegmentedControl } from '@webable/ui';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';

import { rowValue, type FitValueShape } from '../shared/fit';

/**
 * "Your fit" preview (design-final §9.4): a real sample page in a radius-20
 * frame, Original or Fitted. In Fitted, up to three regions that change get a
 * fern outline 4 px outside their bounds and a numbered disc at the outline's
 * top-right; the legend under the frame gives each number its real value.
 *
 * Self-contained: it brings its own styles and needs no Tune context, so the
 * app can show it too. Props: { profile, rows, rootFontPx }.
 */

type RegionId = 'text' | 'actions' | 'side';

interface Region {
  id: RegionId;
  label: string;
  value: FitValueShape;
}

const BASE_PX = 16;
/** The outline sits this far outside the region's own bounds. */
const OUTLINE_GAP = 4;

function readable(
  profile: FitProfile,
  dark: boolean,
): { body: string; meta: string } {
  const floor = profile.vision.contrastFloor.value;
  if (dark) {
    if (floor === 21) return { body: '#FFFFFF', meta: '#F2F2F2' };
    if (floor === 7) return { body: '#E6E6E6', meta: '#CFCFCF' };
    return { body: '#DADADA', meta: '#A8A8A8' };
  }
  if (floor === 21) return { body: '#111111', meta: '#111111' };
  if (floor === 7) return { body: '#4F4F4F', meta: '#595959' };
  return { body: '#6B6B6B', meta: '#767676' };
}

interface PageLook {
  page: CSSProperties;
  text: CSSProperties;
  meta: CSSProperties;
  button: CSSProperties;
  side: CSSProperties;
}

function originalLook(): PageLook {
  return {
    page: { background: '#FFFFFF', color: '#2B2B2B', fontSize: `${BASE_PX}px` },
    text: { fontSize: '1em', lineHeight: 1.45, color: '#6B6B6B' },
    meta: { color: '#9A9A9A' },
    button: {
      minBlockSize: '28px',
      minInlineSize: '28px',
      fontSize: '0.8125em',
    },
    side: {},
  };
}

function fittedLook(profile: FitProfile, rootPx: number): PageLook {
  const needs = needLevels(profile);
  const dark = profile.vision.polarity.value === 'dark';
  const colors = readable(profile, dark);
  const textPx = Math.max(profile.vision.textMinPx.value, rootPx, BASE_PX);
  const target = Math.max(28, profile.motor.minTargetPx.value);
  const simplify = needs.distraction === 2;
  return {
    page: {
      background: dark ? '#121212' : '#FFFFFF',
      color: dark ? '#F2F2F2' : '#2B2B2B',
      fontSize: `${BASE_PX}px`,
    },
    text: {
      fontSize: `${textPx / BASE_PX}em`,
      lineHeight: Math.max(1.45, profile.vision.lineHeight.value),
      wordSpacing:
        profile.vision.wordSpacingEm.value > 0
          ? `${profile.vision.wordSpacingEm.value}em`
          : undefined,
      maxInlineSize:
        needs.lineLength > 0
          ? `${profile.vision.maxLineCh.value * 0.5}em`
          : undefined,
      color: colors.body,
      fontWeight: profile.vision.fontWeightFloor.value,
    },
    meta: { color: colors.meta },
    button: {
      minBlockSize: `${target}px`,
      minInlineSize: `${target}px`,
      fontSize: '0.8125em',
    },
    side: simplify ? { opacity: 0.35 } : {},
  };
}

function SamplePage({
  look,
  refs,
}: {
  look: PageLook;
  refs?: Partial<Record<RegionId, RefObject<HTMLDivElement | null>>>;
}) {
  return (
    <div className="tn-page" style={look.page}>
      <header className="tn-page__header">
        <span className="tn-page__site">The Riverside Journal</span>
        <span className="tn-page__nav" style={look.meta}>
          <span>News</span>
          <span>Food</span>
          <span>Towns</span>
        </span>
      </header>
      <div className="tn-page__body">
        <article className="tn-page__article">
          <p className="tn-page__kicker" style={look.meta}>
            Neighborhood · 4 min read
          </p>
          <h3 className="tn-page__title">
            The community garden opens for spring
          </h3>
          <div ref={refs?.text} className="tn-page__text" style={look.text}>
            <p>
              Plots at the corner of Elm and Fifth open on Saturday. Each plot
              comes with a water tap, a compost bin and a small shed for tools.
            </p>
            <p>
              New gardeners can join a free class on the first Sunday of each
              month. Bring gloves and a hat; seeds and soil are provided.
            </p>
          </div>
          <div ref={refs?.actions} className="tn-page__actions">
            {['Share', 'Save', 'Reply'].map((label) => (
              <span key={label} className="tn-page__button" style={look.button}>
                {label}
              </span>
            ))}
          </div>
        </article>
        <aside ref={refs?.side} className="tn-page__side" style={look.side}>
          <span className="tn-page__ad">Garden center sale</span>
          <span className="tn-page__rec">
            <span className="tn-page__rec-img" />
            Ten easy herbs
          </span>
          <span className="tn-page__rec">
            <span className="tn-page__rec-img" />
            Rain barrels, explained
          </span>
        </aside>
      </div>
    </div>
  );
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function relativeRect(
  el: HTMLElement | null,
  frame: HTMLElement | null,
): Rect | null {
  if (!el || !frame) return null;
  const a = el.getBoundingClientRect();
  const f = frame.getBoundingClientRect();
  if (a.width === 0 && a.height === 0) return null;
  return { x: a.left - f.left, y: a.top - f.top, w: a.width, h: a.height };
}

/** Up to three regions that change, each with the value from its fit row. */
export function regionsFor(rows: readonly FitRow[]): Region[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const changes = (id: FitRow['id']) => {
    const row = byId.get(id);
    return row && row.changesPages && rowValue(row).kind !== 'same'
      ? row
      : null;
  };
  const out: Region[] = [];
  const text =
    changes('textSize') ?? changes('lineSpacing') ?? changes('contrast');
  if (text) out.push({ id: 'text', label: text.label, value: rowValue(text) });
  const targets = changes('targets');
  if (targets)
    out.push({ id: 'actions', label: targets.label, value: rowValue(targets) });
  const busy = changes('busyPages');
  if (busy && busy.after === 'Simplified')
    out.push({ id: 'side', label: busy.label, value: rowValue(busy) });
  return out.slice(0, 3);
}

export interface FitPreviewProps {
  profile: FitProfile;
  rows: readonly FitRow[];
  rootFontPx: number;
}

export function FitPreview({ profile, rows, rootFontPx }: FitPreviewProps) {
  const titleId = useId();
  const [view, setView] = useState<'original' | 'fitted'>('fitted');
  const frame = useRef<HTMLDivElement>(null);
  const fittedRefs = {
    text: useRef<HTMLDivElement>(null),
    actions: useRef<HTMLDivElement>(null),
    side: useRef<HTMLDivElement>(null),
  };
  const regions = regionsFor(rows);
  const [rects, setRects] = useState<Partial<Record<RegionId, Rect>>>({});
  const fitted = view === 'fitted';
  const regionKey = regions.map((r) => r.id).join(',');

  useLayoutEffect(() => {
    const measure = () => {
      const next: Partial<Record<RegionId, Rect>> = {};
      for (const r of regions) {
        const rect = relativeRect(fittedRefs[r.id].current, frame.current);
        if (rect) next[r.id] = rect;
      }
      setRects(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined' || !frame.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame.current);
    return () => observer.disconnect();
    // Regions and profile decide the layout; the refs are stable.
  }, [profile, regionKey]);

  const describe = regions
    .map((r, i) => `${i + 1}, ${r.label}: ${r.value.srText}`)
    .join('. ');

  return (
    <section className="tn-fitpv" aria-labelledby={titleId}>
      <div className="tn-fitpv__bar">
        <h2 id={titleId} className="tn-fitpv__title">
          On a sample page
        </h2>
        <SegmentedControl<'original' | 'fitted'>
          label="Show the sample page"
          value={view}
          onValueChange={setView}
          options={[
            { value: 'original', label: 'Original' },
            { value: 'fitted', label: 'Fitted' },
          ]}
        />
      </div>
      <div
        ref={frame}
        className="tn-fitpv__frame"
        role="img"
        aria-label={
          fitted
            ? `Sample page with your fit. ${describe || 'It already fits you.'}`
            : 'Sample page as the site made it.'
        }
      >
        <div
          className="tn-fitpv__layer"
          data-hidden={fitted || undefined}
          aria-hidden="true"
        >
          <SamplePage look={originalLook()} />
        </div>
        <div
          className="tn-fitpv__layer"
          data-layer="fitted"
          data-hidden={!fitted || undefined}
          aria-hidden="true"
        >
          <SamplePage
            look={fittedLook(profile, rootFontPx)}
            refs={fittedRefs}
          />
        </div>
        {fitted
          ? regions.map((r, i) => {
              const rect = rects[r.id];
              if (!rect) return null;
              return (
                <span
                  key={r.id}
                  className="tn-fit-outline"
                  aria-hidden="true"
                  style={{
                    insetInlineStart: rect.x - OUTLINE_GAP,
                    insetBlockStart: rect.y - OUTLINE_GAP,
                    inlineSize: rect.w + 2 * OUTLINE_GAP,
                    blockSize: rect.h + 2 * OUTLINE_GAP,
                  }}
                >
                  <span className="tn-fit-disc">{i + 1}</span>
                </span>
              );
            })
          : null}
      </div>
      {fitted && regions.length > 0 ? (
        <ol className="tn-fit-legend" aria-label="What changes on this page">
          {regions.map((r, i) => (
            <li key={r.id} className="tn-fit-legend__item">
              <span className="tn-fit-legend__n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="tn-fit-legend__label">{r.label}</span>
              <FitValue value={r.value} size="inline" />
            </li>
          ))}
        </ol>
      ) : null}
      {fitted && regions.length === 0 ? (
        <p className="tn-fitpv__meta">This page already fits you.</p>
      ) : null}
    </section>
  );
}

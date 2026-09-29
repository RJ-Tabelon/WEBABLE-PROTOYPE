'use client';

import type { FitProfile } from '@webable/core';
import { needLevels } from '@webable/core';
import type { FitRow } from '@webable/core/profile/describe';
import { FitArrow, SegmentedControl } from '@webable/ui';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';

/**
 * "Your fit" preview (design-final §9.4): a real sample page in a radius-20
 * frame, Original or Fitted, with ghost-and-fit outlines on up to three regions
 * that changed. Every number on a tag is a real value from the fit rows.
 */

type RegionId = 'text' | 'actions' | 'side';

interface Region {
  id: RegionId;
  /** The fit mark on the tag. */
  tag: { from?: string; to: string; label: string };
}

const BASE_PX = 16;

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

function regionsFor(rows: readonly FitRow[]): Region[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Region[] = [];
  const text = byId.get('textSize');
  const spacing = byId.get('lineSpacing');
  const contrast = byId.get('contrast');
  if (text?.changed)
    out.push({
      id: 'text',
      tag: { from: text.before, to: text.after, label: 'Text size' },
    });
  else if (spacing?.changed)
    out.push({
      id: 'text',
      tag: { from: spacing.before, to: spacing.after, label: 'Line spacing' },
    });
  else if (contrast?.changed)
    out.push({
      id: 'text',
      tag: { from: contrast.before, to: contrast.after, label: 'Contrast' },
    });
  const targets = byId.get('targets');
  if (targets?.changed)
    out.push({
      id: 'actions',
      tag: { from: targets.before, to: targets.after, label: 'Click targets' },
    });
  const busy = byId.get('busyPages');
  if (busy?.changed && busy.after === 'Simplified')
    out.push({ id: 'side', tag: { to: 'Toned down', label: 'Busy pages' } });
  return out.slice(0, 3);
}

function Tag({ from, to }: { from?: string; to: string }) {
  return (
    <span className="tn-tag" aria-hidden="true">
      {from ? (
        <>
          <span className="tn-tag__from">{from}</span>
          <FitArrow />
        </>
      ) : null}
      <span className="tn-tag__to">{to}</span>
    </span>
  );
}

export interface FitPreviewProps {
  profile: FitProfile;
  rows: readonly FitRow[];
  rootFontPx: number;
  children?: ReactNode;
}

export function FitPreview({ profile, rows, rootFontPx }: FitPreviewProps) {
  const titleId = useId();
  const [view, setView] = useState<'original' | 'fitted'>('fitted');
  const frame = useRef<HTMLDivElement>(null);
  const originalRefs = {
    text: useRef<HTMLDivElement>(null),
    actions: useRef<HTMLDivElement>(null),
    side: useRef<HTMLDivElement>(null),
  };
  const fittedRefs = {
    text: useRef<HTMLDivElement>(null),
    actions: useRef<HTMLDivElement>(null),
    side: useRef<HTMLDivElement>(null),
  };
  const regions = regionsFor(rows);
  const [rects, setRects] = useState<
    Record<string, { ghost: Rect | null; fit: Rect | null }>
  >({});
  const fitted = view === 'fitted';
  const regionKey = regions.map((r) => r.id).join(',');

  useLayoutEffect(() => {
    const measure = () => {
      const next: Record<string, { ghost: Rect | null; fit: Rect | null }> = {};
      for (const r of regions) {
        next[r.id] = {
          ghost: relativeRect(originalRefs[r.id].current, frame.current),
          fit: relativeRect(fittedRefs[r.id].current, frame.current),
        };
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
    .map((r) =>
      r.tag.from
        ? `${r.tag.label}: ${r.tag.from} to ${r.tag.to}`
        : `${r.tag.label}: ${r.tag.to}`,
    )
    .join('. ');

  return (
    <section className="tn-fit-preview" aria-labelledby={titleId}>
      <div className="tn-preview__bar">
        <h2 id={titleId} className="tn-fit-preview__title">
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
        className="tn-preview__frame tn-preview__frame--stack"
        role="img"
        aria-label={
          fitted
            ? `Sample page with your fit. ${describe || 'It already fits you.'}`
            : 'Sample page as the site made it.'
        }
      >
        <div
          className="tn-preview__layer"
          data-hidden={fitted || undefined}
          aria-hidden="true"
        >
          <SamplePage look={originalLook()} refs={originalRefs} />
        </div>
        <div
          className="tn-preview__layer"
          data-hidden={!fitted || undefined}
          aria-hidden="true"
        >
          <SamplePage
            look={fittedLook(profile, rootFontPx)}
            refs={fittedRefs}
          />
        </div>
        {fitted
          ? regions.map((r) => {
              const rect = rects[r.id];
              if (!rect?.fit) return null;
              return (
                <div key={r.id} aria-hidden="true">
                  {rect.ghost ? (
                    <span
                      className="tn-ghost"
                      style={{
                        insetInlineStart: rect.ghost.x - 4,
                        insetBlockStart: rect.ghost.y - 4,
                        inlineSize: rect.ghost.w + 8,
                        blockSize: rect.ghost.h + 8,
                      }}
                    />
                  ) : null}
                  <span
                    className="tn-fit-outline"
                    style={{
                      insetInlineStart: rect.fit.x - 6,
                      insetBlockStart: rect.fit.y - 6,
                      inlineSize: rect.fit.w + 12,
                      blockSize: rect.fit.h + 12,
                    }}
                  >
                    <Tag from={r.tag.from} to={r.tag.to} />
                  </span>
                </div>
              );
            })
          : null}
      </div>
      {fitted && regions.length === 0 ? (
        <p className="tn-meta">This page already fits you.</p>
      ) : null}
    </section>
  );
}

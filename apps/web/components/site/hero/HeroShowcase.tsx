'use client';

import { FitMark, Icon, SegmentedControl, StatusShape } from '@webable/ui';
import Image from 'next/image';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { claimHeroDraw, sessionStore } from '../hero-draw';
import { BrowserWindow } from '../kit/BrowserWindow';
import {
  CAPTURE_SIZE,
  CAPTURED_ON,
  HERO_SITES,
  type HeroSite,
  type SiteId,
  isSizeChange,
} from './captures';
import { withBase } from '../../../lib/base-path';

type View = 'original' | 'fitted';

const VIEW_OPTIONS = [
  { value: 'original', label: 'Original' },
  { value: 'fitted', label: 'Fitted' },
] as const;

const SITE_OPTIONS = HERO_SITES.map((s) => ({ value: s.id, label: s.name }));

/** How long the page shows as the site made it before WebAble fits it. */
export const REVEAL_AFTER_MS = 1100;

/** The window is wide enough to show the page at its full width. */
const SIZES = '(min-width: 80rem) 72rem, (min-width: 48rem) 90vw, 100vw';

function prefersStill(): boolean {
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset.waMotion === 'reduce'
  );
}

function siteById(id: SiteId): HeroSite {
  return HERO_SITES.find((s) => s.id === id) ?? HERO_SITES[0]!;
}

/**
 * The hero's product picture: real screenshots of busy public pages in Chrome,
 * as each site made it and with WebAble on for one sample person (larger text,
 * plain words). The first time it comes into view in a session it shows the
 * page as the site made it, then WebAble's version fades in once, within two
 * seconds. Original and Fitted switch between the two; the site switch shows
 * the same person on other sites. Under reduced motion it starts fitted. Under
 * the window: what WebAble recorded doing on that page, in its own words.
 */
export function HeroShowcase() {
  const [siteId, setSiteId] = useState<SiteId>(HERO_SITES[0]!.id);
  const [view, setView] = useState<View>('original');
  const [instant, setInstant] = useState(false);
  const figureRef = useRef<HTMLElement>(null);
  const touched = useRef(false);
  // Whether this view may play the reveal, decided once per mount: React runs
  // effects twice in development, and the second run must not see the first
  // run's claim as an earlier visit.
  const mayReveal = useRef<boolean | null>(null);
  const captionId = useId();
  const site = siteById(siteId);

  const showNow = useCallback((next: View) => {
    setInstant(true);
    setView(next);
    requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
  }, []);

  // Fit the page in front of the person once a session; otherwise start fitted.
  useEffect(() => {
    mayReveal.current ??= !prefersStill() && claimHeroDraw(sessionStore());
    if (!mayReveal.current) {
      showNow('fitted');
      return;
    }
    const figure = figureRef.current;
    if (!figure) return;
    let timer = 0;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        seen.disconnect();
        timer = window.setTimeout(() => {
          if (!touched.current) setView('fitted');
        }, REVEAL_AFTER_MS);
      },
      { threshold: 0.35 },
    );
    seen.observe(figure);
    return () => {
      seen.disconnect();
      window.clearTimeout(timer);
    };
  }, [showNow]);

  return (
    <figure
      ref={figureRef}
      className="wm-show"
      aria-labelledby={captionId}
      data-view={view}
      data-instant={instant ? '' : undefined}
    >
      <BrowserWindow
        domain={site.domain}
        toolbarEnd={
          <>
            <span className="wm-show__badge" aria-hidden="true">
              {view === 'fitted' ? (
                <>
                  <StatusShape
                    state="adapted"
                    size={16}
                    className="wm-show__glyph"
                  />
                  <span>
                    Adapted
                    <span className="wm-show__badge-more">
                      {` · ${site.changes.length} changes`}
                    </span>
                  </span>
                </>
              ) : (
                <span>As the site made it</span>
              )}
            </span>
            <SegmentedControl<View>
              label="Show the page"
              options={VIEW_OPTIONS}
              value={view}
              onValueChange={(next) => {
                touched.current = true;
                setView(next);
              }}
            />
          </>
        }
      >
        <div className="wm-show__view">
          {HERO_SITES.map((s) =>
            (['original', 'fitted'] as const).map((kind) => {
              const on = s.id === siteId && kind === view;
              const shot = s[kind];
              return (
                <Image
                  key={`${s.id}-${kind}`}
                  className="wm-show__shot"
                  src={withBase(shot.src)}
                  alt={on ? shot.alt : ''}
                  aria-hidden={on ? undefined : true}
                  width={CAPTURE_SIZE.width}
                  height={CAPTURE_SIZE.height}
                  sizes={SIZES}
                  priority={s.id === HERO_SITES[0]!.id}
                  data-on={on ? '' : undefined}
                />
              );
            }),
          )}
        </div>
      </BrowserWindow>

      <div className="wm-show__below">
        <div className="wm-show__sites">
          <p className="wm-show__label" id={`${captionId}-sites`}>
            The same fit on other sites
          </p>
          <SegmentedControl<SiteId>
            labelledBy={`${captionId}-sites`}
            options={SITE_OPTIONS}
            value={siteId}
            onValueChange={(next) => {
              touched.current = true;
              setSiteId(next);
              showNow(view);
            }}
          />
        </div>
        <div className="wm-show__changes">
          <p className="wm-show__label">What WebAble changed</p>
          <ul role="list" className="wm-show__list">
            {site.changes.map((c) =>
              isSizeChange(c) ? (
                <li key={c.label}>
                  <FitMark
                    label={c.label}
                    from={c.from}
                    to={c.to}
                    unit={c.unit}
                  />
                </li>
              ) : (
                <li key={c.said} className="wm-show__did">
                  <Icon name="check" size={16} />
                  <span>{c.said}</span>
                </li>
              ),
            )}
          </ul>
        </div>
      </div>

      <figcaption id={captionId} className="wm-show__caption">
        Real screenshots of WebAble in Chrome, {CAPTURED_ON}, for one sample
        person who needs larger text and plain words. WebAble isn’t affiliated
        with these sites.
      </figcaption>
    </figure>
  );
}

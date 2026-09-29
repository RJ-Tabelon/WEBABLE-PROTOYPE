import { controlName } from '../extract/evidence';
import {
  GIF_RE,
  isAutoplayVideo,
  isTransition,
  motionInventory,
} from '../extract/motion';
import type { TreeScope } from '../util/dom';
import { calmMotionCss, tok } from './css';
import { setOffGate } from './marks';
import { notNeeded, type OpEnv, type OpImpl } from './types';

/**
 * calm_motion (engine.md 3.4.8): the CSS reset (pre-paint when registered)
 * plus an imperative sweep the CSS cannot reach: finite WAAPI animations are
 * finished (end state, never frozen invisible), infinite ones paused; marquee
 * stopped; SMIL paused; carousels paused with the site's own pause control
 * (WCAG 2.2.2 requires one). Canvas/rAF loops cannot be paused from here.
 *
 * pause_media: pauses autoplaying videos (the person can play them again;
 * a play right after their own input is respected) and freezes animated
 * GIFs with a canvas frame in WebAble's layer (the image stays in the
 * accessibility tree with its alt text, at opacity 0 behind the frame).
 * Pressing on a frozen image lets that image play again.
 */

const moving = (n: number): string => `${n} moving`;

type CssAnimCtor = new (...args: never[]) => Animation;

function isCssAnimation(a: Animation): boolean {
  const C = (globalThis as { CSSAnimation?: CssAnimCtor }).CSSAnimation;
  return C !== undefined && a instanceof C;
}

export interface MotionSweep {
  paused: Set<Animation>;
}

/** Finish finite and pause infinite WAAPI animations. Returns how many it touched. */
export function sweepAnimations(
  scopes: readonly TreeScope[],
  sweep: MotionSweep,
): number {
  let n = 0;
  for (const scope of scopes) {
    const anims =
      (
        scope as TreeScope & { getAnimations?: () => Animation[] }
      ).getAnimations?.() ?? [];
    for (const a of anims) {
      if (a.playState !== 'running' || isTransition(a) || isCssAnimation(a))
        continue;
      const timing = a.effect?.getComputedTiming();
      if (!timing) continue;
      try {
        if (timing.iterations === Infinity || timing.endTime === Infinity) {
          a.pause();
          sweep.paused.add(a);
        } else {
          a.finish();
        }
        n++;
      } catch {
        a.pause();
        sweep.paused.add(a);
        n++;
      }
    }
  }
  return n;
}

const PAUSE_NAME = /\b(pause|stop)\b/i;
const PLAY_NAME = /\b(play|resume|start)\b/i;

function carouselControl(carousel: Element, name: RegExp): HTMLElement | null {
  for (const c of carousel.querySelectorAll<HTMLElement>(
    'button, [role="button"]',
  )) {
    if (name === PAUSE_NAME && c.getAttribute('aria-pressed') === 'true')
      continue;
    if (name.test(controlName(c))) return c;
  }
  return null;
}

export const calmMotion: OpImpl = {
  id: 'calm_motion',
  prepare(env) {
    const before = motionInventory(env.facts.scopes);
    const movingBefore = before.running + before.marquee + before.carousels;
    const prePaint = env.prePaint.has('calm_motion');
    return {
      status: 'ready',
      css: {
        doc: prePaint ? '' : calmMotionCss('doc'),
        shadow: calmMotionCss('shadow'),
      },
      count: movingBefore,
      fit:
        movingBefore > 0
          ? { before: moving(movingBefore), after: moving(0) }
          : undefined,
      run: () => {
        if (prePaint) setOffGate(env.doc, 'calm_motion', false);
        const sweep: MotionSweep = { paused: new Set() };
        sweepAnimations(env.layers.scopes(), sweep);
        const marquees: Array<
          HTMLElement & { stop?: () => void; start?: () => void }
        > = [];
        const svgs: SVGSVGElement[] = [];
        for (const scope of env.layers.scopes()) {
          for (const m of scope.querySelectorAll<
            HTMLElement & { stop?: () => void; start?: () => void }
          >('marquee')) {
            m.stop?.();
            marquees.push(m);
          }
          for (const s of scope.querySelectorAll('svg')) {
            if (
              !s.querySelector('animate, animateTransform, animateMotion, set')
            )
              continue;
            if (s.animationsPaused()) continue;
            s.pauseAnimations();
            svgs.push(s);
          }
        }
        const clicked: Array<{ carousel: Element; control: HTMLElement }> = [];
        for (const c of env.facts.carousels) {
          if (!c.isConnected) continue;
          const control = carouselControl(c, PAUSE_NAME);
          if (control) {
            control.click();
            clicked.push({ carousel: c, control });
          }
        }
        // New WAAPI animations started by scripts: sweep once a second for 10 s.
        let sweeps = 0;
        const timer = env.view.setInterval(() => {
          sweepAnimations(env.layers.scopes(), sweep);
          if (++sweeps >= 10) env.view.clearInterval(timer);
        }, 1000);
        let lastSweep = performance.now();
        const undo = (): void => {
          env.view.clearInterval(timer);
          if (prePaint) setOffGate(env.doc, 'calm_motion', true);
          for (const a of sweep.paused) {
            try {
              if (a.playState === 'paused') a.play();
            } catch {
              // animation was cancelled by the page
            }
          }
          for (const m of marquees) if (m.isConnected) m.start?.();
          for (const s of svgs) if (s.isConnected) s.unpauseAnimations();
          // Resume with the site's play control if it swapped one in, else toggle back.
          for (const { carousel, control } of clicked) {
            const play = carousel.isConnected
              ? carouselControl(carousel, PLAY_NAME)
              : null;
            if (play) play.click();
            else if (control.isConnected) control.click();
          }
        };
        const onAdded = (roots: readonly Element[]): void => {
          for (const r of roots) {
            for (const m of r.querySelectorAll<
              HTMLElement & { stop?: () => void; start?: () => void }
            >('marquee')) {
              m.stop?.();
              marquees.push(m);
            }
          }
          // getAnimations() forces a style update: at most once a second.
          if (performance.now() - lastSweep < 1000) return;
          lastSweep = performance.now();
          sweepAnimations(env.layers.scopes(), sweep);
        };
        return { undo, onAdded };
      },
    };
  },
  afterApply(env, applied) {
    const after = motionInventory(env.layers.scopes());
    if (applied.prepared.fit)
      applied.prepared.fit = {
        ...applied.prepared.fit,
        after: moving(after.running),
      };
  },
};

/** Tracks the person's own recent input so a play they asked for is never undone. */
class IntentTracker {
  private last = -Infinity;
  private readonly onInput = (): void => {
    this.last = performance.now();
  };

  constructor(private readonly win: Window) {
    win.addEventListener('pointerdown', this.onInput, {
      capture: true,
      passive: true,
    });
    win.addEventListener('keydown', this.onInput, {
      capture: true,
      passive: true,
    });
  }

  recent(ms = 1000): boolean {
    return performance.now() - this.last < ms;
  }

  dispose(): void {
    this.win.removeEventListener('pointerdown', this.onInput, true);
    this.win.removeEventListener('keydown', this.onInput, true);
  }
}

function playingAutoplay(env: OpEnv): HTMLVideoElement[] {
  const out = new Set<HTMLVideoElement>(
    env.facts.videos.filter((v) => v.isConnected && isAutoplayVideo(v)),
  );
  for (const scope of env.layers.scopes()) {
    for (const v of scope.querySelectorAll('video'))
      if (isAutoplayVideo(v)) out.add(v);
  }
  return [...out];
}

function animatedImages(env: OpEnv): HTMLImageElement[] {
  const out = new Set<HTMLImageElement>();
  for (const scope of env.layers.scopes()) {
    for (const img of scope.querySelectorAll('img')) {
      if (
        GIF_RE.test(img.currentSrc || img.src) &&
        img.complete &&
        img.naturalWidth > 32
      )
        out.add(img);
    }
  }
  return [...out];
}

export const pauseMedia: OpImpl = {
  id: 'pause_media',
  prepare(env) {
    const videos = playingAutoplay(env);
    const gifs = animatedImages(env);
    const n = videos.length + gifs.length;
    if (n === 0) return notNeeded('nothing is playing on its own');
    return {
      status: 'ready',
      css: { doc: `${tok('pm')} { opacity: 0 !important; }` },
      marks: gifs.map((g) => [g, 'pm'] as [Element, string]),
      count: n,
      fit: { before: `${n} playing`, after: `${n} paused` },
      show: [...videos, ...gifs],
      run: () => {
        const intent = new IntentTracker(env.view);
        const paused = new Set<HTMLVideoElement>();
        const released = new Set<HTMLVideoElement>();
        for (const v of videos) {
          v.pause();
          paused.add(v);
        }
        // 'play' does not bubble; capture at each scope root sees it.
        const onPlay = (e: Event): void => {
          const v = e.target;
          if (
            !(v instanceof HTMLVideoElement) ||
            !paused.has(v) ||
            released.has(v)
          )
            return;
          if (intent.recent()) {
            released.add(v); // the person pressed play: never pause this one again
            return;
          }
          v.pause();
        };
        const roots = new Set<TreeScope>(env.layers.scopes());
        for (const r of roots) r.addEventListener('play', onPlay, true);
        const unfreezers = [env.overlay.freezeImages(gifs)];
        const frozen = new Set<HTMLImageElement>(gifs);
        // Pressing on a frozen image lets it play again (the press itself is not intercepted).
        const onPress = (e: PointerEvent): void => {
          for (const n of e.composedPath()) {
            if (!(n instanceof HTMLImageElement) || !frozen.has(n)) continue;
            frozen.delete(n);
            env.overlay.unfreezeImage(n);
            env.marks.unmark(n, 'pm');
          }
        };
        env.view.addEventListener('pointerdown', onPress, {
          capture: true,
          passive: true,
        });
        const undo = (): void => {
          env.view.removeEventListener('pointerdown', onPress, true);
          for (const r of roots) r.removeEventListener('play', onPlay, true);
          intent.dispose();
          for (const u of unfreezers) u();
          for (const v of paused) {
            if (!released.has(v) && v.isConnected && v.paused)
              void v.play().catch(() => undefined);
          }
        };
        // Media the page inserts later (lazy players, SPA content) is treated the same.
        const onAdded = (added: readonly Element[]): void => {
          for (const scope of env.layers.scopes()) {
            if (roots.has(scope)) continue;
            roots.add(scope);
            scope.addEventListener('play', onPlay, true);
          }
          const newGifs: HTMLImageElement[] = [];
          for (const root of added) {
            for (const v of [root, ...root.querySelectorAll('video')]) {
              if (
                v instanceof HTMLVideoElement &&
                !paused.has(v) &&
                isAutoplayVideo(v)
              ) {
                v.pause();
                paused.add(v);
              }
            }
            for (const img of [root, ...root.querySelectorAll('img')]) {
              if (
                !(img instanceof HTMLImageElement) ||
                !GIF_RE.test(img.currentSrc || img.src)
              )
                continue;
              if (!img.complete || img.naturalWidth <= 32) continue;
              newGifs.push(img);
            }
          }
          if (newGifs.length) {
            unfreezers.push(env.overlay.freezeImages(newGifs));
            for (const g of newGifs) {
              frozen.add(g);
              env.marks.mark(g, 'pm');
            }
          }
        };
        return { undo, onAdded };
      },
    };
  },
};

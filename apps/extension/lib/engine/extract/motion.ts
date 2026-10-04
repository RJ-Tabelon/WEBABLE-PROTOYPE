import type { TreeScope } from '../util/dom';

/**
 * Motion inventory (engine.md 2.9). getAnimations() is scoped to a tree, so
 * each shadow root is queried separately. Each call triggers a style update;
 * callers sweep at most once per second while a motion op is active.
 */

export const CAROUSEL_SELECTOR = [
  '[aria-roledescription="carousel" i]',
  '.swiper',
  '.swiper-container',
  '.slick-slider',
  '.splide',
  '.glide',
  '.flickity-enabled',
  '.owl-carousel',
  '.keen-slider',
  '.embla',
  '.carousel',
  '[data-carousel]',
].join(',');

export interface MotionInventory {
  /** Running CSS animations and WAAPI animations (transitions excluded). */
  running: number;
  infinite: number;
  transitions: number;
  autoplayMedia: number;
  carousels: number;
  animatedImages: number;
  smil: number;
  marquee: number;
  canvasLarge: number;
  /** Elements with running animations, for per-region motion evidence. */
  animatedTargets: Element[];
  loopTargets: Element[];
  videos: HTMLVideoElement[];
  gifs: HTMLImageElement[];
  carouselEls: Element[];
}

export const GIF_RE = /\.gif(?:$|[?#])|^data:image\/gif/i;

type AnimationLike = Animation & {
  effect: (AnimationEffect & { target?: Element | null }) | null;
};

export function isTransition(a: Animation): boolean {
  const T = (
    globalThis as { CSSTransition?: new (...args: never[]) => Animation }
  ).CSSTransition;
  return T !== undefined && a instanceof T;
}

export function isAutoplayVideo(v: HTMLVideoElement): boolean {
  return !v.paused && !v.ended && (v.autoplay || v.muted || v.defaultMuted);
}

export function motionInventory(scopes: readonly TreeScope[]): MotionInventory {
  const inv: MotionInventory = {
    running: 0,
    infinite: 0,
    transitions: 0,
    autoplayMedia: 0,
    carousels: 0,
    animatedImages: 0,
    smil: 0,
    marquee: 0,
    canvasLarge: 0,
    animatedTargets: [],
    loopTargets: [],
    videos: [],
    gifs: [],
    carouselEls: [],
  };
  for (const scope of scopes) {
    const anims =
      (
        scope as TreeScope & { getAnimations?: () => Animation[] }
      ).getAnimations?.() ?? [];
    for (const a of anims as AnimationLike[]) {
      if (a.playState !== 'running') continue;
      if (isTransition(a)) {
        inv.transitions++;
        continue;
      }
      inv.running++;
      const timing = a.effect?.getComputedTiming();
      const target = a.effect?.target ?? null;
      if (timing && timing.iterations === Infinity) {
        inv.infinite++;
        if (target) inv.loopTargets.push(target);
      }
      if (target) inv.animatedTargets.push(target);
    }
    for (const v of scope.querySelectorAll('video')) {
      if (isAutoplayVideo(v)) {
        inv.autoplayMedia++;
        inv.videos.push(v);
      }
    }
    for (const img of scope.querySelectorAll('img')) {
      if (
        GIF_RE.test(img.currentSrc || img.src) &&
        img.width * img.height > 32 * 32
      ) {
        inv.animatedImages++;
        inv.gifs.push(img);
      }
    }
    inv.smil += scope.querySelectorAll(
      'svg animate, svg animateTransform, svg animateMotion',
    ).length;
    inv.marquee += scope.querySelectorAll('marquee').length;
    for (const c of scope.querySelectorAll('canvas')) {
      if (c.width * c.height > 200 * 200) inv.canvasLarge++;
    }
    const carousels = [...scope.querySelectorAll(CAROUSEL_SELECTOR)];
    // Nested matches (".carousel .swiper") count once.
    for (const c of carousels) {
      if (carousels.some((o) => o !== c && o.contains(c))) continue;
      inv.carouselEls.push(c);
    }
  }
  inv.carousels = inv.carouselEls.length;
  return inv;
}

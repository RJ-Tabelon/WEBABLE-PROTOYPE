'use client';

import { IconButton } from '@webable/ui';
import { useEffect, useRef, useState } from 'react';
import {
  CELL,
  GLYPHS,
  INK,
  SCRAMBLE,
  atlasCell,
  beamAt,
  beamSpan,
  buildGrid,
  centredPen,
  randomGlyph,
  type Box,
} from './glyph-field';

/** localStorage: "1" when the person paused the letters (kept for later visits). */
const PAUSE_KEY = 'wm-glyphs-paused';
/** The letters change at 30 frames a second at most; the beams are slow. */
const FRAME_MS = 1000 / 30;
/** Where the beams start, in seconds of travel, so the first frame is lit. */
const START_TIME = 9;

function readPaused(): boolean {
  try {
    return window.localStorage.getItem(PAUSE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePaused(paused: boolean) {
  try {
    if (paused) window.localStorage.setItem(PAUSE_KEY, '1');
    else window.localStorage.removeItem(PAUSE_KEY);
  } catch {
    // Not stored: the choice holds for this visit.
  }
}

function prefersStill(query: MediaQueryList): boolean {
  return (
    query.matches || document.documentElement.dataset.waMotion === 'reduce'
  );
}

interface Controls {
  run: () => void;
  stop: () => void;
}

/**
 * The hero's moving letters (after Framer's Glyph Beams): a canvas behind the
 * hero's words, drawn in the page's ink at low opacity, clear behind the words
 * themselves. It is decoration (aria-hidden) with one control, Pause, as
 * moving content that runs longer than five seconds needs. It draws one still
 * frame under reduced motion, and stops while off screen or in a hidden tab.
 *
 * `clear` names the element, in the same parent, whose children the letters
 * keep away from.
 */
export function GlyphField({ clear }: { clear: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controls = useRef<Controls | null>(null);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);

  // Read the stored choice before the drawing effect below starts the loop.
  useEffect(() => {
    pausedRef.current = readPaused();
    setPaused(pausedRef.current);
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!wrap || !canvas || !ctx) return;
    const stillQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

    let width = 0;
    let height = 0;
    let dpr = 1;
    let grid = buildGrid(1, 1, null);
    let chars = new Uint8Array(0);
    let atlas: HTMLCanvasElement | null = null;
    let cell = atlasCell(1);
    let ink = '#1a1a17';
    let raf = 0;
    let last = 0;
    let time = START_TIME;
    let fadeFrom = 0;
    let onScreen = true;

    // Every letter drawn once in the ink, so a frame is image copies, not text.
    // The sheet is in device pixels, one whole-pixel cell per letter with a gap
    // between cells; each letter is centred by its own ink and clipped to its
    // cell, so it sits in the middle of its tile and never shows in the next.
    const buildAtlas = () => {
      const style = getComputedStyle(wrap);
      ink = style.color;
      cell = atlasCell(dpr);
      const sheet = document.createElement('canvas');
      sheet.width = GLYPHS.length * cell.stride;
      sheet.height = cell.h;
      const g = sheet.getContext('2d');
      if (!g) return;
      g.fillStyle = ink;
      g.font = `${CELL.font * dpr}px ${style.fontFamily}`;
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      for (let i = 0; i < GLYPHS.length; i++) {
        const glyph = GLYPHS[i]!;
        const m = g.measureText(glyph);
        const pen = centredPen(cell.w, cell.h, {
          left: m.actualBoundingBoxLeft,
          right: m.actualBoundingBoxRight,
          ascent: m.actualBoundingBoxAscent,
          descent: m.actualBoundingBoxDescent,
        });
        const x0 = i * cell.stride;
        g.save();
        g.beginPath();
        g.rect(x0, 0, cell.w, cell.h);
        g.clip();
        g.fillText(glyph, x0 + pen.x, pen.y);
        g.restore();
      }
      atlas = sheet;
    };

    // The hero's words, as one box in the field's coordinates.
    const clearBox = (): Box | null => {
      const head = wrap.parentElement?.querySelector(clear);
      if (!head) return null;
      const base = wrap.getBoundingClientRect();
      let box: Box | null = null;
      for (const child of Array.from(head.children)) {
        const r = child.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const x0 = r.left - base.left;
        const y0 = r.top - base.top;
        const x1 = r.right - base.left;
        const y1 = r.bottom - base.top;
        box = box
          ? {
              x0: Math.min(box.x0, x0),
              y0: Math.min(box.y0, y0),
              x1: Math.max(box.x1, x1),
              y1: Math.max(box.y1, y1),
            }
          : { x0, y0, x1, y1 };
      }
      return box;
    };

    const draw = (t: number, fade: number, scramble: boolean) => {
      if (!atlas) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = ink;
      const span = beamSpan(width, height);
      const { cols, rows, ox, mask } = grid;
      const { w: cw, h: ch, stride } = cell;
      for (let r = 0; r < rows; r++) {
        const y = r * CELL.h;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const m = mask[i]! * fade;
          if (m < 0.01) continue;
          const x = ox + c * CELL.w;
          const light = beamAt(x + CELL.w / 2, y + CELL.h / 2, t, span);
          if (scramble && Math.random() < SCRAMBLE.base + light * SCRAMBLE.beam)
            chars[i] = randomGlyph();
          const px = Math.round(x * dpr);
          const py = Math.round(y * dpr);
          if (light > 0.18) {
            ctx.globalAlpha = m * light * INK.tile;
            ctx.fillRect(px + dpr, py + dpr, cw - 2 * dpr, ch - 2 * dpr);
          }
          const alpha = m * (INK.base + light * INK.beam);
          if (alpha < 0.008) continue;
          ctx.globalAlpha = alpha;
          ctx.drawImage(atlas, chars[i]! * stride, 0, cw, ch, px, py, cw, ch);
        }
      }
      ctx.globalAlpha = 1;
    };

    const layout = () => {
      const rect = wrap.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      if (!width || !height) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      grid = buildGrid(width, height, clearBox());
      const count = grid.cols * grid.rows;
      if (chars.length !== count) {
        chars = new Uint8Array(count);
        for (let i = 0; i < count; i++) chars[i] = randomGlyph();
      }
      buildAtlas();
      draw(
        time,
        raf ? Math.min(1, (performance.now() - fadeFrom) / 1200) : 1,
        false,
      );
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (last && now - last < FRAME_MS) return;
      time += last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      draw(time, Math.min(1, (now - fadeFrom) / 1200), true);
    };

    const run = () => {
      if (raf || pausedRef.current || prefersStill(stillQuery)) return;
      if (!onScreen || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    controls.current = { run, stop };

    // First paint: fade in when moving, a still frame otherwise.
    layout();
    if (pausedRef.current || prefersStill(stillQuery)) draw(time, 1, false);
    else {
      fadeFrom = performance.now();
      draw(time, 0, false);
      run();
    }

    let pending = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(layout);
    });
    resize.observe(wrap);
    const head = wrap.parentElement?.querySelector(clear);
    if (head) resize.observe(head);

    const seen = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      if (onScreen) run();
      else stop();
    });
    seen.observe(wrap);

    const onVisibility = () => (document.hidden ? stop() : run());
    document.addEventListener('visibilitychange', onVisibility);

    // Theme or motion changes: redraw in the new ink, or stop for stillness.
    const restyle = () => {
      buildAtlas();
      if (prefersStill(stillQuery)) {
        stop();
        draw(time, 1, false);
      } else {
        if (!raf) draw(time, 1, false);
        run();
      }
    };
    const rootWatch = new MutationObserver(restyle);
    rootWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-wa-motion', 'data-wa-contrast'],
    });
    stillQuery.addEventListener('change', restyle);
    darkQuery.addEventListener('change', restyle);
    void document.fonts?.ready.then(() => {
      buildAtlas();
      if (!raf) draw(time, 1, false);
    });

    return () => {
      stop();
      cancelAnimationFrame(pending);
      resize.disconnect();
      seen.disconnect();
      rootWatch.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      stillQuery.removeEventListener('change', restyle);
      darkQuery.removeEventListener('change', restyle);
      controls.current = null;
    };
  }, [clear]);

  const toggle = () => {
    const next = !paused;
    pausedRef.current = next;
    setPaused(next);
    writePaused(next);
    if (next) controls.current?.stop();
    else controls.current?.run();
  };

  return (
    <>
      <div ref={wrapRef} className="wm-glyphs" aria-hidden="true">
        <canvas ref={canvasRef} className="wm-glyphs__canvas" />
      </div>
      <div className="wa-container wm-glyphs__bar">
        <IconButton
          icon={paused ? 'play' : 'pause'}
          label={
            paused ? 'Play the moving letters' : 'Pause the moving letters'
          }
          tooltipPlacement="start"
          className="wm-glyphs__toggle"
          onClick={toggle}
        />
      </div>
    </>
  );
}

// Owner: D (round 9). The Lens layer for paragraphs: an outline on each paragraph WebAble read for this person and a
// tag in the gutter with Jev's probability that it is harder than it needs to be for them, and what WebAble did.
// Same rhythm as the Lens: read every rect, place (paragraphs.ts), then draw; again on scroll (rAF only while scrolling)
// and on a slow tick for pages that move by themselves. It never takes the pointer.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EngineApi, EngineState } from '../../contracts';
import { paraFace, placeParaTags } from './paragraphs';
import type { Rect } from './place';

interface Props {
  api: EngineApi;
  reword: EngineState['reword'];
  /** One design pixel in CSS px (the Lens's --lu). */
  scale: number;
  /** Our own chrome the tags keep clear of (the Lens header, sheet and card). */
  avoid: () => Array<Element | null>;
  /** Where the tags landed, so the Lens's element chips keep clear of them. */
  onTags: (rects: Rect[]) => void;
}

interface Drawn { id: string; box: Rect; tag: Rect | null }

const TAG_W = 272;
const TAG_H = 42;
const OUTSET = 3;

export function Paras({ api, reword, scale, avoid, onTags }: Props) {
  const [drawn, setDrawn] = useState<Drawn[]>([]);
  const items = reword && reword.status !== 'off' ? reword.items ?? [] : [];
  const live = useRef({ items, scale, avoid, onTags });
  live.current = { items, scale, avoid, onTags };
  const sig = useRef('');

  const pass = (): void => {
    const L = live.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const boxes: Array<{ id: string; r: Rect }> = [];
    for (const it of L.items) {
      const el = api.elementFor(it.id);
      if (!el || !el.isConnected) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1 || b.bottom <= 0 || b.top >= vh || b.right <= 0 || b.left >= vw) continue;
      boxes.push({ id: it.id, r: { x: b.left, y: b.top, w: b.width, h: b.height } });
    }
    const keep: Rect[] = [];
    let top = 8;
    for (const el of L.avoid()) {
      if (!el) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;
      // The header spans the top: tags start under it rather than being pushed one by one.
      if (b.top <= 8 && b.width >= vw * 0.5) top = Math.max(top, b.bottom + 8);
      else keep.push({ x: b.left, y: b.top, w: b.width, h: b.height });
    }
    const tags = placeParaTags(boxes, { w: TAG_W * L.scale, h: TAG_H * L.scale }, { vw, vh, top }, keep);
    const next: Drawn[] = boxes.map((b) => ({ id: b.id, box: b.r, tag: tags.get(b.id) ?? null }));
    const s = next.map((d) => `${d.id}:${Math.round(d.box.x)},${Math.round(d.box.y)},${Math.round(d.box.w)},${Math.round(d.box.h)}:${d.tag ? `${Math.round(d.tag.x)},${Math.round(d.tag.y)}` : '-'}`).join('|');
    if (s === sig.current) return;
    sig.current = s;
    L.onTags([...tags.values()]);
    setDrawn(next);
  };
  const passRef = useRef(pass);
  passRef.current = pass;

  useEffect(() => {
    let raf = 0;
    let lastMove = 0;
    let alive = true;
    const run = (): void => {
      try {
        passRef.current();
      } catch {
        /* a paragraph vanished mid-frame; the next pass catches up */
      }
    };
    const frame = (): void => {
      raf = 0;
      if (!alive) return;
      run();
      if (performance.now() - lastMove < 150) raf = requestAnimationFrame(frame);
    };
    const onMove = (): void => {
      lastMove = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
    };
    window.addEventListener('scroll', onMove, { capture: true, passive: true });
    window.addEventListener('resize', onMove, { passive: true });
    const tick = window.setInterval(() => {
      if (!document.hidden && alive) run();
    }, 800);
    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      window.clearInterval(tick);
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
      live.current.onTags([]);
    };
  }, []);

  // New answers or a rewrite landing: place again now.
  const key = `${reword?.version ?? 0}|${items.length}|${scale}`;
  useEffect(() => {
    sig.current = '';
    try {
      passRef.current();
    } catch {
      /* ignore */
    }
  }, [key]);

  if (items.length === 0) return null;
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <div class="wa-lparas" aria-hidden="true">
      {drawn.map((d) => {
        const it = byId.get(d.id);
        if (!it) return null;
        const face = paraFace(it);
        return (
          <div key={d.id}>
            <div
              class="wa-lpara"
              data-tone={face.tone}
              style={{
                transform: `translate3d(${Math.round(d.box.x - OUTSET)}px,${Math.round(d.box.y - OUTSET)}px,0)`,
                width: `${Math.round(d.box.w + 2 * OUTSET)}px`,
                height: `${Math.round(d.box.h + 2 * OUTSET)}px`,
              }}
            />
            {d.tag && (
              <div
                class="wa-lptag"
                data-tone={face.tone}
                title={face.say}
                style={{ transform: `translate3d(${Math.round(d.tag.x)}px,${Math.round(d.tag.y)}px,0)` }}
              >
                <span class="wa-lptag-top">
                  <span class="wa-lptag-t">{face.top}</span>
                  <b class="wa-lptag-n">{face.num}</b>
                </span>
                <span class="wa-lptag-sub">{face.sub}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

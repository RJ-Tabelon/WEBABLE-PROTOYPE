// P1, "Tap the dots": a ring of 9 dots; one is filled, and pressing it fills the one across the ring. The press point
// decides hit or miss (misses are data: no redo, no error effects). A press that starts on the dot but lets go off it
// is a slip. Blocks of 8 scored presses, up to 3 blocks, from 44 px. Fills pointing.blocks.

import type { JSX } from 'preact';
import { useContext, useMemo, useRef, useState } from 'preact/hooks';
import { StepLabelsContext } from '../ui/words';
import { BlockWalk, RING_COUNT, RING_ORDER, ringDiameter } from '../logic/pointing';
import { useBox } from '../ui/hooks';
import { TaskLayout, type TaskProps } from './Task';

interface Down {
  id: number;
  x: number;
  y: number;
  t: number;
  dx: number;
  dy: number;
  inside: boolean;
  idx: number;
}

export function DotsTask(props: TaskProps): JSX.Element {
  const L = useContext(StepLabelsContext);
  const { raw } = props;
  const touch = props.input === 'touch';
  const walk = useMemo(() => new BlockWalk(touch), []);
  const [size, setSize] = useState<number>(() => walk.current() ?? 44);
  const [step, setStep] = useState(0);
  const [ref, box] = useBox<HTMLDivElement>({ w: 760, h: 440 });
  const down = useRef<Down | null>(null);

  const zoom = raw.zoom || 1;
  const css = size / zoom;
  const D = Math.min(ringDiameter(box.w, box.h, touch, css), Math.max(120, box.h - css - 24));
  const R = D / 2;
  const centers = useMemo(
    () =>
      Array.from({ length: RING_COUNT }, (_, i) => {
        const a = -Math.PI / 2 + (i / RING_COUNT) * Math.PI * 2;
        return { x: box.w / 2 + R * Math.cos(a), y: box.h / 2 + R * Math.sin(a) };
      }),
    [box.w, box.h, R],
  );
  const active = RING_ORDER[step % RING_COUNT] ?? 0;

  const local = (e: PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onDown = (e: PointerEvent) => {
    if (document.hidden || !e.isPrimary || down.current) return;
    e.preventDefault();
    ref.current?.setPointerCapture(e.pointerId);
    const p = local(e);
    const c = centers[active] ?? { x: 0, y: 0 };
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    down.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, dx, dy, inside: Math.hypot(dx, dy) <= css / 2, idx: active };
  };

  const onUp = (e: PointerEvent) => {
    const d = down.current;
    if (!d || e.pointerId !== d.id) return;
    down.current = null;
    const p = local(e);
    const c = centers[d.idx] ?? { x: 0, y: 0 };
    const slipped = d.inside && Math.hypot(p.x - c.x, p.y - c.y) > css / 2;
    raw.ringPress(d.x, d.y, d.t, e.clientX, e.clientY, e.timeStamp, slipped);
    walk.press({ dx: d.dx * zoom, dy: d.dy * zoom, hit: d.inside, slipped });
    props.onAnswer();
    if (walk.done) {
      raw.blocks = walk.blocks.map((b) => ({ sizePx: b.sizePx, presses: b.presses }));
      props.onDone({ trials: walk.scoredCount, stop: walk.stopReason ?? undefined });
      return;
    }
    setStep((s) => s + 1);
    const next = walk.current();
    if (next != null && next !== size) setSize(next);
  };

  const verb = touch ? 'Tap' : 'Click';
  return (
    <TaskLayout title={L.dotsTitle(touch)} sub={L.dotsLine} stageClass="is-dots" focusTitle>
      <div
        ref={ref}
        class="fl-ring"
        data-ring=""
        data-size={size}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => (down.current = null)}
        role="application"
        aria-label={`${verb} the filled dot.`}
      >
        {centers.map((c, i) => (
          <span
            class={`fl-dot ${i === active ? 'is-lit' : ''}`}
            style={{ left: `${c.x - css / 2}px`, top: `${c.y - css / 2}px`, width: `${css}px`, height: `${css}px` }}
            aria-hidden="true"
          />
        ))}
      </div>
    </TaskLayout>
  );
}

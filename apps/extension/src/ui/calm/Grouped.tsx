// Owner: D (round 10). Draws a laid-out part's body: each group shows the page's own words until its components are
// ready and allowed to settle in (settle.ts), then the components, with a thin green mark at its left that switches
// that group between WebAble's layout and the page's own words. Everything else draws exactly as before.
import { Fragment, type ComponentChildren, type JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Composed } from './compose/Composed';
import type { GroupSeg, Seg } from './compose/composeGroups';
import { useCalm } from './context';
import type { Block } from './model';
import { type Box, maySwitch, waitsForEarlier } from './settle';

type Render = (blocks: Block[]) => ComponentChildren;

/** A part's body: groups and the blocks between them, in page order. */
export function Segments({ segs, render }: { segs: Seg[]; render: Render }): JSX.Element {
  return (
    <>
      {segs.map((s, i) =>
        s.k === 'group' ? (
          <GroupView key={s.group.id} seg={s} render={render} />
        ) : (
          <Fragment key={s.blocks[0]?.key ?? `b${i}`}>{render(s.blocks)}</Fragment>
        ),
      )}
    </>
  );
}

const SAY_NEW = 'Laid out for you by WebAble. Click to see the page’s own words.';
const SAY_OWN = 'The page’s own words. Click to see them laid out for you.';

function GroupMark({ showing, onToggle }: { showing: 'new' | 'original'; onToggle: () => void }): JSX.Element {
  const fresh = showing === 'new';
  return (
    <button
      type="button"
      class="wa-rw-mark wa-cg__mark"
      data-showing={showing}
      title={fresh ? SAY_NEW : SAY_OWN}
      aria-label={fresh ? 'Laid out for you by WebAble. Show the page’s own words.' : 'The page’s own words. Show them laid out for you.'}
      onClick={onToggle}
    />
  );
}

function boxIn(el: Element | null, sc: HTMLElement | null): { box: Box | null; view: Box } {
  const view: Box = sc ? (({ top, bottom }) => ({ top, bottom }))(sc.getBoundingClientRect()) : { top: 0, bottom: window.innerHeight };
  if (!el) return { box: null, view };
  const r = el.getBoundingClientRect();
  return { box: r.height > 0 ? { top: r.top, bottom: r.bottom } : null, view };
}

export function GroupView({ seg, render }: { seg: GroupSeg; render: Render }): JSX.Element {
  const ctx = useCalm();
  const id = seg.group.id;
  const ctl = ctx.settle;
  const gs = ctx.compose?.groups[id];
  const ready = gs?.state === 'ready' && !!gs.blocks?.length;
  const [mode, setMode] = useState<'composed' | 'own'>(() => ctl?.shown.get(id) ?? 'own');
  const [first, setFirst] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The group's bottom edge just before it changed, when it was above the reading position (kept where it was).
  const anchor = useRef<number | null>(null);

  useEffect(() => {
    if (!ready || mode === 'composed' || !ctl || ctl.user.has(id)) return undefined;
    let timer = 0;
    const attempt = (): boolean => {
      if (ctl.shown.get(id) === 'composed' || ctl.user.has(id)) return true;
      const sc = ctl.scroller();
      const { box, view } = boxIn(ref.current, sc);
      const now = performance.now();
      if (!maySwitch({ sinceOpenMs: now - ctl.openedAt, interacted: ctl.interacted, box, view })) return false;
      // Top to bottom: in the first moments, wait a little for a group above that is still being laid out.
      const order = ctx.groupOrder ?? [];
      const earlier = order.slice(0, Math.max(0, order.indexOf(id)));
      const earlierWaiting = earlier.some((g) => {
        const s = ctx.compose?.groups[g];
        return (!s || s.state === 'waiting') && ctl.shown.get(g) !== 'composed';
      });
      const readyFor = gs?.readyAt != null ? now - gs.readyAt : Infinity;
      if (waitsForEarlier({ inGrace: ctl.inGrace(now), earlierWaiting, readyForMs: readyFor })) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          if (attempt()) stop();
        }, 150);
        return false;
      }
      anchor.current = box && box.bottom <= view.top ? box.bottom : null;
      const once = !ctl.settled.has(id);
      ctl.settled.add(id);
      ctl.shown.set(id, 'composed');
      setFirst(once);
      setMode('composed');
      return true;
    };
    const stop = ctl.wait(() => {
      if (attempt()) stop();
    });
    if (attempt()) stop();
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [ready, mode, id, ctl, ctx.compose?.version]);

  // A group above the reading position changed size: move the scroll by the same amount, so the words being read stay
  // put (when the browser's own scroll anchoring already did, the edge has not moved and nothing more happens).
  useLayoutEffect(() => {
    const before = anchor.current;
    anchor.current = null;
    const sc = ctl?.scroller();
    if (before == null || !sc || !ref.current) return;
    const d = ref.current.getBoundingClientRect().bottom - before;
    if (Math.abs(d) >= 1) sc.scrollTop += d;
  }, [mode]);

  const showComposed = mode === 'composed' && ready;
  const toggle = (): void => {
    const next = showComposed ? 'own' : 'composed';
    ctl?.user.add(id);
    ctl?.shown.set(id, next);
    setFirst(false);
    setMode(next);
  };

  return (
    <div ref={ref} class="wa-cg" data-wa-group={id} data-showing={showComposed ? 'new' : ready ? 'original' : 'waiting'}>
      {ready && <GroupMark showing={showComposed ? 'new' : 'original'} onToggle={toggle} />}
      {showComposed && gs?.blocks ? (
        <Composed blocks={gs.blocks} links={seg.links} settle={first && !ctx.reduceMotion} id={id} />
      ) : (
        render(seg.blocks)
      )}
    </div>
  );
}

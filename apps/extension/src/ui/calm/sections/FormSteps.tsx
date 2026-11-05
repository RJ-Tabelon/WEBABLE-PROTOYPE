// Owner: C. The page's form, either all at once (one card per fieldset, its legend as the heading, one field per
// row) or one step at a time ("Step 2 of 4", finished steps fold into summary rows with "Change", the last step is
// "Check your answers"). The page's main action lives in the dock, never before the last step. Help shows on every step.
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { renderLiveValue } from '../../proxy';
import { Blocks, ControlView } from '../Blocks';
import { useCalm } from '../context';
import { useTick } from '../live';
import { type Block, type ControlBlock, type GroupBlock, flatten, stripMarker } from '../model';
import { type FormPlan, type PlanSection, type PlanStep, allBlocks, isFieldUnit, splitActions } from '../plan';
import { HelpCard } from './layouts';

function isHelpBlock(b: Block): boolean {
  return (b.b === 'flow' && b.help) || (b.b === 'control' && b.help && !b.primary);
}

/** The person's answers in one step, read live from the page ("Rosa Martinez", "March 4 1958"). */
export function summarize(blocks: Block[]): { text: string; inputs: number } {
  const parts: string[] = [];
  let inputs = 0;
  for (const b of flatten(blocks)) {
    if (b.b === 'choice') {
      inputs++;
      const v = renderLiveValue(b.el);
      if (v.kind === 'check' && v.checked) parts.push(b.title);
    } else if (b.b === 'field') {
      inputs++;
      const v = renderLiveValue(b.el);
      if (v.kind === 'text' && v.value.trim()) parts.push(v.value.trim().slice(0, 60));
    } else if (b.b === 'select') {
      inputs++;
      const v = renderLiveValue(b.el);
      const o = v.kind === 'select' && v.index >= 0 ? (v.options[v.index] ?? '') : '';
      if (o && !/^(select|choose|--|—|please)/i.test(o.trim())) parts.push(o);
    }
  }
  // Parts of one answer (first and last name, day month year) read as one line; separate answers keep a dot.
  const short = parts.length <= 4 && parts.every((x) => x.length <= 24 && !/·/.test(x));
  return { text: parts.join(short ? ' ' : ' · '), inputs };
}

/** Finished steps, folded into rows: the step, what the page now holds, and "Change". */
function SummaryRows({ steps, bodies, upTo, title }: { steps: PlanStep[]; bodies: Block[][]; upTo: number; title?: string }): JSX.Element | null {
  const ctx = useCalm();
  useTick();
  const rows = steps.slice(0, upTo).map((st, i) => ({ i, label: stripMarker(st.label), ...summarize(bodies[i] ?? []) })).filter((r) => r.inputs > 0);
  if (!rows.length) return null;
  return (
    <div class="wa-summary">
      {title && <h3 class="wa-h-title">{title}</h3>}
      <dl class="wa-rows">
        {rows.map((r) => (
          <div key={r.i} class="wa-sumrow">
            <dt class="wa-sumrow__k">{r.label}</dt>
            <dd class={`wa-sumrow__v${r.text ? '' : ' wa-meta'}`}>{r.text || 'Not answered yet'}</dd>
            <dd class="wa-sumrow__a">
              <button type="button" class="wa-btn wa-btn--link" onClick={() => ctx.goStep(r.i)} aria-label={`Change ${r.label}`}>
                Change
              </button>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A fieldset's own blocks without its legend (the legend is the card's heading). */
function unwrap(bs: Block[]): { title: string | null; blocks: Block[] } {
  const groups = bs.filter((b): b is GroupBlock => b.b === 'group');
  if (groups.length === 1 && bs.filter(isFieldUnit).length === 1) {
    const g = groups[0]!;
    const rest = bs.filter((b) => b !== g && !(b.b === 'heading' && b.text === g.legend));
    return { title: g.legend || null, blocks: [...rest, ...g.blocks] };
  }
  const h = bs[0]?.b === 'heading' ? bs[0] : null;
  return { title: h ? h.text : null, blocks: h ? bs.slice(1) : bs };
}

/**
 * Cards for a form shown all at once: each fieldset is one card with its legend as the heading; loose fields between
 * them share a card; text, the page's notes and its other buttons sit between the cards as they do on the page.
 */
function FieldCards({ blocks, skip, nested = false }: { blocks: Block[]; skip: Set<Element>; nested?: boolean }): JSX.Element {
  const out: JSX.Element[] = [];
  let loose: Block[] = [];
  let between: Block[] = [];
  const flushBetween = (): void => {
    if (between.length) out.push(<div key={`b${out.length}`} class="wa-stack wa-formnote"><Blocks blocks={between} /></div>);
    between = [];
  };
  const flushLoose = (): void => {
    if (loose.length) out.push(<div key={`l${out.length}`} class={nested ? 'wa-form' : 'wa-panel wa-form'}><Blocks blocks={loose} /></div>);
    loose = [];
  };
  for (const b of blocks) {
    const srcEl = b.src instanceof Element ? b.src : b.src.parentElement;
    if (srcEl && skip.has(srcEl)) continue;
    if (b.b === 'group' && isFieldUnit(b)) {
      flushLoose();
      flushBetween();
      out.push(
        <section key={b.key} class={nested ? 'wa-form' : 'wa-panel wa-form'} aria-label={b.legend || undefined}>
          {b.legend && <h2 class="wa-h-title wa-form__title">{b.legend}</h2>}
          <Blocks blocks={b.blocks} />
        </section>,
      );
      continue;
    }
    if (isFieldUnit(b)) {
      flushBetween();
      loose.push(b);
      continue;
    }
    if (loose.length && (b.b === 'heading' || b.b === 'flow')) {
      // Text that sits among loose fields stays with them (a hint, a sub-heading).
      loose.push(b);
      continue;
    }
    flushLoose();
    between.push(b);
  }
  flushLoose();
  flushBetween();
  return <>{out}</>;
}

function Secondary({ items }: { items: ControlBlock[] }): JSX.Element | null {
  if (!items.length) return null;
  return (
    <div class="wa-secondary">
      {items.map((s) => (
        <ControlView key={s.key} b={s} variant={s.role === 'link' ? 'link' : undefined} />
      ))}
    </div>
  );
}

function skipSet(form: FormPlan, also: Element | null): Set<Element> {
  const s = new Set<Element>();
  for (const e of [form.context, also]) {
    if (!e) continue;
    s.add(e);
    e.querySelectorAll('*').forEach((x) => s.add(x));
  }
  return s;
}

/** The whole form at once: cards per fieldset; the main action is in the dock. */
export function SingleForm({ p, form }: { p: PlanSection; form: FormPlan | null }): JSX.Element {
  const bs = allBlocks(p);
  const always = bs.filter(isHelpBlock);
  const { rest, secondary } = splitActions(bs.filter((b) => !isHelpBlock(b)));
  const ctx = useCalm();
  const skip = form ? skipSet(form, ctx.errorEl) : new Set<Element>();
  return (
    <div class="wa-stack wa-formstack">
      <FieldCards blocks={rest} skip={skip} />
      <Secondary items={secondary} />
      {always.length > 0 && <HelpCard blocks={always} />}
    </div>
  );
}

/** One step at a time. The current step and the dock's Continue / Back live in the Calm view (CalmView owns it). */
export function FormSteps({ p, form }: { p: PlanSection; form: FormPlan }): JSX.Element {
  const ctx = useCalm();
  const panel = useRef<HTMLDivElement>(null);
  const steps = form.steps;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = panel.current;
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: ctx.reduceMotion ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  }, [ctx.step]);
  if (!steps) return <SingleForm p={p} form={form} />;

  const n = steps.length;
  const at = Math.min(Math.max(0, ctx.step), n - 1);
  const always: Block[] = [];
  const bodies = steps.map((st) =>
    st.blocks.filter((b) => {
      if (isHelpBlock(b)) {
        always.push(b);
        return false;
      }
      return true;
    }),
  );
  const st = steps[at]!;
  const last = at === n - 1;
  const skip = skipSet(form, ctx.errorEl);
  let content: JSX.Element;
  if (!last) {
    const { title, blocks } = unwrap(bodies[at]!);
    content = (
      <>
        <h2 class="wa-h-section wa-step__title">{stripMarker(title ?? st.label)}</h2>
        <div class="wa-form">
          <Blocks blocks={blocks} />
        </div>
      </>
    );
  } else {
    const { rest, secondary } = splitActions(bodies[at]!);
    content = (
      <>
        <h2 class="wa-h-section wa-step__title">{st.synthetic ? 'Check your answers' : st.label}</h2>
        <SummaryRows steps={steps} bodies={bodies} upTo={n - 1} />
        <div class="wa-form">
          <FieldCards blocks={rest} skip={skip} nested />
        </div>
        <Secondary items={secondary} />
      </>
    );
  }
  return (
    <div class="wa-stack wa-formstack">
      {at > 0 && !last && <SummaryRows steps={steps} bodies={bodies} upTo={at} />}
      <div class="wa-panel wa-steppanel" ref={panel} tabIndex={-1} role="group" aria-label={`Step ${at + 1} of ${n}`}>
        <p class="wa-eyebrow wa-stepof" aria-live="polite">
          Step {at + 1} of {n}
        </p>
        <div class="wa-stepbody wa-fade" key={at}>
          {content}
        </div>
      </div>
      {always.length > 0 && <HelpCard blocks={always} />}
    </div>
  );
}

/** Which step holds a page element (for error links and "Change"). */
export function stepOf(steps: PlanStep[], target: Element): number {
  return steps.findIndex((st) =>
    flatten(st.blocks).some((b) => {
      const e = 'el' in b && b.el instanceof Element ? b.el : b.src instanceof Element ? b.src : null;
      return !!e && (e === target || e.contains(target) || (target.id !== '' && !!e.querySelector?.(`#${CSS.escape(target.id)}`)));
    }),
  );
}

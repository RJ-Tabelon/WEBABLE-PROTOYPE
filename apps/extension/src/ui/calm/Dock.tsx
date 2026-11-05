// Owner: C. The dock at the bottom of the Calm view: context on the left (the page's running total, "Step 2 of 4",
// or its confirmation), one filled button on the right. In a stepped form the dock says "Continue" (and a tonal
// "Back") until the last step; only then does it carry the page's own submit. After the page confirms, the button
// turns into a disabled "Refill requested ✓".
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { PrimaryAction } from './Blocks';
import { useCalm } from './context';
import * as I from './icons';
import { useTick } from './live';
import { controlFor, isShown, newCtx, textOf } from './model';
import type { Outcome } from './outcome';
import type { CalmPlan } from './plan';

function LiveText({ el }: { el: Element }): JSX.Element | null {
  useTick();
  const t = el.isConnected ? textOf(el) : '';
  return t ? <span>{t}</span> : null;
}

export function Dock({ plan, outcome }: { plan: CalmPlan; outcome: Outcome | null }): JSX.Element | null {
  const ctx = useCalm();
  useTick();
  const primary = plan.primary;
  const block = useMemo(() => (primary ? controlFor(primary, newCtx({ primary })) : null), [primary]);
  if (block) block.primary = true;
  const steps = plan.form?.mode === 'steps' ? plan.form.steps : null;
  const n = steps?.length ?? 0;
  const at = steps ? Math.min(Math.max(0, ctx.step), n - 1) : 0;
  const last = !steps || at === n - 1;

  if (outcome?.kind === 'success') {
    const rest = outcome.heading.startsWith(outcome.doneLabel.replace(/\s*✓$/, '')) ? outcome.heading.slice(outcome.doneLabel.replace(/\s*✓$/, '').length).replace(/^[\s✓.:–—-]+/, '') : outcome.heading;
    return (
      <div class="wa-dock" role="region" aria-label="Main action on this page">
        <div class="wa-dock__in">
          <p class="wa-dock__ctx">{rest || outcome.heading}</p>
          <button type="button" class="wa-btn wa-btn--done" disabled>
            {outcome.doneLabel}
          </button>
        </div>
      </div>
    );
  }

  const live = !!primary && primary.isConnected && isShown(primary);
  if (!steps && !(block && live)) return null;
  const context = steps ? (
    <span>
      Step {at + 1} of {n}
    </span>
  ) : plan.form?.context ? (
    <LiveText el={plan.form.context} />
  ) : null;
  return (
    <div class="wa-dock" role="region" aria-label={steps && !last ? 'Steps' : 'Main action on this page'}>
      <div class="wa-dock__in">
        <p class="wa-dock__ctx" aria-live="polite">
          {context}
        </p>
        <div class="wa-dock__btns">
          {steps && at > 0 && (
            <button type="button" class="wa-btn wa-btn--tonal wa-btn--back" onClick={() => ctx.goStep(at - 1)}>
              <I.ArrowLeft />
              <span>Back</span>
            </button>
          )}
          {!last ? (
            <button type="button" class="wa-btn wa-btn--primary wa-btn--continue" onClick={() => ctx.goStep(at + 1)}>
              Continue
            </button>
          ) : block && live ? (
            <PrimaryAction b={block} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

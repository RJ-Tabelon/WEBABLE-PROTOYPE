// Owner: C. One band per FitSpec section: open, collapsed behind a disclosure, or in "More on this page".
import type { JSX } from 'preact';
import { Blocks } from '../Blocks';
import * as I from '../icons';
import type { Block } from '../model';
import { useCalm } from '../context';
import { Disclosure } from '../Disclosure';
import { AdTag, type Marks, isAdItem } from '../markers';
import { type CalmPlan, type FormPlan, type PlanSection, allBlocks } from '../plan';
import { FormSteps, SingleForm } from './FormSteps';
import {
  AsIs, BuyBox, CardGrid, ChipBar, Facts, Gallery, Generic, HelpCard, Hero, LinkGrid, Reading, RowList, leaves,
} from './layouts';

const PANEL_LAYOUTS = new Set(['as_is', 'buy_box', 'facts', 'chip_bar', 'link_grid', 'gallery']);

export function SectionBody({ p, inDrawer = false, form = null }: { p: PlanSection; inDrawer?: boolean; form?: FormPlan | null }): JSX.Element {
  if (!inDrawer && form && form.sectionKey === p.key) {
    return form.mode === 'steps' ? <FormSteps p={p} form={form} /> : <SingleForm p={p} form={form} />;
  }
  switch (p.layout) {
    case 'hero': return <Hero p={p} />;
    case 'buy_box': return <BuyBox p={p} />;
    case 'card_grid': return <CardGrid p={p} />;
    case 'row_list': return <RowList p={p} />;
    case 'reading': return <Reading p={p} />;
    case 'facts': return <Facts p={p} />;
    case 'form_steps': return inDrawer ? <Generic p={p} /> : <SingleForm p={p} form={null} />;
    case 'chip_bar': return <ChipBar p={p} />;
    case 'link_grid': return <LinkGrid p={p} />;
    case 'gallery': return <Gallery p={p} />;
    default: return inDrawer ? <Generic p={p} /> : <AsIs p={p} />;
  }
}

/** Help with several parts ("Need help?", "What you'll need", "Your rights"): one quiet tile per part, side by side. */
function helpParts(bs: Block[]): Array<{ title: string | null; blocks: Block[] }> | null {
  const parts: Array<{ title: string | null; blocks: Block[] }> = [];
  for (const b of bs) {
    if (b.b === 'heading') parts.push({ title: b.text, blocks: [] });
    else if (parts.length) parts[parts.length - 1]!.blocks.push(b);
    else parts.push({ title: null, blocks: [b] });
  }
  const rich = bs.some((b) => b.b === 'list' || b.b === 'heading') || bs.length > 4;
  return rich && parts.length ? parts.filter((x) => x.blocks.length || x.title) : null;
}

export function SectionView({ p, form = null, first = false }: { p: PlanSection; form?: FormPlan | null; first?: boolean }): JSX.Element {
  const name = p.sec.role === 'navigation' && !p.title ? 'Site menu' : p.title ?? p.label;
  if (p.sec.role === 'help') {
    const all = allBlocks(p);
    const parts = helpParts(all);
    if (parts) {
      return (
        <section class="wa-band wa-band--tight" aria-label={name}>
          <div class="wa-helpgrid">
            {parts.map((x, i) => (
              <div key={i} class="wa-helptile">
                {x.title && (
                  <h3 class="wa-h-title">
                    {i === 0 && (
                      <span class="wa-help__icon" aria-hidden="true">
                        <I.Help />
                      </span>
                    )}
                    {x.title}
                  </h3>
                )}
                <Blocks blocks={x.blocks} />
              </div>
            ))}
          </div>
        </section>
      );
    }
    return (
      <section class="wa-band wa-band--tight" aria-label={name}>
        <HelpCard title={p.title} blocks={leaves(all)} />
      </section>
    );
  }
  if (p.state === 'collapsed') {
    return (
      <div class="wa-band wa-band--tight">
        <Disclosure title={name}>
          <SectionBody p={p} />
        </Disclosure>
      </div>
    );
  }
  const isForm = !!form && form.sectionKey === p.key;
  const H = p.titleSize === 'page' ? 'h1' : 'h2';
  const showHead = p.layout !== 'hero' && !!p.title;
  const panel = !isForm && p.lead && PANEL_LAYOUTS.has(p.layout) && !(p.layout === 'as_is' && p.isPrimary);
  return (
    <section class={`wa-band${first ? ' wa-band--task' : ''}${p.lead ? ' wa-band--lead' : ''}`} aria-label={name} data-role={p.sec.role}>
      {showHead && (
        <div class="wa-head">
          <H class={p.titleSize === 'page' ? 'wa-h-page' : 'wa-h-section'}>{p.title}</H>
        </div>
      )}
      {panel ? (
        <div class="wa-panel">
          <SectionBody p={p} form={form} />
        </div>
      ) : (
        <SectionBody p={p} form={form} />
      )}
    </section>
  );
}

/** Round 8: every block of a part comes from paid content Jev is sure about (p >= 0.9): it gets an "Ad" tag. */
function allAds(blocks: Block[], marks: Marks | undefined): boolean {
  if (!blocks.length || !marks?.ads.length) return false;
  return blocks.every((b) => isAdItem(b.src instanceof Element ? b.src : b.src.parentElement, marks));
}

/** "More on this page": every end-drawer part, Jev-folded distraction and unplaced part, behind one disclosure. */
export function Drawer({ plan }: { plan: CalmPlan }): JSX.Element | null {
  const ctx = useCalm();
  if (!plan.drawer.length) return null;
  return (
    <section class="wa-band" aria-label="More on this page">
      {/* Round 8b: no counts (they meant nothing to a reader). */}
      <Disclosure title="More on this page" sub={plan.drawerLabels.join(' · ') || null} openCall={ctx.drawerCall}>
        {plan.drawer.map((d) => (
          <div key={d.key} class="wa-sub">
            <div class="wa-sub__head">
              {allAds(d.section ? allBlocks(d.section) : d.blocks, ctx.marks) && <AdTag />}
              {(plan.drawer.length > 1 || d.label !== 'More on this page') && <h3 class="wa-h-title">{d.label}</h3>}
            </div>
            {d.section ? (
              <SectionBody p={d.section} inDrawer />
            ) : (
              <div class="wa-stack">
                <Blocks blocks={d.blocks} />
              </div>
            )}
          </div>
        ))}
      </Disclosure>
    </section>
  );
}

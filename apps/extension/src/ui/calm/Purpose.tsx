// Owner: P (round 7). The purpose template: what the page exists to show, drawn first with Calm view's meaning
// components (./components, Alfred) from the structure read on this device. A record page leads with the last
// matchup's scoreboard (both logos), then the record, then the history table; a recipe is its ingredients and steps; a
// status check leads with its main action. Every value comes from the page; links press the original element.
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { Blocks, PrimaryAction } from './Blocks';
import { DataTable, LogoMark, Recipe, ScheduleList, Scoreboard, StatGrid } from './components';
import { useCalm } from './context';
import { Disclosure } from './Disclosure';
import type { MeaningItem, MeaningPlan } from './plan';
import { dataTableProps, logoProps, recipeProps, scheduleProps, scoreboardProps, statGridProps } from './purpose-props';

/** More links than this beside one part go behind a disclosure (a history table's row buttons). */
const LINKS_OPEN = 4;

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return !!n(a) && (n(a) === n(b) || n(b).includes(n(a)));
}

const ARIA: Record<MeaningItem['data']['kind'], string> = {
  scoreboard: 'Score', stats: 'Record', table: 'Table', schedule: 'Schedule', recipe: 'Recipe', logo: 'Logo',
};

function ItemLinks({ item }: { item: MeaningItem }): JSX.Element | null {
  if (!item.links.length) return null;
  if (item.links.length <= LINKS_OPEN) {
    return (
      <div class="wa-purpose__links">
        <Blocks blocks={item.links} />
      </div>
    );
  }
  return (
    <div class="wa-purpose__more">
      <Disclosure title="More links">
        <Blocks blocks={item.links} />
      </Disclosure>
    </div>
  );
}

function ItemView({ item, leadTitle, listFirst, firstStats }: { item: MeaningItem; leadTitle: string | null; listFirst: number; firstStats: boolean }): JSX.Element | null {
  const ctx = useCalm();
  const origin = location.origin;
  const d = item.data;
  const body = useMemo((): JSX.Element | null => {
    switch (d.kind) {
      case 'scoreboard':
        return <Scoreboard {...scoreboardProps(d, origin)} />;
      case 'stats': {
        const p = statGridProps(d, { title: same(d.title, leadTitle) ? null : undefined, lead: firstStats });
        return <StatGrid {...p} />;
      }
      case 'table':
        return <DataTable {...dataTableProps(d, { showFirst: Math.max(6, listFirst || 10) })} />;
      case 'schedule': {
        const activate = (id: string): (() => void) | undefined => {
          const el = ctx.api.elementFor(id);
          return el ? () => ctx.click(el) : undefined;
        };
        return <ScheduleList {...scheduleProps(d, activate, origin)} />;
      }
      case 'recipe':
        return <Recipe {...recipeProps(d, origin)} />;
      case 'logo': {
        const p = logoProps(d, origin);
        return p ? <LogoMark {...p} /> : null;
      }
      default:
        return null;
    }
  }, [d, leadTitle, listFirst, firstStats, ctx, origin]);
  if (!body) return null;
  return (
    <section class="wa-purpose__item" data-kind={d.kind} aria-label={ARIA[d.kind]}>
      {body}
      <ItemLinks item={item} />
    </section>
  );
}

/** The template's content, in its order, right after the page's title. */
export function PurposeView({ meaning, leadTitle, listFirst }: { meaning: MeaningPlan; leadTitle: string | null; listFirst: number }): JSX.Element | null {
  if (!meaning.items.length && !meaning.action) return null;
  return (
    <div class="wa-band wa-band--task wa-purpose" data-template={meaning.template}>
      {meaning.orient && (
        <div class="wa-purpose__orient">
          {meaning.orient.title && <h2 class="wa-h-section">{meaning.orient.title}</h2>}
          <Blocks blocks={meaning.orient.blocks} />
        </div>
      )}
      {meaning.action && (
        <div class="wa-purpose__action">
          <PrimaryAction b={meaning.action} />
        </div>
      )}
      {meaning.items.map((it) => (
        <ItemView
          key={it.key} item={it} leadTitle={leadTitle} listFirst={listFirst}
          firstStats={it.data.kind === 'stats' && meaning.items.find((x) => x.data.kind === 'stats') === it}
        />
      ))}
    </div>
  );
}

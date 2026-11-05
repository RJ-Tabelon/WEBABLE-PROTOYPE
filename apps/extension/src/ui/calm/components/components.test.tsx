// @vitest-environment happy-dom
// Owner: Alfred (round 7). Renders each Calm component with the Gators sample and a short recipe.
import { render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { componentsCss, DataTable, LogoMark, Recipe, ScheduleList, Scoreboard, StatGrid } from './index';
import {
  gatorsColumns, gatorsNumericCols, gatorsRows, gatorsSchedule, gatorsScore, gatorsShowFirst, gatorsStats, sampleRecipe,
} from './preview';

function mount(node: JSX.Element): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  render(node, el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('Calm meaning components', () => {
  it('keeps styles free of CSS url() and sizes type from tokens', () => {
    expect(componentsCss.includes('url(')).toBe(false);
    expect(componentsCss).not.toMatch(/font-size:\s*\d/);
    expect(componentsCss).toContain('var(--wa-focus)');
    expect(componentsCss).toContain('overflow-x:auto');
    expect(componentsCss).toContain('tabular-nums');
    expect(componentsCss).toContain('repeat(2,minmax(0,1fr))');
    expect(componentsCss).toContain('repeat(4,minmax(0,1fr))');
  });

  it('shows the series record with lead numbers and labels underneath', () => {
    const el = mount(<StatGrid title="Series record" items={gatorsStats} />);
    const text = el.textContent ?? '';
    expect(text).toContain('Series record');
    expect(text).toContain('54');
    expect(text).toContain('Wins');
    expect(text).toContain('22');
    expect(text).toContain('Losses');
    expect(text).toContain('30-6');
    expect(text).toContain('Home record');
    expect(text).toContain('22-13');
    expect(text).toContain('Away record');
    expect(text).toContain('since 1917');
    const leads = [...el.querySelectorAll('[data-emphasis="lead"]')].map((n) => n.textContent ?? '');
    expect(leads.some((t) => t.includes('54') && t.includes('Wins'))).toBe(true);
    expect(leads.some((t) => t.includes('22') && t.includes('Losses'))).toBe(true);
    expect(el.querySelector('h2')?.textContent).toBe('Series record');
  });

  it('shows the last matchup, logos, the winner, and the line score', () => {
    const el = mount(<Scoreboard {...gatorsScore} />);
    const text = el.textContent ?? '';
    expect(text).toContain('Last matchup');
    expect(text).toContain('11/8/2025');
    expect(el.querySelector('time')?.getAttribute('datetime')).toBe('2025-11-08');
    expect(text).toContain('at');
    const sides = [...el.querySelectorAll('.wa-scoreboard__side')];
    const florida = sides.find((n) => n.textContent?.includes('Florida'));
    const kentucky = sides.find((n) => n.textContent?.includes('Kentucky'));
    expect(florida?.textContent).toContain('7');
    expect(florida?.textContent).toContain('Away');
    expect(florida?.hasAttribute('data-winner')).toBe(false);
    expect(florida?.textContent).not.toContain('Won');
    expect(kentucky?.textContent).toContain('38');
    expect(kentucky?.textContent).toContain('Home');
    expect(kentucky?.textContent).toContain('Won');
    expect(kentucky?.hasAttribute('data-winner')).toBe(true);
    const alts = [...el.querySelectorAll('img')].map((img) => img.getAttribute('alt'));
    expect(alts).toEqual(['Florida', 'Kentucky']);
    const line = el.querySelector('.wa-scoreboard__lines');
    expect(line?.querySelector('caption')?.textContent).toBe('Line score');
    const rows = [...(line?.querySelectorAll('tbody tr') ?? [])].map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('Florida');
    expect(rows[0]).toContain('7');
    expect(rows[0]).toContain('0');
    expect(rows[1]).toContain('Kentucky');
    expect(rows[1]).toContain('3');
    expect(rows[1]).toContain('21');
    expect(line?.querySelectorAll('th[scope="col"]').length).toBe(5);
    expect(line?.querySelectorAll('th[scope="row"]').length).toBe(2);
  });

  it('folds the game table and scrolls it inside its own box', () => {
    const el = mount(
      <DataTable
        caption="Florida vs Kentucky"
        columns={gatorsColumns}
        rows={gatorsRows}
        numericCols={gatorsNumericCols}
        showFirst={gatorsShowFirst}
      />,
    );
    const table = el.querySelector('table');
    expect(table?.querySelector('caption')?.textContent).toBe('Florida vs Kentucky');
    expect(table?.querySelectorAll('thead th').length).toBe(gatorsColumns.length);
    expect(table?.querySelectorAll('tbody tr').length).toBe(gatorsShowFirst);
    const first = table?.querySelector('tbody tr')?.textContent ?? '';
    expect(first).toContain('November 8');
    expect(first).toContain('2025');
    expect(first).toContain('7');
    expect(first).toContain('38');
    const season = table?.querySelector('tbody td[data-num]');
    expect(season?.textContent).toBe('2025');
    const scroll = el.querySelector('.wa-datatable__scroll');
    expect(scroll?.getAttribute('tabindex')).toBe('0');
    const button = el.querySelector('button');
    expect(button?.textContent).toBe(`Show all ${gatorsRows.length} rows`);
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(el.querySelectorAll('tbody tr').length).toBe(gatorsRows.length);
    expect(button?.textContent).toBe(`Show the first ${gatorsShowFirst} rows`);
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(gatorsRows.length).toBeGreaterThan(gatorsShowFirst);
  });

  it('marks the current game and uses buttons only when a row can activate', () => {
    const activate = vi.fn();
    const items = gatorsSchedule.map((item, i) => (i === 0 ? { ...item, onActivate: activate } : { ...item, onActivate: undefined }));
    const el = mount(<ScheduleList title="Recent games" items={items} currentIndex={0} />);
    expect(el.querySelectorAll('button.wa-schedule__row').length).toBe(1);
    expect(el.querySelectorAll('div.wa-schedule__row').length).toBe(3);
    expect(el.querySelector('a')).toBeNull();
    const current = el.querySelector('[aria-current="true"]');
    expect(current?.textContent).toContain('Current');
    expect(current?.textContent).toContain('at Kentucky');
    expect(current?.textContent).toContain('L 7-38');
    expect(current?.textContent).toContain('floridagators.com');
    expect(current?.querySelector('img')?.getAttribute('alt')).toBe('Kentucky');
    act(() => {
      current?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(activate).toHaveBeenCalledOnce();
    expect(el.querySelector('button')?.getAttribute('type')).toBe('button');
  });

  it('crosses off an ingredient in memory and numbers the steps', () => {
    localStorage.setItem('wa-recipe', 'leave-this');
    const el = mount(<Recipe {...sampleRecipe} />);
    expect(el.querySelector('h2')?.textContent).toBe('Chocolate chip cookies');
    expect(el.querySelector('img')?.getAttribute('alt')).toBe('A chocolate chip cookie');
    expect(el.textContent).toContain('15 min');
    expect(el.textContent).toContain('Prep');
    expect(el.textContent).toContain('Ingredients');
    expect(el.textContent).toContain('Steps');
    expect(el.textContent).toContain('Notes');
    const boxes = [...el.querySelectorAll('input[type="checkbox"]')];
    expect(boxes.length).toBe(sampleRecipe.ingredients.length);
    expect(el.querySelectorAll('ol.wa-recipe__steps li').length).toBe(sampleRecipe.steps.length);
    const first = boxes[0] as HTMLInputElement;
    act(() => {
      first.click();
    });
    expect(first.checked).toBe(true);
    expect(el.querySelector('[data-done]')?.textContent ?? '').toContain('butter');
    expect(localStorage.getItem('wa-recipe')).toBe('leave-this');
    expect(localStorage.length).toBe(1);
  });

  it('renders a logo with its name at each size', () => {
    const picture = { src: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E', alt: 'Florida', ratio: 1 };
    const el = mount(
      <div>
        <LogoMark picture={picture} label="Florida" size="small" />
        <LogoMark picture={picture} label="Kentucky" size="medium" />
        <LogoMark picture={picture} label="Florida Gators" size="large" />
      </div>,
    );
    const marks = [...el.querySelectorAll('.wa-logomark')];
    expect(marks.map((n) => n.getAttribute('data-size'))).toEqual(['small', 'medium', 'large']);
    expect(marks.map((n) => n.querySelector('img')?.getAttribute('alt'))).toEqual(['Florida', 'Florida', 'Florida']);
    expect(marks[2]?.textContent).toContain('Florida Gators');
  });
});

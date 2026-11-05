// @vitest-environment happy-dom
// Smoke run of the flow: Welcome, an instruction card per step, the steps themselves, the real-websites part (with the
// site runner mocked) and its two questions, then Results with the evidence. Nothing shows a result before the end.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { SiteTaskResult, SiteTaskSpec } from '../../src/sitetask/types';

vi.mock('./results/Results', () => ({
  Results: (p: { measured: boolean; evidence?: { busySlowdown: { busyName: string } | null; sites: unknown[] } | null }) => (
    <div id="results-stub">
      {p.measured ? 'measured' : 'saved'}|{p.evidence ? `${p.evidence.sites.length} sites` : 'no evidence'}|
      {p.evidence?.busySlowdown?.busyName ?? ''}
    </div>
  ),
}));

const SPECS: SiteTaskSpec[] = [
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Gainesville,_Florida', prompt: 'the link to the University of Florida', target: {}, busy: false },
  { id: 'cnn', name: 'CNN', url: 'https://www.cnn.com', prompt: 'Sports', target: {}, busy: true },
  { id: 'allrecipes', name: 'Allrecipes', url: 'https://www.allrecipes.com', prompt: 'Jump to Recipe', target: {}, busy: true },
];

function result(spec: SiteTaskSpec, ms: number): SiteTaskResult {
  return {
    id: spec.id, name: spec.name, busy: spec.busy, found: true, skipped: false, ms, wrongClicks: 0, nearMisses: 0, slips: 0,
    presses: 2, scrollScreens: 1, motionSeen: spec.busy, adsSeen: spec.busy ? 5 : 0,
  };
}

// The real runSiteTasks API: onProgress(done, total) with 0 at the start and after each site; resolves with one result
// per task (skipped ones when the sites couldn't be opened). 'fail' mimics a run that never opened.
const hold: { release: (() => void) | null; fail: boolean } = { release: null, fail: false };
vi.mock('./logic/sites', () => ({
  SITE_TASKS: SPECS,
  runSiteTasks: (tasks: SiteTaskSpec[], onProgress: (done: number, total: number) => void) =>
    new Promise<SiteTaskResult[]>((resolve) => {
      onProgress(0, tasks.length);
      if (hold.fail) {
        onProgress(tasks.length, tasks.length);
        resolve(tasks.map((t) => ({ ...result(t, 0), found: false, skipped: true, ms: null, presses: 0, scrollScreens: 0 })));
        return;
      }
      onProgress(1, tasks.length);
      hold.release = () => {
        onProgress(3, tasks.length);
        resolve([result(tasks[0]!, 4000), result(tasks[1]!, 12000), result(tasks[2]!, 9000)]);
      };
    }),
}));

const tick = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const PIXELS = /\b\d+(\.\d+)?\s*px\b|pixel/i;

describe('onboarding flow', () => {
  it('goes from Welcome through the instruction cards and the real websites to Results', async () => {
    const { App } = await import('./App');
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(() => render(<App />, root));
    await tick(20);
    expect(root.textContent).toContain('Let’s set up the web for you.');

    const click = async (sel: string) => {
      const el = root.querySelector<HTMLButtonElement>(sel);
      expect(el, sel).toBeTruthy();
      await act(() => el!.click());
      await tick(5);
      // Round 8c: nothing learned is shown while the flow runs, and no pixels anywhere.
      expect(root.querySelector('.fl-rail, .fl-chip')).toBeNull();
      expect(root.textContent ?? '').not.toMatch(PIXELS);
    };
    // Mouse user: a pointer press before Start.
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', isPrimary: true }));
    await click('[data-answer="start"]');
    expect(root.querySelector('.fl-modal')?.textContent).toContain('Reading · 1 of 4');

    await click('[data-answer="start-step"]');
    expect(root.querySelector('.fl-para')).toBeTruthy();
    await click('[data-answer="larger"]');
    await click('[data-answer="comfortable"]');
    expect(root.querySelector('.fl-modal')?.textContent).toContain('True or false?');

    // Skip the rest one card at a time; the part that finished says so, neutrally.
    for (const label of ['Which word is it?', 'Light or dark?', 'Click the dots', 'Now, some real websites']) {
      await click('[data-answer="skip-step"]');
      expect(root.querySelector('.fl-modal')?.textContent).toContain(label);
      if (label === 'Click the dots') expect(root.querySelector('.fl-modal')?.textContent).toContain('Reading is done.');
    }

    // The real websites: a calm waiting card with where they are, then the questions.
    await click('[data-answer="start-step"]');
    await tick(5);
    expect(root.querySelector('.fl-sites')?.textContent).toContain('We’ve opened CNN in a new tab.');
    expect(root.querySelector('.fl-sites')?.textContent).toContain('2 of 3');
    await act(() => hold.release?.());
    await tick(5);
    expect(root.textContent).toContain('Which site was easier to find things on?');
    expect(root.querySelector('[data-answer="first"]')?.textContent).toBe('Wikipedia');
    expect(root.querySelector('[data-answer="second"]')?.textContent).toBe('CNN');
    await click('[data-answer="first"]');
    expect(root.textContent).toContain('Did anything get in your way?');
    await click('[data-answer="moving things"]');
    await click('[data-answer="done-find"]');
    // Round 10: the last step, "Your context" (skipped here; ContextTask has its own test in AiScreen.smoke).
    expect(root.querySelector('.fl-modal')?.textContent).toContain('Bring your context');
    expect(root.querySelector('.fl-modal')?.textContent).toContain('Finding is done.');
    await click('[data-answer="skip-step"]');
    expect(root.textContent).toContain('You’re all set.');
    await tick(1800);
    const stub = root.querySelector('#results-stub')?.textContent ?? '';
    expect(stub).toContain('measured');
    expect(stub).toContain('3 sites');
    expect(stub).toContain('CNN');

    const g = globalThis as unknown as {
      __fitting: { raw: () => { finding: { trials: unknown[]; preferredCalm: number; gotInWay: string[] }; allPresses: unknown[] } };
    };
    const r = g.__fitting.raw();
    expect(r.finding.trials).toHaveLength(3);
    expect(r.finding.preferredCalm).toBe(2);
    expect(r.finding.gotInWay).toEqual(['moving things']);
  });

  it('says so plainly when the websites could not be opened, then goes on', async () => {
    hold.fail = true;
    const { App } = await import('./App');
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(() => render(<App />, root));
    await tick(20);
    const click = async (sel: string) => {
      const el = root.querySelector<HTMLButtonElement>(sel);
      expect(el, sel).toBeTruthy();
      await act(() => el!.click());
      await tick(5);
    };
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', isPrimary: true }));
    await click('[data-answer="start"]');
    for (let i = 0; i < 5; i++) await click('[data-answer="skip-step"]');
    expect(root.querySelector('.fl-modal')?.textContent).toContain('Now, some real websites');
    await click('[data-answer="start-step"]');
    await tick(5);
    expect(root.textContent).toContain('We couldn’t open the websites right now.');
    await click('[data-answer="sites-go-on"]');
    expect(root.textContent).toContain('Did anything get in your way?');
    expect(root.textContent).not.toContain('Which site was easier');
    hold.fail = false;
  });

  it('opens Results with demo evidence from the test hook', async () => {
    const { App } = await import('./App');
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(() => render(<App />, root));
    await tick(20);
    const g = globalThis as unknown as { __fitting: { finish: (n: string) => Promise<void>; phase: () => string } };
    await act(() => g.__fitting.finish('rosa'));
    await tick(5);
    expect(g.__fitting.phase()).toBe('results');
    expect(root.querySelector('#results-stub')?.textContent).toContain('3 sites');
  });
});

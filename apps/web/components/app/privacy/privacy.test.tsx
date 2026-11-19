import { ToastProvider } from '@webable/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { copyProblems } from '../../../lib/auth/copy-lint';
import { CONSENT_FACTS, ConsentSwitches } from './ConsentSwitches';
import { emptyReceiptsNote, RECEIPT_DESTINATION } from './Receipts';

vi.mock('../../../lib/data/actions', () => ({
  updateAccountAction: vi.fn(),
}));

/** The consents on /app/privacy, and how receipts name where a request went. */

describe('consents', () => {
  const html = renderToStaticMarkup(
    <ToastProvider>
      <ConsentSwitches
        cloudAnalysis={true}
        aiLayout={false}
        productLearning={false}
      />
    </ToastProvider>,
  );

  it('has a switch for better Fit view layouts, off unless turned on', () => {
    const switches = [...html.matchAll(/<button[^>]*role="switch"[^>]*>/g)];
    expect(switches).toHaveLength(3);
    expect(html).toContain('Better Fit view layouts (OpenAI)');
    const checked = switches.map((m) => /aria-checked="true"/.test(m[0]));
    expect(checked).toEqual([true, false, false]);
  });

  it('says exactly what layout planning sends, to whom, and what is kept (docs/10 §8)', () => {
    const facts = CONSENT_FACTS.aiLayout;
    expect(facts.map((f) => f.term)).toEqual([
      'When',
      'What is sent',
      'To whom',
      'Never sent',
      'Worth knowing',
      'Kept',
    ]);
    const text = facts.map((f) => f.detail).join(' ');
    expect(text).toContain('to OpenAI');
    expect(text).toContain('Only after you open Fit view');
    expect(text).toContain('anything you type, the address or title');
    expect(text).toContain(
      'OpenAI doesn’t train on it and may keep it for up to 30 days for abuse checks.',
    );
    for (const fact of facts)
      expect(copyProblems(fact.detail), fact.detail).toEqual([]);
  });
});

describe('receipts', () => {
  it('names each destination after the size', () => {
    expect(RECEIPT_DESTINATION).toEqual({
      page_analysis: 'to page analysis',
      layout_planning: 'to OpenAI, for a Fit view layout',
    });
  });

  it('says what would be sent from the consents that are on', () => {
    const notes = [
      emptyReceiptsNote({ cloudAnalysis: false, aiLayout: false }),
      emptyReceiptsNote({ cloudAnalysis: true, aiLayout: false }),
      emptyReceiptsNote({ cloudAnalysis: false, aiLayout: true }),
      emptyReceiptsNote({ cloudAnalysis: true, aiLayout: true }),
    ];
    expect(notes[0]).toBe(
      'Page analysis and better Fit view layouts are off, so nothing will be sent.',
    );
    expect(notes[2]).toContain('a page outline for a Fit view layout');
    for (const note of notes) expect(copyProblems(note), note).toEqual([]);
  });
});

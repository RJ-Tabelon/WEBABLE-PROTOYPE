import { Button, FitMark, SectionHeader } from '@webable/ui';
import type { Metadata } from 'next';
import { AppShell } from '../../../../components/shell/AppShell';

export const metadata: Metadata = { title: 'App shell preview' };

const ROWS = [
  {
    label: 'Text size',
    line: 'You read most comfortably at 19 px or larger.',
    from: 16,
    to: 19,
    unit: 'px',
    source: 'Measured today',
  },
  {
    label: 'Click targets',
    line: 'Buttons and links get at least 56 px to land on.',
    from: 44,
    to: 56,
    unit: 'px',
    source: 'Measured today',
  },
  {
    label: 'Line spacing',
    line: 'A little more room between lines.',
    from: 1.5,
    to: 1.8,
    source: 'Set by you',
  },
] as const;

export default function AppShellPreview() {
  return (
    <AppShell railFooter="alex@example.com">
      <div className="g-doc">
        <header>
          <h1 className="wa-page-title">Your fit</h1>
          <p
            className="wa-body wa-secondary"
            style={{
              marginBlockStart: 'var(--space-3)',
              maxInlineSize: 'var(--w-prose)',
            }}
          >
            Here’s what WebAble will change, and why. You can adjust any of it.
          </p>
        </header>
        <section aria-labelledby="fit-rows">
          <SectionHeader
            eyebrow="3 settings · from your last Tune"
            title="Reading and pointing"
            titleId="fit-rows"
          />
          <ul role="list" className="g-doc__rows">
            {ROWS.map((row) => (
              <li key={row.label} className="g-doc__row">
                <div>
                  <p className="g-doc__label">{row.label}</p>
                  <p className="g-doc__line">{row.line}</p>
                  <p className="g-doc__source">{row.source}</p>
                </div>
                <FitMark
                  size="readout"
                  from={row.from}
                  to={row.to}
                  unit={'unit' in row ? row.unit : undefined}
                />
                <Button variant="ghost" size="md">
                  Adjust
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

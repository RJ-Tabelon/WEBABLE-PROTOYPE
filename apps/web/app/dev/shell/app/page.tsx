import { Button, FitRow, SectionHeader, type FitValue } from '@webable/ui';
import type { Metadata } from 'next';
import { AppShell } from '../../../../components/shell/AppShell';

export const metadata: Metadata = { title: 'App shell preview' };

const ROWS: ReadonlyArray<{
  label: string;
  sentence: string;
  source?: string;
  value: FitValue;
  changed: boolean;
}> = [
  {
    label: 'Text size',
    sentence: 'You read most comfortably at 19 px or larger.',
    source: 'Measured today',
    value: {
      kind: 'change',
      before: 16,
      after: 19,
      unit: 'px',
      srText: '16 to 19 pixels',
    },
    changed: true,
  },
  {
    label: 'Click targets',
    sentence: 'Buttons and links get at least 56 px to land on.',
    source: 'Measured today',
    value: {
      kind: 'change',
      before: 44,
      after: 56,
      unit: 'px',
      srText: '44 to 56 pixels',
    },
    changed: true,
  },
  {
    label: 'Line spacing',
    sentence: 'A little more room between lines.',
    source: 'Set by you',
    value: {
      kind: 'change',
      before: '1.5',
      after: '1.8',
      srText: '1.5 to 1.8',
    },
    changed: true,
  },
  {
    label: 'Steady clicks',
    sentence: 'Clicks work as each site made them.',
    value: { kind: 'same', srText: 'As the site made it' },
    changed: false,
  },
];

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
            eyebrow="4 settings · from your last Tune"
            title="Reading and pointing"
            titleId="fit-rows"
            link={{ href: '/dev/components#fit', label: 'Fit marks' }}
          />
          <ul role="list" className="wa-fitrows">
            {ROWS.map((row) => (
              <FitRow
                key={row.label}
                as="li"
                density="working"
                headingLevel={3}
                {...row}
                action={
                  <Button variant="ghost" size="md" flush="end">
                    Adjust
                  </Button>
                }
              />
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

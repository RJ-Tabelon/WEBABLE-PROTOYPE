import { useEffect, useState } from 'react';
import { Button, Disclosure, Slider, SwitchRow, useToast } from '@webable/ui';

import { COPY } from '@/lib/popup/copy';
import {
  isApplied,
  levelIndex,
  SPACING_STEPS,
  TEXT_STEPS,
  valueAt,
} from '@/lib/popup/format';
import type { TabDetail } from '@/lib/sw/ui';

import type { PopupApi } from './usePopup';

const NBSP = '\u00a0';
const READING_GUIDE = 'Reading guide';

/** Local control state that follows the worker's value when it changes. */
function useFollow<T>(value: T): [T, (v: T) => void] {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return [local, setLocal];
}

/**
 * "Adjust for this site" (design-final 10.3): text size and line spacing on
 * their reviewed ladders (slider plus stepper), three switches, and "Use these
 * on every site". The page follows each change 150 ms after the control
 * rests; nothing animates on the page while dragging. A control shows the
 * accent only while its change is applied on the page; otherwise it is ink.
 */
export function AdjustPanel({ view, api }: { view: TabDetail; api: PopupApi }) {
  const toast = useToast();
  const applied = (
    op: 'text_floor' | 'line_spacing' | 'target_size' | 'calm_motion',
  ) => isApplied(view.changes, op);
  const targetsOn =
    !view.site.blocks.includes('target_size') &&
    (view.site.pins.includes('target_size') || applied('target_size'));
  const motionOn =
    !view.site.blocks.includes('calm_motion') &&
    (view.site.pins.includes('calm_motion') || applied('calm_motion'));

  const setLevel = (op: 'text_floor' | 'line_spacing', level: number) =>
    void api.act({ type: 'ui:set-level', op, level, scope: 'site' });
  const [text, setText] = useFollow(
    valueAt(TEXT_STEPS, view.levels.text_floor),
  );
  const [spacing, setSpacing] = useFollow(
    valueAt(SPACING_STEPS, view.levels.line_spacing),
  );
  // The guide is for this tab only; it is on while its overlay is applied.
  const [guide, setGuide] = useFollow(isApplied(view.changes, 'reading_guide'));

  return (
    <section className="pp-section pp-adjust">
      <Disclosure title={COPY.adjust} density="compact" headingLevel={2}>
        <div className="pp-adjust__controls">
          <Slider
            label={COPY.textSize}
            steps={TEXT_STEPS}
            value={text}
            onValueChange={setText}
            format={(v) => `${v}${NBSP}px`}
            formatSpoken={(v) => `${v} pixels`}
            changesPage={applied('text_floor')}
            onValueCommit={(v) =>
              setLevel('text_floor', levelIndex(TEXT_STEPS, v))
            }
          />
          <Slider
            label={COPY.lineSpacing}
            steps={SPACING_STEPS}
            value={spacing}
            onValueChange={setSpacing}
            format={(v) => v.toFixed(1)}
            changesPage={applied('line_spacing')}
            onValueCommit={(v) =>
              setLevel('line_spacing', levelIndex(SPACING_STEPS, v))
            }
          />
          <div className="pp-adjust__switches">
            <SwitchRow
              label={COPY.targets}
              description={COPY.targetsDesc}
              changesPage={applied('target_size')}
              checked={targetsOn}
              onCheckedChange={(on) =>
                void api.act({ type: 'ui:quick', key: 'targets', on })
              }
            />
            <SwitchRow
              label={COPY.motion}
              changesPage={applied('calm_motion')}
              checked={motionOn}
              onCheckedChange={(on) =>
                void api.act({ type: 'ui:quick', key: 'calm', on })
              }
            />
            <SwitchRow
              label={READING_GUIDE}
              changesPage={guide}
              checked={guide}
              onCheckedChange={(on) => {
                setGuide(on);
                void api.act({ type: 'ui:reading-guide', on });
              }}
            />
          </div>
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={() =>
              void api.act({ type: 'ui:use-everywhere' }).then((next) => {
                if (next)
                  toast.show({
                    message: 'These settings now apply on every site.',
                  });
              })
            }
          >
            {COPY.everywhere}
          </Button>
        </div>
      </Disclosure>
    </section>
  );
}

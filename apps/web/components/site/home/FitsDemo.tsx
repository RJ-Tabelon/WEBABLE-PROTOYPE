'use client';

import { FitMark, SegmentedControl, Select, StatusShape } from '@webable/ui';
import { useId, useState } from 'react';
import { FrameChrome } from '../Frame';
import {
  PROFILE_FITS,
  changeCount,
  marksFor,
  type ProfileFitId,
} from '../sample/model';
import { SamplePage } from '../sample/SamplePage';

const OPTIONS = PROFILE_FITS.map((p) => ({ value: p.id, label: p.short }));

function isProfileFitId(value: string): value is ProfileFitId {
  return PROFILE_FITS.some((p) => p.id === value);
}

/**
 * "Different people, different fits": one sample page, three functional fits.
 * A segmented control switches them; below 34em (where three labels would not fit)
 * it becomes a native select, as design-final §7.5 requires.
 */
export function FitsDemo() {
  const [selected, setSelected] = useState<ProfileFitId>('reading');
  const titleId = useId();
  const current =
    PROFILE_FITS.find((p) => p.id === selected) ?? PROFILE_FITS[0]!;
  const marks = marksFor(current.fit);

  return (
    <div className="ws-fits">
      <div className="ws-fits__controls">
        <div className="ws-fits__segmented">
          <SegmentedControl<ProfileFitId>
            label="Choose a fit"
            options={OPTIONS}
            value={selected}
            onValueChange={setSelected}
          />
        </div>
        <Select
          className="ws-fits__select"
          label="Choose a fit"
          options={PROFILE_FITS.map((p) => ({ value: p.id, label: p.title }))}
          value={selected}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (isProfileFitId(next)) setSelected(next);
          }}
        />

        <div aria-live="polite">
          <h3 id={titleId} className="ws-fits__title">
            {current.title}
          </h3>
          <p className="ws-fits__summary">{current.summary}</p>
        </div>

        <ul role="list" className="ws-changes" aria-labelledby={titleId}>
          {marks.map((m) => (
            <li key={m.id}>
              <span className="ws-changes__label">{m.label}</span>
              <FitMark from={m.from} to={m.to} unit={m.unit} />
            </li>
          ))}
        </ul>
      </div>

      <figure className="ws-demo" aria-label={`Sample page: ${current.title}`}>
        <div className="ws-frame">
          <FrameChrome
            status={
              <>
                <StatusShape
                  state="adapted"
                  size={16}
                  className="ws-frame__glyph"
                />
                <span>Adapted · {changeCount(current.fit)} changes</span>
              </>
            }
          />
          <div className="ws-frame__view" data-theme="light">
            <SamplePage fit={current.fit} showHitAreas />
          </div>
        </div>
      </figure>
    </div>
  );
}

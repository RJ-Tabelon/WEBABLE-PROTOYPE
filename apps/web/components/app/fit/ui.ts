import type { FitProfile } from '@webable/core';
import { fitUiVars } from '@webable/core/profile/describe';

import type { FitUiInput } from '../../shell/fit-ui';

/**
 * The person's fit as WebAble's own UI wears it (design-final §2.3): text scale,
 * target minimum, extra leading and spacing, and stillness. Plain data, so a
 * server component can compute it and a client component can apply it.
 */
export interface FitUi {
  vars: Record<string, string>;
  motion?: 'reduce';
}

export function fitUiFor(profile: FitProfile): FitUi {
  const { style, attributes } = fitUiVars(profile);
  return attributes['data-wa-motion'] === 'reduce'
    ? { vars: { ...style }, motion: 'reduce' }
    : { vars: { ...style } };
}

/** The shape `writeFitUi` accepts. */
export function toFitUiInput(ui: FitUi): FitUiInput {
  return ui.motion ? { vars: ui.vars, motion: ui.motion } : { vars: ui.vars };
}

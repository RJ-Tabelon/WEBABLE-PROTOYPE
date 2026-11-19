import type { DimId, FitProfile } from '@webable/core';
import type { FitRow, FitRowId } from '@webable/core/profile/describe';
import type { FitValue } from '@webable/ui';

import type { LearnedDim } from '../changes/learned';
import { describeValue } from './adjust';
import { fitValueOf, withAfter } from './value';

/**
 * What WebAble learned as you browse, on "Your fit": when a learned value
 * differs from the fit, the row shows the value in effect ("16 → 20 px"), says
 * where the fit's own value came from ("Tune: 18 px · adjusted as you
 * browse"), and offers to go back to it ([Use 18 px]). Pure.
 */

/** Fit rows that learning adjusts, by the learner's dimension. */
export const ROW_FOR_DIM: Readonly<Partial<Record<DimId, FitRowId>>> = {
  textPx: 'textSize',
  lineHeight: 'lineSpacing',
  lineCh: 'lineLength',
  targetPx: 'targets',
};

const SPOKEN_UNIT: Readonly<Partial<Record<FitRowId, string>>> = {
  textSize: 'pixels',
  targets: 'pixels',
  lineLength: 'characters',
};

const UNIT: Readonly<Partial<Record<FitRowId, string>>> = {
  textSize: 'px',
  targets: 'px',
  lineLength: 'characters',
};

function fitNumber(profile: FitProfile, row: FitRowId): number | null {
  switch (row) {
    case 'textSize':
      return profile.vision.textMinPx.value;
    case 'lineSpacing':
      return profile.vision.lineHeight.value;
    case 'lineLength':
      return profile.vision.maxLineCh.value;
    case 'targets':
      return profile.motor.minTargetPx.value;
    default:
      return null;
  }
}

/** The same rounding the learned summary uses: tenths for spacing, whole numbers otherwise. */
function rounded(row: FitRowId, n: number): number {
  return row === 'lineSpacing' ? Math.round(n * 10) / 10 : Math.round(n);
}

export interface LearnedOverride {
  dim: DimId;
  row: FitRowId;
  /** The fit's own value in words ("18 px"). */
  fitShown: string;
  /** The row's value as it is in effect. */
  value: FitValue;
  /** "Tune: 18 px · adjusted as you browse" */
  source: string;
  /** "Use 18 px" */
  useLabel: string;
}

export function learnedOverrides(
  profile: FitProfile,
  rows: readonly FitRow[],
  dims: readonly LearnedDim[],
): Map<FitRowId, LearnedOverride> {
  const out = new Map<FitRowId, LearnedOverride>();
  for (const dim of dims) {
    const rowId = ROW_FOR_DIM[dim.dim];
    if (!rowId) continue;
    const row = rows.find((r) => r.id === rowId);
    const fit = fitNumber(profile, rowId);
    if (!row || fit === null) continue;
    const fitAmount = rounded(rowId, fit);
    const learned = rounded(rowId, dim.toValue);
    if (learned === fitAmount) continue;

    const base = fitValueOf(row);
    const spoken = SPOKEN_UNIT[rowId];
    const unit = UNIT[rowId];
    let value: FitValue;
    if (base.kind === 'change' || base.kind === 'floor') {
      const before = base.kind === 'change' ? `${base.before} to ` : '';
      value = withAfter(
        base,
        learned,
        `${before}${learned}${spoken ? ` ${spoken}` : ''}`,
      );
    } else {
      value = {
        kind: 'change',
        before: fitAmount,
        after: learned,
        ...(unit ? { unit } : {}),
        srText: `${fitAmount} to ${learned}${spoken ? ` ${spoken}` : ''}`,
      };
    }

    const fitShown = describeValue(rowId, fit);
    const origin = row.sourceKind === 'measured' ? 'Tune' : 'Your fit';
    out.set(rowId, {
      dim: dim.dim,
      row: rowId,
      fitShown,
      value,
      source: `${origin}: ${fitShown} · adjusted as you browse`,
      useLabel: `Use ${fitShown}`,
    });
  }
  return out;
}

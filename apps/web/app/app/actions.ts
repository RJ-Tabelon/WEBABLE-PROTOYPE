'use server';

import type { FitProfile } from '@webable/core';
import { revalidatePath } from 'next/cache';

import {
  type AdjustInput,
  adjustInputSchema,
  applyAdjustment,
  copyRow,
} from '../../components/app/fit/adjust';
import { getCurrentFit, listFitHistory, saveFit } from '../../lib/data/fit';
import { forgetLearning, resetLearned } from '../../lib/data/learning';
import { type DataResult, fail, issuePaths, ok } from '../../lib/data/result';
import { z } from 'zod';

export interface AdjustedFit {
  version: number;
  /** The version this adjustment replaced (what Undo restores from). */
  previousVersion: number;
  profile: FitProfile;
  createdAt: string;
}

/**
 * Adjust one row of the current fit and save it as a new version (source
 * 'adjustment'). The change is applied on the server to the latest saved fit,
 * so two tabs can't overwrite each other's other rows. Undo is a `restore` of
 * that row from the previous version, saved as another version: history keeps
 * both. Input is validated here; the profile is validated again by saveFit.
 */
export async function adjustFitAction(
  input: AdjustInput,
): Promise<DataResult<AdjustedFit>> {
  const parsed = adjustInputSchema.safeParse(input);
  if (!parsed.success)
    return fail('invalid_input', issuePaths(parsed.error.issues));
  const request = parsed.data;

  try {
    const current = await getCurrentFit();
    if (!current.ok) return current;
    if (!current.data) return fail('not_found');

    let next: FitProfile;
    if (request.kind === 'restore') {
      const history = await listFitHistory({ limit: 100 });
      if (!history.ok) return history;
      const source = history.data.find(
        (entry) => entry.version === request.fromVersion,
      );
      if (!source?.profile) return fail('not_found');
      next = copyRow(current.data.profile, source.profile, request.row);
    } else {
      next = applyAdjustment(current.data.profile, request);
    }

    const saved = await saveFit({ profile: next, source: 'adjustment' });
    if (!saved.ok) return saved;

    revalidatePath('/app');
    return ok({
      version: saved.data.version,
      previousVersion: current.data.version,
      profile: saved.data.profile,
      createdAt: saved.data.createdAt,
    });
  } catch (error) {
    console.error(
      '[app] adjustFit failed',
      error instanceof Error ? error.name : typeof error,
    );
    return fail('unknown');
  }
}

/* ------------------------------------------------------------------------ */
/* Using an earlier version                                                   */
/* ------------------------------------------------------------------------ */

const restoreInputSchema = z.strictObject({ fromVersion: z.int().min(1) });

/**
 * Use an earlier version of the fit again. Nothing is overwritten: that
 * version's profile is saved as a new version (source 'restore'), so Undo is
 * just using the version it replaced.
 */
export async function restoreVersionAction(input: {
  fromVersion: number;
}): Promise<DataResult<AdjustedFit>> {
  const parsed = restoreInputSchema.safeParse(input);
  if (!parsed.success)
    return fail('invalid_input', issuePaths(parsed.error.issues));
  try {
    const [current, history] = await Promise.all([
      getCurrentFit(),
      listFitHistory({ limit: 100 }),
    ]);
    if (!current.ok) return current;
    if (!current.data) return fail('not_found');
    if (!history.ok) return history;
    const source = history.data.find(
      (entry) => entry.version === parsed.data.fromVersion,
    );
    if (!source?.profile) return fail('not_found');

    const saved = await saveFit({ profile: source.profile, source: 'restore' });
    if (!saved.ok) return saved;

    revalidatePath('/app');
    return ok({
      version: saved.data.version,
      previousVersion: current.data.version,
      profile: saved.data.profile,
      createdAt: saved.data.createdAt,
    });
  } catch (error) {
    console.error(
      '[app] restoreVersion failed',
      error instanceof Error ? error.name : typeof error,
    );
    return fail('unknown');
  }
}

/* ------------------------------------------------------------------------ */
/* What WebAble learned                                                       */
/* ------------------------------------------------------------------------ */

const learnedKeysSchema = z.strictObject({
  keys: z.array(z.string().min(1).max(64)).min(1).max(4),
});

/**
 * Clear what was learned for one row: a settled value (a dimension such as
 * textPx), a keep-or-undo pattern or an "off everywhere" (an op). The extension
 * picks the change up on its next sync (the page nudges it right away).
 */
export async function resetLearnedAction(input: {
  keys: string[];
}): Promise<DataResult<null>> {
  const parsed = learnedKeysSchema.safeParse(input);
  if (!parsed.success)
    return fail('invalid_input', issuePaths(parsed.error.issues));
  try {
    for (const key of parsed.data.keys) {
      const result = await resetLearned(key);
      if (!result.ok) return result;
    }
    revalidatePath('/app');
    revalidatePath('/app/changes');
    return ok(null);
  } catch (error) {
    console.error(
      '[app] resetLearned failed',
      error instanceof Error ? error.name : typeof error,
    );
    return fail('unknown');
  }
}

/** Forget everything WebAble learned for this account. The fit stays. */
export async function forgetLearningAction(): Promise<DataResult<null>> {
  try {
    const result = await forgetLearning();
    if (!result.ok) return result;
    revalidatePath('/app');
    revalidatePath('/app/changes');
    return ok(null);
  } catch (error) {
    console.error(
      '[app] forgetLearning failed',
      error instanceof Error ? error.name : typeof error,
    );
    return fail('unknown');
  }
}

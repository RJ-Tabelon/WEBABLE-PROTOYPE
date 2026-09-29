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
import { type DataResult, fail, issuePaths, ok } from '../../lib/data/result';

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

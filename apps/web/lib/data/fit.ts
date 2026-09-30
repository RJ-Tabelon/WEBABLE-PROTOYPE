import { type FitProfile, fitProfileSchema, type Tables } from '@webable/core';
import { z } from 'zod';

import {
  type DataResult,
  fail,
  guarded,
  issuePaths,
  jsonbTextBytes,
  mapPostgrestError,
  ok,
} from './result';
import { getDataContext } from './session';

/** Where a fit version came from. Mirrors the fit_profiles.source check constraint. */
export const FIT_SOURCES = [
  'calibration',
  'recalibration',
  'adjustment',
  'learned',
  'import',
  'restore',
] as const;
export type FitSource = (typeof FIT_SOURCES)[number];

/** fit_profiles.profile must stay under 8 KB as Postgres prints it. */
export const FIT_PROFILE_MAX_BYTES = 8192;

interface FitMeta {
  id: string;
  version: number;
  source: FitSource;
  derivationVersion: string;
  calibrationSessionId: string | null;
  isCurrent: boolean;
  createdAt: string;
}

/** One saved version of a person's fit. */
export interface FitVersion extends FitMeta {
  profile: FitProfile;
}

/** A history entry. `profile` is null when an old version no longer matches the schema. */
export interface FitHistoryEntry extends FitMeta {
  profile: FitProfile | null;
}

const FIT_COLUMNS =
  'id, version, profile, source, derivation_version, calibration_session_id, is_current, created_at' as const;

type FitRow = Pick<
  Tables<'fit_profiles'>,
  | 'id'
  | 'version'
  | 'profile'
  | 'source'
  | 'derivation_version'
  | 'calibration_session_id'
  | 'is_current'
  | 'created_at'
>;

function isFitSource(value: string): value is FitSource {
  return (FIT_SOURCES as readonly string[]).includes(value);
}

function toMeta(row: FitRow): FitMeta {
  return {
    id: row.id,
    version: row.version,
    source: isFitSource(row.source) ? row.source : 'import',
    derivationVersion: row.derivation_version,
    calibrationSessionId: row.calibration_session_id,
    isCurrent: row.is_current,
    createdAt: row.created_at,
  };
}

/** The current fit, or null before the first Tune. `invalid_data` if it no longer parses. */
export async function getCurrentFit(): Promise<DataResult<FitVersion | null>> {
  return guarded('getCurrentFit', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    const { data, error } = await supabase
      .from('fit_profiles')
      .select(FIT_COLUMNS)
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle();
    if (error) return fail(mapPostgrestError(error));
    if (!data) return ok(null);

    const profile = fitProfileSchema.safeParse(data.profile);
    if (!profile.success)
      return fail('invalid_data', issuePaths(profile.error.issues));
    return ok({ ...toMeta(data), profile: profile.data });
  });
}

export const fitHistoryOptionsSchema = z.strictObject({
  limit: z.int().min(1).max(100).default(20),
});

/** Saved versions, newest first (history is how recalibration is kept). */
export async function listFitHistory(
  options: z.input<typeof fitHistoryOptionsSchema> = {},
): Promise<DataResult<FitHistoryEntry[]>> {
  const parsed = fitHistoryOptionsSchema.safeParse(options);
  if (!parsed.success)
    return fail('invalid_input', issuePaths(parsed.error.issues));

  return guarded('listFitHistory', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    const { data, error } = await supabase
      .from('fit_profiles')
      .select(FIT_COLUMNS)
      .eq('user_id', user.id)
      .order('version', { ascending: false })
      .limit(parsed.data.limit);
    if (error) return fail(mapPostgrestError(error));

    return ok(
      data.map((row) => {
        const profile = fitProfileSchema.safeParse(row.profile);
        return {
          ...toMeta(row),
          profile: profile.success ? profile.data : null,
        };
      }),
    );
  });
}

export const saveFitInputSchema = z.strictObject({
  profile: fitProfileSchema,
  source: z.enum(FIT_SOURCES),
  calibrationSessionId: z.uuid().nullish(),
});

export type SaveFitInput = z.input<typeof saveFitInputSchema>;

/**
 * Save a new fit version and make it current, atomically (save_fit_profile).
 * The profile is validated against the shared schema first; unknown keys are dropped.
 */
export async function saveFit(
  input: SaveFitInput,
): Promise<DataResult<FitVersion>> {
  const parsed = saveFitInputSchema.safeParse(input);
  if (!parsed.success)
    return fail('invalid_input', issuePaths(parsed.error.issues));
  const { profile, source, calibrationSessionId } = parsed.data;

  if (
    profile.derivationVersion.length === 0 ||
    profile.derivationVersion.length > 32
  ) {
    return fail('invalid_input', ['profile.derivationVersion']);
  }
  if (jsonbTextBytes(profile) >= FIT_PROFILE_MAX_BYTES)
    return fail('too_large', ['profile']);

  return guarded('saveFit', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase } = ctx.data;

    const { data, error } = await supabase.rpc('save_fit_profile', {
      p_profile: profile,
      p_source: source,
      p_derivation_version: profile.derivationVersion,
      ...(calibrationSessionId
        ? { p_calibration_session_id: calibrationSessionId }
        : {}),
    });
    if (error) return fail(mapPostgrestError(error));
    if (!data) return fail('unknown');
    return ok({ ...toMeta(data), profile });
  });
}

import {
  CALIBRATION_VERSION,
  type CalibrationModules,
  calibrationModulesSchema,
  type DeviceContext,
  deviceContextSchema,
} from '@webable/core';
import { z } from 'zod';

import { advanceOnboarding } from './account';
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

/*
 * A Tune session stores only bounded per-module summaries and coarse device
 * buckets. Raw trials (pointer samples, reading times) stay in the browser and
 * are never sent here.
 */

/** Limits enforced by calibration_sessions CHECK constraints (Postgres jsonb text bytes). */
export const DEVICE_MAX_BYTES = 1024;
export const MODULES_MAX_BYTES = 16384;

export interface CalibrationSessionRef {
  id: string;
  calibrationVersion: string;
  startedAt: string;
}

export interface CompletedCalibrationSession extends CalibrationSessionRef {
  completedAt: string;
}

export const startCalibrationInputSchema = z.strictObject({
  device: deviceContextSchema,
});
export type StartCalibrationInput = z.input<typeof startCalibrationInputSchema>;

/** Open a session when Tune starts. Also moves onboarding from "new" to "tuning". */
export async function startCalibrationSession(
  input: StartCalibrationInput,
): Promise<DataResult<CalibrationSessionRef>> {
  const parsed = startCalibrationInputSchema.safeParse(input);
  if (!parsed.success)
    return fail('invalid_input', issuePaths(parsed.error.issues));
  const device: DeviceContext = parsed.data.device;
  if (jsonbTextBytes(device) >= DEVICE_MAX_BYTES)
    return fail('too_large', ['device']);

  return guarded('startCalibrationSession', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    const { data, error } = await supabase
      .from('calibration_sessions')
      .insert({
        user_id: user.id,
        calibration_version: CALIBRATION_VERSION,
        device: device,
      })
      .select('id, calibration_version, started_at')
      .single();
    if (error) return fail(mapPostgrestError(error));
    if (!data) return fail('unknown');

    // Best effort: a failed onboarding update must not lose the session.
    await advanceOnboarding('tuning').catch(() => undefined);

    return ok({
      id: data.id,
      calibrationVersion: data.calibration_version,
      startedAt: data.started_at,
    });
  });
}

export const completeCalibrationInputSchema = z.strictObject({
  id: z.uuid(),
  modules: calibrationModulesSchema,
});
export type CompleteCalibrationInput = z.input<
  typeof completeCalibrationInputSchema
>;

/**
 * Store the module summaries and mark the session completed. Only an
 * in-progress session of the signed-in person can be completed, once.
 */
export async function completeCalibrationSession(
  input: CompleteCalibrationInput,
): Promise<DataResult<CompletedCalibrationSession>> {
  const parsed = completeCalibrationInputSchema.safeParse(input);
  if (!parsed.success)
    return fail('invalid_input', issuePaths(parsed.error.issues));
  const modules: CalibrationModules = parsed.data.modules;
  if (jsonbTextBytes(modules) >= MODULES_MAX_BYTES)
    return fail('too_large', ['modules']);

  return guarded('completeCalibrationSession', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    const { data, error } = await supabase
      .from('calibration_sessions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        modules: modules,
      })
      .eq('id', parsed.data.id)
      .eq('user_id', user.id)
      .eq('status', 'in_progress')
      .select('id, calibration_version, started_at, completed_at')
      .maybeSingle();
    if (error) return fail(mapPostgrestError(error));
    if (!data || !data.completed_at) return fail('not_found');

    return ok({
      id: data.id,
      calibrationVersion: data.calibration_version,
      startedAt: data.started_at,
      completedAt: data.completed_at,
    });
  });
}

/** Mark an in-progress session abandoned (the person left Tune). Idempotent. */
export async function abandonCalibrationSession(input: {
  id: string;
}): Promise<DataResult<{ id: string }>> {
  const parsed = z.strictObject({ id: z.uuid() }).safeParse(input);
  if (!parsed.success)
    return fail('invalid_input', issuePaths(parsed.error.issues));

  return guarded('abandonCalibrationSession', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    const { error } = await supabase
      .from('calibration_sessions')
      .update({ status: 'abandoned' })
      .eq('id', parsed.data.id)
      .eq('user_id', user.id)
      .eq('status', 'in_progress');
    if (error) return fail(mapPostgrestError(error));
    return ok({ id: parsed.data.id });
  });
}
